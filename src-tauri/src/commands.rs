use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::consts::DEFAULT_PORT;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::java::{self, JavaInfo};
use crate::loaders::vanilla::{InstallStage, SERVER_JAR, VanillaApi};
use crate::loaders::{GameVersionList, LoaderKind};
use crate::paths;
use crate::server::{LaunchSpec, ServerManager, ServerSnapshot, stats};
use crate::util::now_ms;

pub const EVENT_INSTALL_PROGRESS: &str = "install://progress";

const MIN_RAM_MB: u32 = 512;
const MAX_NAME_LEN: usize = 48;

pub struct AppState {
    pub vanilla: VanillaApi,
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
pub async fn list_mc_versions(
    state: State<'_, AppState>,
    include_snapshots: bool,
) -> AppResult<GameVersionList> {
    state.vanilla.list_game_versions(include_snapshots).await
}

#[tauri::command]
pub fn list_instances(app: AppHandle) -> AppResult<Vec<Instance>> {
    instance::list(&app)
}

#[tauri::command]
pub fn get_instance(app: AppHandle, id: String) -> AppResult<Instance> {
    instance::get(&app, &id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceRequest {
    name: String,
    mc_version: String,
    ram_min_mb: u32,
    ram_max_mb: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    id: &'a str,
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

/// Klasörü oluşturur, sunucu jar'ını indirir; başarılı olursa `instance.json` yazar.
/// Hata olursa yarım klasör silinir.
#[tauri::command]
pub async fn create_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    req: CreateInstanceRequest,
) -> AppResult<Instance> {
    let name = req.name.trim().to_string();
    if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
        return Err(AppError::msg(format!(
            "İsim 1–{MAX_NAME_LEN} karakter olmalı"
        )));
    }
    if req.ram_min_mb < MIN_RAM_MB || req.ram_max_mb < req.ram_min_mb {
        return Err(AppError::msg("RAM değerleri geçersiz"));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let dir = paths::instance_dir(&app, &id)?;
    let server_dir = paths::server_dir(&app, &id)?;
    let emit = |stage: &'static str, downloaded: u64, total: Option<u64>| {
        let _ = app.emit(
            EVENT_INSTALL_PROGRESS,
            InstallProgress {
                id: &id,
                stage,
                downloaded,
                total,
            },
        );
    };

    let installed = state
        .vanilla
        .install(&req.mc_version, &server_dir, |stage| match stage {
            InstallStage::Meta => emit("meta", 0, None),
            InstallStage::Download { downloaded, total } => emit("download", downloaded, total),
        })
        .await;

    let result = installed.and_then(|java_major| {
        let inst = Instance {
            id: id.clone(),
            name,
            loader: LoaderKind::Vanilla,
            mc_version: req.mc_version.clone(),
            loader_version: None,
            java_path: None,
            java_major,
            ram_min_mb: req.ram_min_mb,
            ram_max_mb: req.ram_max_mb,
            port: DEFAULT_PORT,
            created_at: now_ms(),
        };
        inst.save(&dir)?;
        Ok(inst)
    });

    match result {
        Ok(inst) => {
            emit("done", 0, None);
            Ok(inst)
        }
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            Err(e)
        }
    }
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

    let args = vec![
        format!("-Xms{}M", inst.ram_min_mb),
        format!("-Xmx{}M", inst.ram_max_mb),
        // Konsol çıktısı yerel kod sayfasıyla (ör. Cp1254) değil UTF-8 gelsin.
        "-Dstdout.encoding=UTF-8".into(),
        "-Dstderr.encoding=UTF-8".into(),
        "-jar".into(),
        SERVER_JAR.into(),
        "nogui".into(),
    ];
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

#[tauri::command]
pub fn open_instance_dir(app: AppHandle, id: String) -> AppResult<()> {
    let dir = paths::server_dir(&app, &id)?;
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::msg(format!("Klasör açılamadı: {e}")))
}
