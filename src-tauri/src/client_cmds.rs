//! Host: kendi dünyasının oyuncuda gereken modları kendi Minecraft'ına (dünyaya özel profile) kurulur.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

use crate::client::{self, Launcher, ProfileSpec, Wanted, manifest};
use crate::commands::{AppState, server_port};
use crate::covers::SERVER_ICON;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::java::JavaManager;
use crate::join::servers_dat;
use crate::loaders::LoaderKind;
use crate::mods;
use crate::paths;
use crate::server::EVENT_STATUS;
use crate::sessions::META_DIR;
use crate::settings::SettingsStore;
use crate::util::{iso_utc, now_ms};

pub const EVENT_STATUS_CLIENT: &str = "client://status";

/// Aynı anda tek eşitleme (Launcher dosyası ve ortak mods klasörü yarışmasın).
static SYNC: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    /// off: kapalı/uygulanamaz, working, ok, error
    pub state: &'static str,
    pub launcher: Option<Launcher>,
    /// Launcher'da seçilecek profil (resmi Launcher) ya da sürüm (TLauncher).
    pub pick: Option<String>,
    pub mods: usize,
    pub blocked: Vec<String>,
    pub message: Option<String>,
}

#[derive(Default)]
pub struct ClientStates(pub Mutex<HashMap<String, ClientStatus>>);

#[derive(Serialize, Clone)]
struct Payload<'a> {
    id: &'a str,
    status: &'a ClientStatus,
}

fn set(app: &AppHandle, id: &str, status: ClientStatus) {
    app.state::<ClientStates>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(id.to_string(), status.clone());
    let _ = app.emit(
        EVENT_STATUS_CLIENT,
        Payload {
            id,
            status: &status,
        },
    );
}

pub fn profile_key(id: &str) -> String {
    format!("mcsm-{id}")
}

pub fn profile_name(world: &str) -> String {
    format!("{world} · MC Sunucu")
}

/// Klasör adı: okunur ad + kimliğin başı (aynı adlı iki dünya karışmasın).
pub fn dir_name(world: &str, id: &str) -> String {
    format!("{}-{}", client::slug(world), &id[..id.len().min(8)])
}

/// Launcher'da görünecek ikon: sunucu simgesi (kapaktan, 64×64 PNG) ya da hazır bir blok.
fn profile_icon(server_dir: &Path) -> String {
    std::fs::read(server_dir.join(SERVER_ICON))
        .ok()
        .filter(|b| b.starts_with(&[0x89, b'P', b'N', b'G']) && b.len() < 64 * 1024)
        .map(|b| format!("data:image/png;base64,{}", STANDARD.encode(b)))
        .unwrap_or_else(|| "Furnace".into())
}

pub fn minecraft_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.state::<SettingsStore>()
        .minecraft_dir()
        .filter(|d| d.is_dir())
        .ok_or_else(|| {
            AppError::msg("Minecraft klasörü bulunamadı. Ayarlar'dan Minecraft klasörünü seç.")
        })
}

/// Mod altyapısının istemci sürümü: Fabric/Quilt meta'dan, NeoForge/Forge resmi installer'la
/// (Java gerekirse bulunur ya da indirilir).
async fn ensure_client_version(
    app: &AppHandle,
    mc: &Path,
    kind: LoaderKind,
    mc_version: &str,
    loader_version: &str,
    on_line: &mut (impl FnMut(String) + Send),
) -> AppResult<String> {
    let state = app.state::<AppState>();
    let http = state.http.clone();
    if matches!(kind, LoaderKind::Fabric | LoaderKind::Quilt) {
        return client::ensure_meta_version(&http, mc, kind, mc_version, loader_version).await;
    }
    if let Some(id) = client::version_id(kind, mc_version, loader_version)
        .filter(|id| client::version_exists(mc, id))
    {
        return Ok(id);
    }
    let major = state.loaders.java_major(mc_version).await?;
    let java = app.state::<JavaManager>();
    let found = match java.resolve(None, major).await? {
        Some(j) => j,
        None => java.install(major, |_| {}).await?,
    };
    let work = app
        .path()
        .app_data_dir()?
        .join("cache")
        .join(format!("installer-{}", uuid::Uuid::new_v4().simple()));
    client::install_forge_client(
        &http,
        mc,
        kind,
        mc_version,
        loader_version,
        Path::new(&found.path),
        &work,
        on_line,
    )
    .await
}

