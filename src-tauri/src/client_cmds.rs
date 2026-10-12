//! Host: kendi dünyasının oyuncuda gereken modları kendi Minecraft'ına (dünyaya özel profile) kurulur.
//! "Başlat ve katıl": profil hazırlanır, sunucu açılınca Launcher açılır; oyun doğrudan dünyaya bağlanır.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

use crate::client::{self, Launcher, ProfileSpec, Wanted, launch, manifest};
use crate::commands::{AppState, server_port};
use crate::covers::SERVER_ICON;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::java::JavaManager;
use crate::join::servers_dat;
use crate::loaders::LoaderKind;
use crate::mods;
use crate::paths;
use crate::server::{EVENT_STATUS, ServerStatus};
use crate::sessions::META_DIR;
use crate::settings::SettingsStore;
use crate::util::{iso_utc, now_ms};

pub const EVENT_STATUS_CLIENT: &str = "client://status";
pub const EVENT_LAUNCH: &str = "client://launch";

/// "Başlat ve katıl" sunucunun açılmasını en fazla bu kadar bekler (büyük mod paketleri yavaş açılır).
const JOIN_WAIT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

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

/// Launcher'ı açma sonucu; arayüz buna göre ipucu gösterir.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub opened: bool,
    pub launcher: Option<Launcher>,
    /// Launcher'da seçilecek profil (resmi Launcher) ya da sürüm (TLauncher).
    pub pick: Option<String>,
    /// Launcher zaten açıktı: profil seçimini yeni dosyadan okumamış olabilir.
    pub was_running: bool,
    /// Oyun menüye uğramadan dünyaya bağlanacak mı (Minecraft 1.20+).
    pub direct: bool,
    /// Oyun Launcher'sız, doğrudan açıldı (Microsoft girişiyle).
    pub game: bool,
    /// Doğrudan açılamadı, Launcher'a düşüldü: nedeni.
    pub note: Option<String>,
    pub error: Option<String>,
}

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
    format!("{world} · Cubby")
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
    let version = play_version(
        &mc,
        dir,
        mc_version,
        &version_id,
        server_entry.map(|(ip, _)| ip),
    )?;
    let (game_dir, mods_dir) = client::targets(&mc, launcher, dir);
    if launcher == Launcher::Official {
        client::prepare_game_dir(&mc, &game_dir)?;
    }
    let pick = write_profile(
        &mc,
        launcher,
        key,
        world_name,
        &version,
        Some(&game_dir),
        &icon,
    )?;
    if let Some((ip, name)) = server_entry {
        let mut root = servers_dat::read(&game_dir)?;
        servers_dat::upsert(&mut root, ip, name);
        servers_dat::write(&game_dir, &root)?;
    }
    Ok((launcher, mods_dir, launcher == Launcher::TLauncher, pick))
}

/// Oyunu doğrudan dünyaya bağlayan sürüm (1.20+), yoksa asıl sürüm.
pub fn play_version(
    mc: &Path,
    dir: &str,
    mc_version: &str,
    base: &str,
    addr: Option<&str>,
) -> AppResult<String> {
    match addr {
        Some(addr) if client::quickplay_supported(mc_version) => {
            client::ensure_quickplay_version(mc, &client::quickplay_id(dir), base, addr)
        }
        _ => Ok(base.to_string()),
    }
}

/// Resmi Launcher'da dünyanın profilini yazar (seçili açılsın); TLauncher'da seçilecek sürümü döner.
pub fn write_profile(
    mc: &Path,
    launcher: Launcher,
    key: &str,
    world_name: &str,
    version: &str,
    game_dir: Option<&Path>,
    icon: &str,
) -> AppResult<String> {
    match launcher {
        Launcher::Official => {
            let now = iso_utc(now_ms());
            let name = profile_name(world_name);
            client::edit_profiles(mc, |root| {
                client::upsert_profile(
                    root,
                    &ProfileSpec {
                        key,
                        name: &name,
                        version_id: version,
                        game_dir,
                        icon,
                        now: &now,
                    },
                )
            })?;
            Ok(name)
        }
        Launcher::TLauncher => Ok(version.to_string()),
    }
}

/// Modsuz dünya: oyuncunun normal `.minecraft`'ıyla açılan, doğrudan `addr`'e bağlanan profil.
pub fn prepare_plain(
    app: &AppHandle,
    key: &str,
    world_name: &str,
    dir: &str,
    mc_version: &str,
    icon: &str,
    addr: &str,
) -> AppResult<(Launcher, String)> {
    let mc = minecraft_dir(app)?;
    let launcher = client::detect_launcher(&mc).ok_or_else(|| {
        AppError::msg("Minecraft Launcher ya da TLauncher bulunamadı. Minecraft'ı en az bir kez açtıktan sonra tekrar dene.")
    })?;
    let version = play_version(&mc, dir, mc_version, mc_version, Some(addr))?;
    let pick = write_profile(&mc, launcher, key, world_name, &version, None, icon)?;
    Ok((launcher, pick))
}

/// Launcher'ı açar ve sonucu döner.
pub fn launch_now(launcher: Launcher, pick: String, mc_version: &str) -> LaunchResult {
    let was_running = launch::launcher_running();
    LaunchResult {
        opened: launch::open_launcher(launcher),
        launcher: Some(launcher),
        pick: Some(pick),
        was_running,
        direct: client::quickplay_supported(mc_version),
        ..Default::default()
    }
}

