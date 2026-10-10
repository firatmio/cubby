use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::consts::DEFAULT_PORT;
use crate::covers::{self, CoverSource, ShotList};
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::java::{JavaInfo, JavaManager, JavaStage};
use crate::loaders::{
    GameVersionList, InstallRequest, InstallStage, LoaderKind, LoaderVersionList, Loaders,
};
use crate::paths;
use crate::players;
use crate::properties::Properties;
use crate::registry::Registry;
use crate::server::{LaunchSpec, ServerManager, ServerSnapshot, stats};
use crate::sessions::{self, PlayStats};
use crate::settings::{AppSettings, SettingsStore};
use crate::util::now_ms;

pub const EVENT_INSTALL_PROGRESS: &str = "install://progress";
pub const EVENT_JAVA_PROGRESS: &str = "java://progress";

const MIN_RAM_MB: u32 = 512;
const MAX_NAME_LEN: usize = 48;

pub struct AppState {
    pub http: reqwest::Client,
    pub loaders: Loaders,
    pub servers: Arc<ServerManager>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    total_mem_mb: u64,
    java: Option<JavaInfo>,
}

/// `java`: bulunan en yeni Java (sihirbaz özeti için).
#[tauri::command]
pub async fn system_info(java: State<'_, JavaManager>) -> Result<SystemInfo, ()> {
    Ok(SystemInfo {
        total_mem_mb: stats::total_memory_mb(),
        java: java.list(false).await.into_iter().next(),
    })
}

#[tauri::command]
pub async fn list_game_versions(
    state: State<'_, AppState>,
    loader: LoaderKind,
    include_snapshots: bool,
) -> AppResult<GameVersionList> {
    state
        .loaders
        .list_game_versions(loader, include_snapshots)
        .await
}

#[tauri::command]
pub async fn list_loader_versions(
    state: State<'_, AppState>,
    loader: LoaderKind,
    game: String,
) -> AppResult<LoaderVersionList> {
    state.loaders.list_loader_versions(loader, &game).await
}

#[tauri::command]
pub fn list_instances(app: AppHandle) -> Vec<Instance> {
    instance::list(&app)
}

#[tauri::command]
pub fn get_instance(app: AppHandle, id: String) -> AppResult<Instance> {
    instance::get(&app, &id)
}

fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
        return Err(AppError::msg(format!(
            "İsim 1–{MAX_NAME_LEN} karakter olmalı"
        )));
    }
    Ok(name.to_string())
}

