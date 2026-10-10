use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::consts::DEFAULT_PORT;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::java::{self, JavaInfo};
use crate::loaders::{
    GameVersionList, InstallRequest, InstallStage, LoaderKind, LoaderVersionList, Loaders,
};
use crate::paths;
use crate::registry::Registry;
use crate::server::{LaunchSpec, ServerManager, ServerSnapshot, stats};
use crate::util::now_ms;

pub const EVENT_INSTALL_PROGRESS: &str = "install://progress";

const MIN_RAM_MB: u32 = 512;
const MAX_NAME_LEN: usize = 48;

pub struct AppState {
    pub loaders: Loaders,
    pub servers: Arc<ServerManager>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    total_mem_mb: u64,
    java: Option<JavaInfo>,
}

#[tauri::command]
pub async fn system_info() -> SystemInfo {
    SystemInfo {
        total_mem_mb: stats::total_memory_mb(),
        java: java::detect().await,
    }
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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    id: &'a str,
    stage: &'static str,
    /// "server" | "fabric" | "paper" (yalnız `download` aşamasında)
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
    req: CreateInstanceRequest,
) -> AppResult<Instance> {
    let name = validate_name(&req.name)?;
    validate_ram(req.ram_min_mb, req.ram_max_mb)?;

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

    let result = installed.and_then(|installed| {
        let inst = Instance {
            id: id.clone(),
            name,
            loader: req.loader,
            mc_version: req.mc_version.clone(),
            loader_version: installed.loader_version,
            java_path: None,
            java_major: installed.java_major,
            ram_min_mb: req.ram_min_mb,
            ram_max_mb: req.ram_max_mb,
            port: DEFAULT_PORT,
            created_at: now_ms(),
        };
        inst.save(&dir)?;
        registry.insert(&id, dir.clone())?;
        Ok(inst)
    });

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
    let mut inst = Instance::load(&dir)?;
    if let Some(name) = &changes.name {
        inst.name = validate_name(name)?;
    }
    let min = changes.ram_min_mb.unwrap_or(inst.ram_min_mb);
    let max = changes.ram_max_mb.unwrap_or(inst.ram_max_mb);
    validate_ram(min, max)?;
    inst.ram_min_mb = min;
    inst.ram_max_mb = max;
    inst.save(&dir)?;
    Ok(inst)
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

#[tauri::command]
pub fn eula_status(app: AppHandle, id: String) -> AppResult<bool> {
    Ok(eula_accepted(&paths::server_dir(&app, &id)?))
}

#[tauri::command]
pub fn accept_eula(app: AppHandle, id: String) -> AppResult<()> {
    let dir = paths::server_dir(&app, &id)?;
    std::fs::create_dir_all(&dir)?;
    std::fs::write(
        dir.join("eula.txt"),
        "# Minecraft EULA arayüzden onaylandı: https://aka.ms/MinecraftEULA\neula=true\n",
    )?;
    Ok(())
}

#[tauri::command]
pub async fn start_server(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    let inst = instance::get(&app, &id)?;
    let server_dir = paths::server_dir(&app, &id)?;
    if !eula_accepted(&server_dir) {
        return Err(AppError::msg("EULA onaylanmadan sunucu başlatılamaz"));
    }

    let java = match &inst.java_path {
        Some(p) => java::probe(p)
            .await
            .ok_or_else(|| AppError::msg(format!("Seçili Java çalıştırılamadı: {p}")))?,
        None => java::detect().await.ok_or_else(|| {
            AppError::msg(format!(
                "Java bulunamadı. Bu sürüm için Java {}+ gerekli.",
                inst.java_major
            ))
        })?,
    };
    if java.major < inst.java_major {
        return Err(AppError::msg(format!(
            "Minecraft {} için Java {}+ gerekli, bulunan Java {} ({}).",
            inst.mc_version, inst.java_major, java.major, java.path
        )));
    }

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