/// Mod altyapısının istemci sürümü + (resmi Launcher'da) profil + `servers.dat`.
/// Dönen: (Launcher, mods klasörü, ortak mı, seçilecek ad).
#[allow(clippy::too_many_arguments)]
pub async fn prepare_client(
    app: &AppHandle,
    kind: LoaderKind,
    key: &str,
    world_name: &str,
    dir: &str,
    mc_version: &str,
    loader_version: &str,
    icon: String,
    server_entry: Option<(&str, &str)>,
    on_line: &mut (impl FnMut(String) + Send),
) -> AppResult<(Launcher, PathBuf, bool, String)> {
    let mc = minecraft_dir(app)?;
    let launcher = client::detect_launcher(&mc).ok_or_else(|| {
        AppError::msg("Minecraft Launcher ya da TLauncher bulunamadı. Minecraft'ı en az bir kez açtıktan sonra tekrar dene.")
    })?;
    let version_id =
        ensure_client_version(app, &mc, kind, mc_version, loader_version, on_line).await?;
    let (game_dir, mods_dir) = client::targets(&mc, launcher, dir);
    let pick = match launcher {
        Launcher::Official => {
            client::prepare_game_dir(&mc, &game_dir)?;
            let now = iso_utc(now_ms());
            let name = profile_name(world_name);
            client::edit_profiles(&mc, |root| {
                client::upsert_profile(
                    root,
                    &ProfileSpec {
                        key,
                        name: &name,
                        version_id: &version_id,
                        game_dir: &game_dir,
                        icon: &icon,
                        now: &now,
                    },
                )
            })?;
            name
        }
        Launcher::TLauncher => version_id,
    };
    if let Some((ip, name)) = server_entry {
        let mut root = servers_dat::read(&game_dir)?;
        servers_dat::upsert(&mut root, ip, name);
        servers_dat::write(&game_dir, &root)?;
    }
    Ok((launcher, mods_dir, launcher == Launcher::TLauncher, pick))
}

async fn sync_host_inner(app: &AppHandle, inst: &Instance) -> AppResult<ClientStatus> {
    let server_dir = paths::server_dir(app, &inst.id)?;
    let meta = paths::instance_dir(app, &inst.id)?.join(META_DIR);
    let lv = inst
        .loader_version
        .clone()
        .ok_or_else(|| AppError::msg(format!("{} sürümü bilinmiyor.", inst.loader.label())))?;
    let port = server_port(&server_dir, inst.port);
    let ip = format!("localhost:{port}");
    let (launcher, mods_dir, shared, pick) = prepare_client(
        app,
        inst.loader,
        &profile_key(&inst.id),
        &inst.name,
        &dir_name(&inst.name, &inst.id),
        &inst.mc_version,
        &lv,
        profile_icon(&server_dir),
        Some((&ip, &inst.name)),
        &mut |_| {},
    )
    .await?;

    let server_mods = server_dir.join("mods");
    let list = manifest::build(&server_mods, &mods::load_records(&meta), inst.loader);
    let wanted: Vec<Wanted> = list
        .iter()
        .map(|m| Wanted {
            file: m.file.clone(),
            sha1: m.sha1.clone(),
        })
        .collect();
    let src = server_mods.clone();
    let result = client::sync(&mods_dir, &inst.id, &wanted, shared, move |w, dest| {
        let from = src.join(&w.file);
        async move {
            std::fs::copy(from, dest)?;
            Ok(())
        }
    })
    .await?;
    Ok(ClientStatus {
        state: "ok",
        launcher: Some(launcher),
        pick: Some(pick),
        mods: list.len(),
        blocked: result.blocked,
        message: None,
    })
}

/// Ayar açıksa ve dünya modluysa eşitler; hata dünya işlemlerini bozmaz, durum olarak bildirilir.
pub async fn sync_host(app: &AppHandle, id: &str) {
    let Ok(inst) = instance::get(app, id) else {
        return;
    };
    if !inst.loader.is_modded() || !app.state::<SettingsStore>().get().client_sync {
        set(
            app,
            id,
            ClientStatus {
                state: "off",
                ..Default::default()
            },
        );
        return;
    }
    let _guard = SYNC.lock().await;
    set(
        app,
        id,
        ClientStatus {
            state: "working",
            ..Default::default()
        },
    );
    let status = match sync_host_inner(app, &inst).await {
        Ok(s) => s,
        Err(e) => ClientStatus {
            state: "error",
            message: Some(e.to_string()),
            ..Default::default()
        },
    };
    set(app, id, status);
}

pub fn spawn_sync(app: &AppHandle, id: &str) {
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move { sync_host(&app, &id).await });
}

#[derive(serde::Deserialize)]
struct StatusPayload {
    id: String,
    status: String,
}

/// Dünya açılınca da eşitle: TLauncher'ın ortak klasöründe o dünyanın modları etkin olsun.
pub fn install(app: &AppHandle) {
    let handle = app.clone();
    app.listen_any(EVENT_STATUS, move |event| {
        if let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload())
            && p.status == "starting"
        {
            spawn_sync(&handle, &p.id);
        }
    });
}

#[tauri::command]
pub fn client_status(states: State<'_, ClientStates>, id: String) -> ClientStatus {
    states
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
pub async fn client_resync(app: AppHandle, id: String) -> AppResult<()> {
    paths::validate_id(&id)?;
    sync_host(&app, &id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(profile_key("abc"), "mcsm-abc");
        assert_eq!(profile_name("Test"), "Test · MC Sunucu");
        assert_eq!(
            dir_name("Kardeşlerle survival", "3a08f417-66fc"),
            "kardeslerle-survival-3a08f417"
        );
    }
}