/// Oyunu Launcher'sız açar; olmazsa Launcher'ı açıp nedenini not düşer.
pub fn start_or_fallback(
    app: &AppHandle,
    direct: Option<AppResult<crate::game_cmds::Prepared>>,
    launcher: Launcher,
    pick: String,
    mc_version: &str,
) -> LaunchResult {
    let failed = match direct {
        None => None,
        Some(Ok(p)) => match crate::game_cmds::start(app, p) {
            Ok(()) => {
                return LaunchResult {
                    launcher: Some(launcher),
                    pick: Some(pick),
                    direct: true,
                    game: true,
                    ..Default::default()
                };
            }
            Err(e) => Some(e.to_string()),
        },
        Some(Err(e)) => Some(e.to_string()),
    };
    LaunchResult {
        note: failed,
        ..launch_now(launcher, pick, mc_version)
    }
}

/// Doğrudan açılacak oyunun sürümü (`mcsm-<ad>`) ve oyun klasörü hazırlanır (dosyalar, Java).
/// `game_dir` yoksa oyuncunun normal `.minecraft`'ı.
pub async fn prepare_direct(
    app: &AppHandle,
    dir: &str,
    game_dir: Option<PathBuf>,
) -> AppResult<crate::game_cmds::Prepared> {
    let mc = minecraft_dir(app)?;
    let game_dir = game_dir.unwrap_or_else(|| mc.clone());
    crate::game_cmds::prepare(app, &mc, &client::quickplay_id(dir), &game_dir).await
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
    sync_host_with(app, id, false).await;
}

/// `force`: ayar kapalı olsa da (oyuncu "Başlat ve katıl" dedi). Son durumu döner.
async fn sync_host_with(app: &AppHandle, id: &str, force: bool) -> ClientStatus {
    let Ok(inst) = instance::get(app, id) else {
        return ClientStatus::default();
    };
    if !inst.loader.is_modded() || !(force || app.state::<SettingsStore>().get().client_sync) {
        let off = ClientStatus {
            state: "off",
            ..Default::default()
        };
        set(app, id, off.clone());
        return off;
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
    set(app, id, status.clone());
    status
}

/// Host'un kendi dünyasına girmesi için profil: modluda eşitleme, modsuzda düz profil.
async fn prepare_play(app: &AppHandle, inst: &Instance) -> AppResult<(Launcher, String)> {
    if inst.loader.is_modded() {
        let s = sync_host_with(app, &inst.id, true).await;
        return match (s.state, s.launcher, s.pick) {
            ("ok", Some(l), Some(p)) => Ok((l, p)),
            _ => Err(AppError::msg(
                s.message
                    .unwrap_or_else(|| "Minecraft'ın hazırlanamadı.".into()),
            )),
        };
    }
    let server_dir = paths::server_dir(app, &inst.id)?;
    let port = server_port(&server_dir, inst.port);
    prepare_plain(
        app,
        &profile_key(&inst.id),
        &inst.name,
        &dir_name(&inst.name, &inst.id),
        &inst.mc_version,
        &profile_icon(&server_dir),
        &format!("localhost:{port}"),
    )
}

#[derive(Serialize, Clone)]
struct LaunchPayload<'a> {
    id: &'a str,
    result: &'a LaunchResult,
}

/// "Başlat ve katıl": profil sunucu açılırken hazırlanır; sunucu hazır olunca (Done) Launcher açılır.
/// Sunucu durur ya da çökerse vazgeçilir.
pub fn join_after_start(app: &AppHandle, id: &str) {
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move {
        let Ok(inst) = instance::get(&app, &id) else {
            return;
        };
        let prepared = prepare_play(&app, &inst).await;
        // Oyun Launcher'sız açılabiliyorsa dosyaları sunucu açılırken hazırlanır.
        let direct = match &prepared {
            Ok((launcher, _)) if crate::game_cmds::direct_available(&app, &inst.mc_version) => {
                let dir = dir_name(&inst.name, &inst.id);
                let game_dir = match (inst.loader.is_modded(), minecraft_dir(&app)) {
                    (true, Ok(mc)) => Some(client::targets(&mc, *launcher, &dir).0),
                    _ => None,
                };
                Some(prepare_direct(&app, &dir, game_dir).await)
            }
            _ => None,
        };
        let started = std::time::Instant::now();
        loop {
            match app.state::<AppState>().servers.snapshot(&id).status {
                ServerStatus::Running => break,
                ServerStatus::Stopped | ServerStatus::Crashed => return,
                _ if started.elapsed() > JOIN_WAIT => return,
                _ => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
            }
        }
        let result = match prepared {
            Ok((launcher, pick)) => {
                start_or_fallback(&app, direct, launcher, pick, &inst.mc_version)
            }
            Err(e) => LaunchResult {
                error: Some(e.to_string()),
                ..Default::default()
            },
        };
        let _ = app.emit(
            EVENT_LAUNCH,
            LaunchPayload {
                id: &id,
                result: &result,
            },
        );
    });
}

/// Dünya silinince profili ve doğrudan bağlanan sürümü kaldırır (oyun klasörüne dokunulmaz).
pub fn forget_world(app: &AppHandle, inst: &Instance) {
    let Ok(mc) = minecraft_dir(app) else {
        return;
    };
    client::remove_version(&mc, &client::quickplay_id(&dir_name(&inst.name, &inst.id)));
    if client::detect_launcher(&mc) == Some(Launcher::Official) {
        let _ = client::edit_profiles(&mc, |root| {
            client::remove_profile(root, &profile_key(&inst.id));
        });
    }
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
        assert_eq!(profile_name("Test"), "Test · Cubby");
        assert_eq!(
            dir_name("Kardeşlerle survival", "3a08f417-66fc"),
            "kardeslerle-survival-3a08f417"
        );
    }
}