fn validate_ram(min: u32, max: u32) -> AppResult<()> {
    if min < MIN_RAM_MB || max < min {
        return Err(AppError::msg("RAM değerleri geçersiz"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceRequest {
    name: String,
    loader: LoaderKind,
    mc_version: String,
    loader_version: Option<String>,
    ram_min_mb: u32,
    ram_max_mb: u32,
    /// Kullanıcının seçtiği üst klasör; `None` ise uygulama veri dizini.
    parent_dir: Option<PathBuf>,
    /// Premium olmayan hesaplar (TLauncher) girebilsin mi? Açıksa beyaz liste zorunlu.
    #[serde(default)]
    offline_mode: bool,
    /// `Some` ise beyaz liste açık başlar ve bu isimler eklenir.
    #[serde(default)]
    whitelist: Option<Vec<String>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    id: &'a str,
    stage: &'static str,
    /// "server" | "fabric" | "paper" | "java" (`download` / `extract` aşamasında)
    file: Option<&'static str>,
    downloaded: u64,
    total: Option<u64>,
}

/// Klasörü oluşturur, sunucu dosyalarını kurar; başarılı olursa `instance.json` yazar ve kayda ekler.
/// Hata olursa yarım klasör silinir.
#[tauri::command]
pub async fn create_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    registry: State<'_, Registry>,
    java: State<'_, JavaManager>,
    settings: State<'_, SettingsStore>,
    req: CreateInstanceRequest,
) -> AppResult<Instance> {
    let name = validate_name(&req.name)?;
    validate_ram(req.ram_min_mb, req.ram_max_mb)?;
    // İsimler indirmelerden önce çözülür: premium hesap yoksa kurulum hiç başlamasın.
    let whitelist_on = req.offline_mode || req.whitelist.is_some();
    let mut profiles = Vec::new();
    for n in req.whitelist.iter().flatten() {
        players::upsert(
            &mut profiles,
            players::resolve(&state.http, n, req.offline_mode).await?,
        );
    }

    let id = uuid::Uuid::new_v4().to_string();
    let dir = registry.allocate(&id, &name, req.parent_dir.as_deref())?;
    let server_dir = dir.join("server");
    let emit =
        |stage: &'static str, file: Option<&'static str>, downloaded: u64, total: Option<u64>| {
            let _ = app.emit(
                EVENT_INSTALL_PROGRESS,
                InstallProgress {
                    id: &id,
                    stage,
                    file,
                    downloaded,
                    total,
                },
            );
        };

    let installed = state
        .loaders
        .install(
            req.loader,
            &InstallRequest {
                mc_version: &req.mc_version,
                loader_version: req.loader_version.as_deref(),
            },
            &server_dir,
            &mut |stage| match stage {
                InstallStage::Meta => emit("meta", None, 0, None),
                InstallStage::Download {
                    file,
                    downloaded,
                    total,
                } => emit("download", Some(file), downloaded, total),
            },
        )
        .await;

    let result: AppResult<Instance> = async {
        let installed = installed?;
        // Uygun Java yoksa indirilip sunucuya bağlanır. Başarısız olursa kurulum yine biter;
        // başlatırken arayüz Java'yı tekrar önerir.
        let java_path = match java
            .ensure(installed.java_major, |stage| match stage {
                JavaStage::Download { downloaded, total } => {
                    emit("download", Some("java"), downloaded, total)
                }
                JavaStage::Extract => emit("extract", Some("java"), 0, None),
            })
            .await
        {
            Ok(downloaded) => downloaded.map(|j| j.path),
            Err(e) => {
                eprintln!("Java indirilemedi: {e}");
                None
            }
        };
        let inst = Instance {
            id: id.clone(),
            name,
            loader: req.loader,
            mc_version: req.mc_version.clone(),
            loader_version: installed.loader_version,
            java_path,
            java_major: installed.java_major,
            ram_min_mb: req.ram_min_mb,
            ram_max_mb: req.ram_max_mb,
            port: DEFAULT_PORT,
            created_at: now_ms(),
            cover: None,
            internet: false,
            invite_token: None,
        };
        let mut props = Properties::load(&server_dir)?;
        props.set("motd", inst.name.clone());
        props.set("online-mode", (!req.offline_mode).to_string());
        props.set("white-list", whitelist_on.to_string());
        props.set("enforce-whitelist", whitelist_on.to_string());
        props.save(&server_dir)?;
        if whitelist_on {
            players::write_whitelist(&server_dir, &profiles)?;
        }
        if settings.get().eula_accepted {
            write_eula(&server_dir)?;
        }
        inst.save(&dir)?;
        registry.insert(&id, dir.clone())?;
        Ok(inst)
    }
    .await;

    match result {
        Ok(inst) => {
            emit("done", None, 0, None);
            Ok(inst)
        }
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            Err(e)
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstanceRequest {
    name: Option<String>,
    ram_min_mb: Option<u32>,
    ram_max_mb: Option<u32>,
}

/// RAM değişikliği sunucu bir sonraki açılışında geçerli olur.
#[tauri::command]
pub fn update_instance(
    app: AppHandle,
    id: String,
    changes: UpdateInstanceRequest,
) -> AppResult<Instance> {
    let dir = paths::instance_dir(&app, &id)?;
    instance::modify(&dir, |inst| {
        if let Some(name) = &changes.name {
            inst.name = validate_name(name)?;
        }
        let min = changes.ram_min_mb.unwrap_or(inst.ram_min_mb);
        let max = changes.ram_max_mb.unwrap_or(inst.ram_max_mb);
        validate_ram(min, max)?;
        inst.ram_min_mb = min;
        inst.ram_max_mb = max;
        Ok(())
    })
}

/// Klasörü Geri Dönüşüm Kutusu'na taşır ve kayıttan çıkarır.
#[tauri::command]
pub async fn delete_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    registry: State<'_, Registry>,
    id: String,
) -> AppResult<()> {
    if state.servers.snapshot(&id).status.is_active() {
        return Err(AppError::msg("Çalışan sunucu silinemez, önce durdur"));
    }
    let dir = paths::instance_dir(&app, &id)?;
    if dir.exists() {
        let target = dir.clone();
        tokio::task::spawn_blocking(move || trash::delete(target))
            .await
            .map_err(|e| AppError::msg(e.to_string()))?
            .map_err(|e| AppError::msg(format!("Geri Dönüşüm Kutusu'na taşınamadı: {e}")))?;
    }
    registry.remove(&id)
}

fn eula_accepted(server_dir: &Path) -> bool {
    std::fs::read_to_string(server_dir.join("eula.txt"))
        .map(|t| {
            t.lines()
                .any(|l| l.trim().eq_ignore_ascii_case("eula=true"))
        })
        .unwrap_or(false)
}

fn write_eula(server_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(server_dir)?;
    std::fs::write(
        server_dir.join("eula.txt"),
        "# Minecraft EULA arayüzden onaylandı: https://aka.ms/MinecraftEULA\neula=true\n",
    )?;
    Ok(())
}

/// EULA bir kez kabul edildiyse (uygulama ayarı) bu dünyaya da kendiliğinden yazılır.
#[tauri::command]
pub fn eula_status(
    app: AppHandle,
    settings: State<'_, SettingsStore>,
    id: String,
) -> AppResult<bool> {
    let dir = paths::server_dir(&app, &id)?;
    if eula_accepted(&dir) {
        return Ok(true);
    }
    if settings.get().eula_accepted {
        write_eula(&dir)?;
        return Ok(true);
    }
    Ok(false)
}

/// Kabul tüm dünyalar için hatırlanır.
#[tauri::command]
pub fn accept_eula(
    app: AppHandle,
    settings: State<'_, SettingsStore>,
    id: String,
) -> AppResult<()> {
    write_eula(&paths::server_dir(&app, &id)?)?;
    let mut s = settings.get();
    if !s.eula_accepted {
        s.eula_accepted = true;
        settings.set(s)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_server(
    app: AppHandle,
    state: State<'_, AppState>,
    java: State<'_, JavaManager>,
    id: String,
) -> AppResult<()> {
    let inst = instance::get(&app, &id)?;
    let server_dir = paths::server_dir(&app, &id)?;
    if !eula_accepted(&server_dir) {
        return Err(AppError::msg("EULA onaylanmadan sunucu başlatılamaz"));
    }

    let java = java
        .resolve(inst.java_path.as_deref(), inst.java_major)
        .await?
        .ok_or_else(|| {
            AppError::msg(format!(
                "Minecraft {} için Java {}+ bulunamadı. Ayarlar > Java'dan indirebilirsin.",
                inst.mc_version, inst.java_major
            ))
        })?;

    let mut args = vec![
        format!("-Xms{}M", inst.ram_min_mb),
        format!("-Xmx{}M", inst.ram_max_mb),
        // Konsol çıktısı yerel kod sayfasıyla (ör. Cp1254) değil UTF-8 gelsin.
        "-Dstdout.encoding=UTF-8".into(),
        "-Dstderr.encoding=UTF-8".into(),
    ];
    args.extend(state.loaders.launch_args(inst.loader));
    state
        .servers
        .start(
            &app,
            &id,
            LaunchSpec {
                java: java.path,
                args,
                cwd: server_dir,
            },
        )
        .await
}

#[tauri::command]
pub async fn stop_server(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.servers.stop(&app, &id).await
}

#[tauri::command]
pub async fn send_command(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    command: String,
) -> AppResult<()> {
    state.servers.send_command(&app, &id, &command).await
}

#[tauri::command]
pub fn server_snapshot(state: State<'_, AppState>, id: String) -> ServerSnapshot {
    state.servers.snapshot(&id)
}

fn open_dir(app: &AppHandle, dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::msg(format!("Klasör açılamadı: {e}")))
}

#[tauri::command]
pub fn open_instance_dir(app: AppHandle, id: String) -> AppResult<()> {
    open_dir(&app, &paths::server_dir(&app, &id)?)
}

/// `mods/` (Fabric) veya `plugins/` (Paper).
#[tauri::command]
pub fn open_content_dir(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let inst = instance::get(&app, &id)?;
    let sub = state
        .loaders
        .content_dir(inst.loader)
        .ok_or_else(|| AppError::msg("Bu sunucu türünde mod/plugin klasörü yok"))?;
    open_dir(&app, &paths::server_dir(&app, &id)?.join(sub))
}

#[tauri::command]
pub async fn list_java(java: State<'_, JavaManager>, refresh: bool) -> Result<Vec<JavaInfo>, ()> {
    Ok(java.list(refresh).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceJava {
    required: u32,
    /// Kullanıcının sabitlediği yol; `None` = otomatik.
    pinned: Option<String>,
    /// Başlatınca kullanılacak Java; yoksa indirilmesi gerekir.
    selected: Option<JavaInfo>,
    /// Sabitlenmiş Java bozuksa/eskiyse açıklama.
    error: Option<String>,
}

#[tauri::command]
pub async fn instance_java(
    app: AppHandle,
    java: State<'_, JavaManager>,
    id: String,
) -> AppResult<InstanceJava> {
    let inst = instance::get(&app, &id)?;
    let (selected, error) = match java
        .resolve(inst.java_path.as_deref(), inst.java_major)
        .await
    {
        Ok(sel) => (sel, None),
        Err(e) => (None, Some(e.to_string())),
    };
    Ok(InstanceJava {
        required: inst.java_major,
        pinned: inst.java_path,
        selected,
        error,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JavaProgress {
    major: u32,
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

/// Adoptium'dan `major` (veya uygun üstü) JRE indirir.
#[tauri::command]
pub async fn install_java(
    app: AppHandle,
    java: State<'_, JavaManager>,
    major: u32,
) -> AppResult<JavaInfo> {
    let emit = |stage: &'static str, downloaded: u64, total: Option<u64>| {
        let _ = app.emit(
            EVENT_JAVA_PROGRESS,
            JavaProgress {
                major,
                stage,
                downloaded,
                total,
            },
        );
    };
    java.install(major, |stage| match stage {
        JavaStage::Download { downloaded, total } => emit("download", downloaded, total),
        JavaStage::Extract => emit("extract", 0, None),
    })
    .await
}

/// `path`: sabitlenecek java; `None` otomatik seçime döner.
#[tauri::command]
pub async fn set_instance_java(
    app: AppHandle,
    java: State<'_, JavaManager>,
    id: String,
    path: Option<String>,
) -> AppResult<Instance> {
    let dir = paths::instance_dir(&app, &id)?;
    if let Some(p) = &path {
        let required = Instance::load(&dir)?.java_major;
        java.resolve(Some(p), required).await?;
    }
    instance::modify(&dir, |inst| {
        inst.java_path = path;
        Ok(())
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    settings: AppSettings,
    /// Ayarda klasör yoksa kullanılan varsayılan.
    minecraft_dir: Option<String>,
    screenshots_found: bool,
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> SettingsView {
    let shots = store.screenshots_dir();
    SettingsView {
        settings: store.get(),
        minecraft_dir: store
            .minecraft_dir()
            .map(|d| d.to_string_lossy().into_owned()),
        screenshots_found: shots.is_some_and(|d| d.is_dir()),
    }
}

#[tauri::command]
pub fn update_settings(
    store: State<'_, SettingsStore>,
    settings: AppSettings,
) -> AppResult<SettingsView> {
    store.set(settings)?;
    Ok(get_settings(store))
}

#[tauri::command]
pub fn list_screenshots(app: AppHandle, id: String) -> AppResult<ShotList> {
    covers::list_for(&app, &id)
}

#[tauri::command]
pub async fn set_cover(app: AppHandle, id: String, source: CoverSource) -> AppResult<Instance> {
    covers::set_cover(&app, &id, source).await
}

#[tauri::command]
pub fn play_stats(app: AppHandle, id: String) -> AppResult<PlayStats> {
    Ok(sessions::stats(&sessions::load(&paths::instance_dir(
        &app, &id,
    )?)))
}

/// Gerçek port `server.properties`'ten; dosya yoksa (ilk açılıştan önce) kayıtlı port.
pub(crate) fn server_port(server_dir: &Path, fallback: u16) -> u16 {
    std::fs::read_to_string(server_dir.join("server.properties"))
        .ok()
        .and_then(|t| {
            t.lines()
                .find_map(|l| l.trim().strip_prefix("server-port=").map(str::to_string))
        })
        .and_then(|p| p.trim().parse().ok())
        .unwrap_or(fallback)
}

/// Aynı ağdaki oyuncuların bağlanacağı adres (ör. `192.168.1.20:25565`).
#[tauri::command]
pub fn lan_address(app: AppHandle, id: String) -> AppResult<String> {
    let inst = instance::get(&app, &id)?;
    let port = server_port(&paths::server_dir(&app, &id)?, inst.port);
    let ip =
        local_ip_address::local_ip().map_err(|_| AppError::msg("Yerel ağ adresi bulunamadı"))?;
    Ok(format!("{ip}:{port}"))
}
