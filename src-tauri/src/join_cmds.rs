//! Davet oluşturma (host) ve davetle katılma (katılımcı) komutları.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::client::manifest::{self, ClientMod, Need};
use crate::commands::{AppState, server_port};
use crate::error::{AppError, AppResult};
use crate::invite::{INVITE_VERSION, Invite, new_token};
use crate::join::{JoinManager, JoinStatus, JoinedWorld, client, servers_dat};
use crate::loaders::LoaderKind;
use crate::mods;
use crate::p2p::protocol::{Reply, StreamHeader, StreamKind};
use crate::p2p::{Decide, Decision, P2p};
use crate::server::ServerStatus;
use crate::sessions::META_DIR;
use crate::settings::SettingsStore;
use crate::{instance, paths};

type Joins<'a> = State<'a, Arc<JoinManager>>;

/// Uygulama açılırken link ile gelen, arayüz hazır olunca alınacak davet.
#[derive(Default)]
pub struct PendingInvite(pub Mutex<Option<String>>);

/// Host: gelen bir akışı kabul eder mi; neye (Minecraft portu, mod listesi, mod dosyası) yönlendirilir?
pub fn host_decider(app: AppHandle) -> Decide {
    Arc::new(move |h: &StreamHeader| {
        let Ok(inst) = instance::get(&app, &h.world) else {
            return Decision::Reply(Reply::Denied);
        };
        if inst.invite_token.as_deref() != Some(h.token.as_str()) {
            return Decision::Reply(Reply::Denied);
        }
        let (Ok(server_dir), Ok(inst_dir)) = (
            paths::server_dir(&app, &h.world),
            paths::instance_dir(&app, &h.world),
        ) else {
            return Decision::Reply(Reply::Denied);
        };
        let running =
            app.state::<AppState>().servers.snapshot(&h.world).status == ServerStatus::Running;
        let modded = inst.loader.is_modded();
        let server_mods = server_dir.join("mods");
        let records = || mods::load_records(&inst_dir.join(META_DIR));
        let light = || {
            if modded {
                manifest::build_with(&server_mods, &records(), inst.loader, false)
            } else {
                Vec::new()
            }
        };
        let ok = |mods_rev| Reply::Ok {
            running,
            name: inst.name.clone(),
            mods_rev,
        };
        match h.kind {
            StreamKind::Ping => Decision::Reply(ok(modded.then(|| manifest::rev(&light())))),
            StreamKind::Tcp if running => {
                Decision::Tcp(ok(None), server_port(&server_dir, inst.port))
            }
            StreamKind::Tcp => Decision::Reply(Reply::Offline),
            StreamKind::Manifest => {
                let list = if modded {
                    manifest::build(&server_mods, &records(), inst.loader)
                } else {
                    Vec::new()
                };
                Decision::Body(ok(None), serde_json::to_vec(&list).unwrap_or_default())
            }
            StreamKind::File => {
                // Yalnız oyuncuya giden listedeki, güvenli adlı bir dosya.
                let allowed = h
                    .file
                    .as_deref()
                    .and_then(mods::sanitize_filename)
                    .filter(|f| light().iter().any(|m| &m.file == f));
                match allowed {
                    Some(f) => Decision::File(ok(None), server_mods.join(f)),
                    None => Decision::Reply(Reply::Denied),
                }
            }
        }
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteLinks {
    code: String,
    link: String,
}

fn invite_for(app: &AppHandle, id: &str, reset: bool) -> AppResult<InviteLinks> {
    let dir = paths::instance_dir(app, id)?;
    let inst = instance::modify(&dir, |i| {
        if reset || i.invite_token.is_none() {
            i.invite_token = Some(new_token());
        }
        Ok(())
    })?;
    let invite = Invite {
        v: INVITE_VERSION,
        name: inst.name.chars().take(64).collect(),
        host: app.state::<Arc<P2p>>().id(),
        world: inst.id.clone(),
        token: inst.invite_token.clone().unwrap_or_default(),
        loader: inst.loader,
        mc_version: inst.mc_version.clone(),
        loader_version: inst.loader_version.clone(),
    };
    Ok(InviteLinks {
        code: invite.encode(),
        link: invite.link(),
    })
}

#[tauri::command]
pub fn create_invite(app: AppHandle, id: String) -> AppResult<InviteLinks> {
    invite_for(&app, &id, false)
}

/// Yeni anahtar üretir; eski linkler ve kodlar geçersiz olur.
#[tauri::command]
pub fn reset_invite(app: AppHandle, id: String) -> AppResult<InviteLinks> {
    invite_for(&app, &id, true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitePreview {
    name: String,
    loader: LoaderKind,
    mc_version: String,
    loader_version: Option<String>,
    /// Host'a ulaşıldı mı, dünyası açık mı.
    status: JoinStatus,
    /// Bu bilgisayarın kendi dünyası.
    own: bool,
    /// Daha önce katılınmış (güncellenecek).
    already_joined: bool,
    minecraft_dir: Option<String>,
    minecraft_running: bool,
    required_version: String,
    version_installed: bool,
    /// Modlu dünyada oyuncuda eksik modlar (arkadaşına ulaşılabildiyse).
    mods: Option<ModCheck>,
    mods_error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModItem {
    title: String,
    size: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModCheck {
    launcher: Option<crate::client::Launcher>,
    /// Olmadan girilemeyecek, eksik olanlar.
    required: Vec<ModItem>,
    /// Önerilen, eksik olanlar.
    recommended: Vec<ModItem>,
}

/// Katılınan dünyanın profil anahtarı/klasörü: host + dünyadan türetilir (önizlemede de aynı çıkar).
fn join_key(host: &str, world: &str) -> String {
    crate::hash::hash_bytes(
        crate::hash::HashAlgo::Sha1,
        format!("{host}:{world}").as_bytes(),
    )[..12]
        .to_string()
}

/// Oyuncunun hedef mods klasöründe (profil ya da TLauncher ortak klasörü) olmayanlar.
fn missing_mods(
    app: &AppHandle,
    name: &str,
    host: &str,
    world: &str,
    list: &[ClientMod],
) -> ModCheck {
    let mc = minecraft_dir(app);
    let launcher = mc.as_deref().and_then(crate::client::detect_launcher);
    let have: std::collections::HashSet<String> = match (&mc, launcher) {
        (Some(mc), Some(l)) => {
            let dir = crate::client_cmds::dir_name(name, &join_key(host, world));
            let (_, mods_dir) = crate::client::targets(mc, l, &dir);
            let mut have: std::collections::HashSet<String> =
                mods::scan(&mods_dir).into_iter().map(|(_, s)| s).collect();
            have.extend(
                mods::scan(&mods_dir.join("_disabled"))
                    .into_iter()
                    .map(|(_, s)| s),
            );
            have
        }
        _ => Default::default(),
    };
    let item = |m: &ClientMod| ModItem {
        title: m.title.clone(),
        size: m.size,
    };
    ModCheck {
        launcher,
        required: list
            .iter()
            .filter(|m| m.need == Need::Required && !have.contains(&m.sha1))
            .map(item)
            .collect(),
        recommended: list
            .iter()
            .filter(|m| m.need == Need::Recommended && !have.contains(&m.sha1))
            .map(item)
            .collect(),
    }
}

fn minecraft_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.state::<SettingsStore>()
        .minecraft_dir()
        .filter(|d| d.is_dir())
}

#[tauri::command]
pub async fn preview_invite(
    app: AppHandle,
    joins: Joins<'_>,
    code: String,
) -> AppResult<InvitePreview> {
    let invite = Invite::parse(&code)?;
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let own = invite.host == p2p.id();
    let status = if own {
        JoinStatus::default()
    } else {
        let host = invite
            .host
            .parse()
            .map_err(|_| AppError::msg("Davet bozuk."))?;
        crate::join::status_from(p2p.ping(host, &invite.world, &invite.token).await)
    };
    let (mods, mods_error) = if !own && invite.loader.is_modded() && status.reachable == Some(true)
    {
        let host = invite
            .host
            .parse()
            .map_err(|_| AppError::msg("Davet bozuk."))?;
        match p2p.manifest(host, &invite.world, &invite.token).await {
            Ok(list) => (
                Some(missing_mods(
                    &app,
                    &invite.name,
                    &invite.host,
                    &invite.world,
                    &list,
                )),
                None,
            ),
            Err(e) => (None, Some(e.to_string())),
        }
    } else {
        (None, None)
    };
    let mc = minecraft_dir(&app);
    let required = client::required_version(
        invite.loader,
        &invite.mc_version,
        invite.loader_version.as_deref(),
    );
    Ok(InvitePreview {
        already_joined: joins.find(&invite.host, &invite.world).await.is_some(),
        version_installed: mc
            .as_deref()
            .is_some_and(|d| client::version_installed(d, &required)),
        minecraft_dir: mc.map(|d| d.display().to_string()),
        minecraft_running: client::minecraft_running(),
        required_version: required,
        name: invite.name,
        loader: invite.loader,
        mc_version: invite.mc_version,
        loader_version: invite.loader_version,
        status,
        own,
        mods,
        mods_error,
    })
}

/// Sunucu listesinin yazılacağı klasör: modlar kurulduysa profilin oyun klasörü, değilse ana klasör.
fn entry_dir(app: &AppHandle, w: &JoinedWorld) -> Option<std::path::PathBuf> {
    w.game_dir
        .as_ref()
        .map(std::path::PathBuf::from)
        .filter(|d| d.is_dir())
        .or_else(|| minecraft_dir(app))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload<'a> {
    id: &'a str,
    title: &'a str,
    index: usize,
    count: usize,
}

pub const EVENT_PROGRESS: &str = "join://progress";

/// Arkadaşın dünyasının modlarını oyuncunun Minecraft'ına kurar: mod altyapısı + profil + modlar.
/// Önce Modrinth'ten (sha512 listeyle eşleşmeli), yoksa arkadaşın bilgisayarından indirilir.
async fn install_client_mods(
    app: &AppHandle,
    w: &JoinedWorld,
    list: Vec<ClientMod>,
    with_recommended: bool,
) -> AppResult<JoinedWorld> {
    let wanted_mods: Vec<ClientMod> = list
        .iter()
        .filter(|m| m.need == Need::Required || with_recommended)
        .cloned()
        .collect();
    let lv = w.loader_version.clone().ok_or_else(|| {
        AppError::msg(format!(
            "Arkadaşının {} sürümü bilinmiyor.",
            w.loader.label()
        ))
    })?;
    let key = join_key(&w.host, &w.world);
    let count = wanted_mods.len();
    let mut announced = false;
    let (launcher, mods_dir, shared, pick) = crate::client_cmds::prepare_client(
        app,
        w.loader,
        &format!("mcsm-join-{key}"),
        &w.name,
        &crate::client_cmds::dir_name(&w.name, &key),
        &w.mc_version,
        &lv,
        "Furnace".into(),
        Some((&w.address(), &w.name)),
        // NeoForge/Forge installer'ı çalışırken (birkaç dakika) pencere boş kalmasın.
        &mut |_| {
            if !announced {
                announced = true;
                let _ = app.emit(
                    EVENT_PROGRESS,
                    ProgressPayload {
                        id: &w.id,
                        title: w.loader.label(),
                        index: 0,
                        count,
                    },
                );
            }
        },
    )
    .await?;
    let game_dir = match launcher {
        crate::client::Launcher::Official => mods_dir.parent().map(|p| p.display().to_string()),
        crate::client::Launcher::TLauncher => None,
    };

    let wanted: Vec<crate::client::Wanted> = wanted_mods
        .iter()
        .map(|m| crate::client::Wanted {
            file: m.file.clone(),
            sha1: m.sha1.clone(),
        })
        .collect();
    let http = app.state::<AppState>().http.clone();
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let host: iroh::EndpointId = w.host.parse().map_err(|_| AppError::msg("Davet bozuk."))?;
    let (world, token, id) = (w.world.clone(), w.token.clone(), w.id.clone());
    let all = Arc::new(wanted_mods);
    let mut index = 0usize;
    let app2 = app.clone();
    crate::client::sync(&mods_dir, &key, &wanted, shared, move |want, dest| {
        let (http, p2p, all, world, token, id, app) = (
            http.clone(),
            p2p.clone(),
            all.clone(),
            world.clone(),
            token.clone(),
            id.clone(),
            app2.clone(),
        );
        index += 1;
        let i = index;
        async move {
            let m = all
                .iter()
                .find(|m| m.sha1 == want.sha1)
                .cloned()
                .ok_or_else(|| AppError::msg("Mod listede yok."))?;
            let _ = app.emit(
                EVENT_PROGRESS,
                ProgressPayload {
                    id: &id,
                    title: &m.title,
                    index: i,
                    count,
                },
            );
            // Modrinth'te aynı dosya varsa oradan (hızlı, arkadaşının bağlantısını yormaz).
            if let Some(vid) = &m.version_id {
                let api = crate::modrinth::Modrinth::new(&http);
                if let Ok(v) = api.version(vid).await
                    && let Some(f) = v.files.iter().find(|f| f.hashes.sha512 == m.sha512)
                {
                    let ok = crate::download::download_file(
                        &http,
                        &f.url,
                        &dest,
                        Some((crate::hash::HashAlgo::Sha512, &m.sha512)),
                        |_, _| {},
                    )
                    .await;
                    if ok.is_ok() {
                        return Ok(());
                    }
                }
            }
            p2p.fetch_file(host, &world, &token, &m.file, &dest, m.size)
                .await?;
            let got =
                crate::hash::hash_bytes(crate::hash::HashAlgo::Sha512, &std::fs::read(&dest)?);
            if got != m.sha512 {
                let _ = std::fs::remove_file(&dest);
                return Err(AppError::msg(format!(
                    "{} doğrulanamadı (hash tutmadı).",
                    m.title
                )));
            }
            Ok(())
        }
    })
    .await?;

    let rev = manifest::rev(&list);
    app.state::<Arc<JoinManager>>()
        .update(&w.id, |x| {
            x.profile = Some(pick);
            x.game_dir = game_dir;
            x.mods_rev = Some(rev);
            x.with_recommended = with_recommended;
        })
        .await
}

fn add_server_entry(app: &AppHandle, w: &JoinedWorld, force: bool) -> AppResult<()> {
    if !force && client::minecraft_running() {
        return Err(AppError::msg(
            "Minecraft açık. Kapatmazsan sunucu listesine eklediğimiz kayıt silinebilir; önce oyunu kapat.",
        ));
    }
    let dir = entry_dir(app, w).ok_or_else(|| {
        AppError::msg("Minecraft klasörü bulunamadı. Ayarlar'dan Minecraft klasörünü seç.")
    })?;
    let mut root = servers_dat::read(&dir)?;
    servers_dat::upsert(&mut root, &w.address(), &w.name);
    servers_dat::write(&dir, &root)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinedView {
    world: JoinedWorld,
    status: JoinStatus,
    address: String,
}

async fn view(joins: &JoinManager, w: JoinedWorld) -> JoinedView {
    JoinedView {
        status: joins.status(&w.id).await,
        address: w.address(),
        world: w,
    }
}

/// Onaydan sonra: kaydet, dinlemeye başla, Minecraft sunucu listesine ekle.
#[tauri::command]
pub async fn join_world(
    app: AppHandle,
    joins: Joins<'_>,
    code: String,
    force: bool,
    install_recommended: bool,
) -> AppResult<JoinedView> {
    let invite = Invite::parse(&code)?;
    if invite.host == app.state::<Arc<P2p>>().id() {
        return Err(AppError::msg(
            "Bu senin kendi dünyan; davet arkadaşın için.",
        ));
    }
    if !force && client::minecraft_running() {
        return Err(AppError::msg(
            "Minecraft açık. Kapatmazsan sunucu listesine eklediğimiz kayıt silinebilir; önce oyunu kapat.",
        ));
    }
    let mut joined = joins.inner().join(&app, &invite).await?;
    // Modlu dünya: oyuncuda gereken modlar varsa profile kur (yoksa sunucu listesi ana klasöre).
    if invite.loader.is_modded() {
        let p2p = app.state::<Arc<P2p>>().inner().clone();
        let host = invite
            .host
            .parse()
            .map_err(|_| AppError::msg("Davet bozuk."))?;
        if let Ok(list) = p2p.manifest(host, &invite.world, &invite.token).await {
            let wants_any = list
                .iter()
                .any(|m| m.need == Need::Required || install_recommended);
            if wants_any {
                joined = install_client_mods(&app, &joined, list, install_recommended).await?;
            }
        }
    }
    if joined.profile.is_none() {
        add_server_entry(&app, &joined, true)?;
    }
    Ok(view(&joins, joined).await)
}

#[tauri::command]
pub async fn list_joined(joins: Joins<'_>) -> AppResult<Vec<JoinedView>> {
    let mut out = Vec::new();
    for w in joins.list().await {
        out.push(view(&joins, w).await);
    }
    Ok(out)
}

/// Listeden ve Minecraft'ın sunucu listesinden kaldırır.
#[tauri::command]
pub async fn remove_joined(app: AppHandle, joins: Joins<'_>, id: String) -> AppResult<()> {
    let removed = joins.remove(&id).await?;
    if let Some(dir) = entry_dir(&app, &removed) {
        let mut root = servers_dat::read(&dir)?;
        if servers_dat::remove(&mut root, &removed.address()) {
            servers_dat::write(&dir, &root)?;
        }
    }
    // Profil ve doğrudan bağlanan sürüm (resmi Launcher) ya da ortak klasördeki bu dünyanın
    // modları (TLauncher) kaldırılır.
    if let Some(mc) = minecraft_dir(&app) {
        let key = join_key(&removed.host, &removed.world);
        crate::client::remove_version(
            &mc,
            &crate::client::quickplay_id(&crate::client_cmds::dir_name(&removed.name, &key)),
        );
        match crate::client::detect_launcher(&mc) {
            Some(crate::client::Launcher::Official) => {
                crate::client::edit_profiles(&mc, |root| {
                    crate::client::remove_profile(root, &format!("mcsm-join-{key}"));
                })?;
            }
            Some(crate::client::Launcher::TLauncher) if removed.profile.is_some() => {
                crate::client::sync(&mc.join("mods"), &key, &[], true, |_, _| async { Ok(()) })
                    .await?;
            }
            _ => {}
        }
    }
    Ok(())
}

/// "Oyna": sunucu listesi kaydı, dünyanın profili (doğrudan bağlanan sürümle) ve Launcher'ı açma.
#[tauri::command]
pub async fn play_joined(
    app: AppHandle,
    joins: Joins<'_>,
    id: String,
) -> AppResult<crate::client_cmds::LaunchResult> {
    use crate::client_cmds::{
        dir_name, play_version, prepare_direct, prepare_plain, start_or_fallback, write_profile,
    };
    let w = joins.get(&id).await?;
    if let Some(dir) = entry_dir(&app, &w) {
        let mut root = servers_dat::read(&dir)?;
        if !servers_dat::contains(&mut root, &w.address()) {
            add_server_entry(&app, &w, false)?;
        }
    }
    let key = join_key(&w.host, &w.world);
    let profile_key = format!("mcsm-join-{key}");
    let dir = dir_name(&w.name, &key);
    let (launcher, pick) = match (&w.profile, &w.loader_version) {
        // Modlar kuruldu: profil ve mod altyapısının sürümü zaten var.
        (Some(_), Some(lv)) if w.loader.is_modded() => {
            let mc = crate::client_cmds::minecraft_dir(&app)?;
            let launcher = crate::client::detect_launcher(&mc)
                .ok_or_else(|| AppError::msg("Minecraft Launcher bulunamadı."))?;
            let base = crate::client::version_id(w.loader, &w.mc_version, lv)
                .ok_or_else(|| AppError::msg("Dünyanın sürümü bilinmiyor."))?;
            let version = play_version(&mc, &dir, &w.mc_version, &base, Some(&w.address()))?;
            let game_dir = w.game_dir.as_deref().map(std::path::Path::new);
            let pick = write_profile(
                &mc,
                launcher,
                &profile_key,
                &w.name,
                &version,
                game_dir,
                "Furnace",
            )?;
            (launcher, pick)
        }
        _ => prepare_plain(
            &app,
            &profile_key,
            &w.name,
            &dir,
            &w.mc_version,
            "Furnace",
            &w.address(),
        )?,
    };
    // Giriş varsa oyun Launcher'sız, doğrudan dünyaya bağlanarak açılır.
    let direct = if crate::game_cmds::direct_available(&app, &w.mc_version) {
        let game_dir = w.game_dir.as_ref().map(std::path::PathBuf::from);
        Some(prepare_direct(&app, &dir, game_dir).await)
    } else {
        None
    };
    Ok(start_or_fallback(
        &app,
        direct,
        launcher,
        pick,
        &w.mc_version,
    ))
}

#[tauri::command]
pub async fn readd_server_entry(
    app: AppHandle,
    joins: Joins<'_>,
    id: String,
    force: bool,
) -> AppResult<()> {
    let w = joins.get(&id).await?;
    add_server_entry(&app, &w, force)
}

/// Sunucu listesinde bu dünyanın kaydı var mı?
#[tauri::command]
pub async fn server_entry_exists(app: AppHandle, joins: Joins<'_>, id: String) -> AppResult<bool> {
    let w = joins.get(&id).await?;
    let Some(dir) = entry_dir(&app, &w) else {
        return Ok(false);
    };
    let mut root = servers_dat::read(&dir)?;
    Ok(servers_dat::contains(&mut root, &w.address()))
}

#[tauri::command]
pub async fn refresh_joined(app: AppHandle, joins: Joins<'_>, id: String) -> AppResult<JoinedView> {
    let w = joins.get(&id).await?;
    joins.poll(&app, &w).await;
    Ok(view(&joins, w).await)
}

/// Arkadaşın modları değiştirdiyse (yeni mod, güncelleme) oyuncunun profilini yeniden eşitler.
#[tauri::command]
pub async fn update_joined_mods(
    app: AppHandle,
    joins: Joins<'_>,
    id: String,
) -> AppResult<JoinedView> {
    let w = joins.get(&id).await?;
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let host = w.host.parse().map_err(|_| AppError::msg("Davet bozuk."))?;
    let list = p2p.manifest(host, &w.world, &w.token).await?;
    let updated =
        install_client_mods(&app, &w, list, w.with_recommended || w.profile.is_none()).await?;
    Ok(view(&joins, updated).await)
}

#[tauri::command]
pub fn take_pending_invite(pending: State<'_, PendingInvite>) -> Option<String> {
    pending.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}
