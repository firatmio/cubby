//! Davet oluşturma (host) ve davetle katılma (katılımcı) komutları.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

use crate::client::manifest::{self, ClientMod, Need};
use crate::commands::{AppState, server_port};
use crate::error::{AppError, AppResult};
use crate::invite::{INVITE_VERSION, Invite, new_token};
use crate::join::{JoinManager, JoinStatus, JoinedWorld, client, servers_dat};
use crate::loaders::LoaderKind;
use crate::mods;
use crate::p2p::protocol::{Reply, StreamHeader, StreamKind};
use crate::p2p::{Decide, Decision, Guard, P2p};
use crate::players_guard::{self, Check};
use crate::server::ServerStatus;
use crate::sessions::META_DIR;
use crate::settings::SettingsStore;
use crate::short_invite::{self, ShortInvite};
use crate::{instance, paths};

type Joins<'a> = State<'a, Arc<JoinManager>>;

/// Uygulama açılırken link ile gelen, arayüz hazır olunca alınacak davet.
#[derive(Default)]
pub struct PendingInvite(pub Mutex<Option<String>>);

/// Davetle gelen oyuncunun girişi: cihaz yasaklıysa ya da (premium olmayan dünyada) ad başka bir
/// cihaza ya da dünyanın sahibine aitse oyuncu bir mesajla geri çevrilir (`players_guard`).
fn login_guard(
    app: &AppHandle,
    server_dir: &std::path::Path,
    meta: &std::path::Path,
    peer: &str,
) -> Guard {
    let offline = crate::properties::Properties::load(server_dir)
        .ok()
        .and_then(|p| p.get_bool("online-mode"))
        == Some(false);
    let host = crate::invite_live::player_name(app);
    let (meta, device) = (meta.to_path_buf(), peer.to_string());
    Arc::new(move |name: &str| {
        let check = players_guard::update(&meta, |ids| {
            ids.check(
                name,
                &device,
                offline,
                host.as_deref(),
                crate::util::now_ms(),
            )
        })
        .unwrap_or_else(|e| {
            // Kayıt yazılamazsa arkadaşlar dışarıda kalmasın; yasak yine okunur.
            eprintln!("Kimlik kaydı yazılamadı: {e}");
            if players_guard::load(&meta)
                .banned
                .iter()
                .any(|b| b.device == device)
            {
                Check::Banned
            } else {
                Check::Pass
            }
        });
        match check {
            Check::Pass => None,
            Check::NameTaken => Some(
                tx!(
                    "Bu ad başka bir arkadaşının cihazına bağlı. Dünyanın sahibinden bağı kaldırmasını iste ya da başka bir adla gir.",
                    "This name belongs to another friend's device. Ask the world's owner to remove the link, or join with a different name."
                )
                .to_string(),
            ),
            Check::Banned => Some(
                tx!(
                    "Bu dünyaya girmen engellendi.",
                    "You've been banned from this world."
                )
                .to_string(),
            ),
        }
    })
}

/// Host: gelen bir akışı kabul eder mi; neye (Minecraft portu, mod listesi, mod dosyası) yönlendirilir?
pub fn host_decider(app: AppHandle) -> Decide {
    Arc::new(move |h: &StreamHeader, peer: &str| {
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
        let meta = inst_dir.join(META_DIR);
        // Mod paketinin yalnız oyuncuda çalışan modları sunucuda yok; ekstralardan gider.
        let extras = meta.join(crate::content::EXTRAS_DIR);
        let pack_client = || crate::content::Record::load(&meta).pack_client;
        let list = |full: bool| {
            if !modded {
                return Vec::new();
            }
            let mut list =
                manifest::build_with(&server_mods, &mods::load_records(&meta), inst.loader, full);
            for m in manifest::pack_client(&extras, &pack_client(), full) {
                if !list.iter().any(|x| x.sha1 == m.sha1 || x.file == m.file) {
                    list.push(m);
                }
            }
            list
        };
        let light = || list(false);
        // Arkadaşta da aynı arka plan ve güncel davet kodu görünsün.
        let cover_file = meta.join(crate::covers::COVER_FILE);
        let cover = inst
            .cover
            .as_ref()
            .filter(|_| cover_file.is_file())
            .map(|c| c.version);
        let code = inst
            .short_invite
            .as_ref()
            .filter(|s| Some(&s.token) == inst.invite_token.as_ref())
            .map(|s| short_invite::format(&s.code));
        let ok = |mods_rev| Reply::Ok {
            running,
            name: inst.name.clone(),
            mods_rev,
            cover,
            code: code.clone(),
        };
        match h.kind {
            StreamKind::Ping => Decision::Reply(ok(modded.then(|| manifest::rev(&light())))),
            StreamKind::Tcp if running => Decision::Tcp(
                ok(None),
                server_port(&server_dir, inst.port),
                Some(login_guard(&app, &server_dir, &meta, peer)),
            ),
            StreamKind::Tcp => Decision::Reply(Reply::Offline),
            StreamKind::Manifest => Decision::Body(
                ok(None),
                serde_json::to_vec(&list(true)).unwrap_or_default(),
            ),
            StreamKind::Cover if cover.is_some() => Decision::File(ok(None), cover_file.clone()),
            StreamKind::Cover => Decision::Reply(Reply::Denied),
            // Ortak dünya akışları: dünya paylaşılınca yalnız gruptaki cihazlara açılacak.
            StreamKind::WorldManifest | StreamKind::WorldBlocks | StreamKind::WorldRead => {
                Decision::Reply(Reply::Denied)
            }
            StreamKind::File => {
                // Yalnız oyuncuya giden listedeki, güvenli adlı bir dosya.
                let allowed = h
                    .file
                    .as_deref()
                    .and_then(mods::sanitize_filename)
                    .filter(|f| light().iter().any(|m| &m.file == f));
                match allowed {
                    Some(f) if server_mods.join(&f).is_file() => {
                        Decision::File(ok(None), server_mods.join(f))
                    }
                    Some(f) => Decision::File(ok(None), extras.join(f)),
                    None => Decision::Reply(Reply::Denied),
                }
            }
        }
    })
}

/// Paylaşılan tek şey kısa kod (`K7M-2QX`) ya da onun web linki; alınamadıysa ikisi de `None`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InviteLinks {
    short: Option<String>,
    web: Option<String>,
}

/// Kısa kod kendiliğinden yenilendi (süresi dolmuştu): açık panel güncellensin.
pub const EVENT_SHORT: &str = "invite://short";

#[derive(Serialize, Clone)]
struct ShortPayload {
    id: String,
    links: InviteLinks,
}

fn invite_of(app: &AppHandle, inst: &instance::Instance) -> Invite {
    Invite {
        v: INVITE_VERSION,
        name: inst.name.chars().take(64).collect(),
        host: app.state::<Arc<P2p>>().id(),
        world: inst.id.clone(),
        token: inst.invite_token.clone().unwrap_or_default(),
        loader: inst.loader,
        mc_version: inst.mc_version.clone(),
        loader_version: inst.loader_version.clone(),
    }
}

fn links(short: Option<&str>) -> InviteLinks {
    InviteLinks {
        short: short.map(short_invite::format),
        web: short.map(short_invite::web_link),
    }
}

/// Davet sunucusundan yeni kısa kod alır ve dünyaya kaydeder.
async fn new_short(app: &AppHandle, id: &str, invite: &Invite) -> AppResult<String> {
    let http = app.state::<AppState>().http.clone();
    let (code, owner) = short_invite::create(&http, &invite.encode()).await?;
    let dir = paths::instance_dir(app, id)?;
    let token = invite.token.clone();
    let saved = code.clone();
    instance::modify(&dir, move |i| {
        i.short_invite = Some(ShortInvite {
            code: saved,
            owner,
            token,
            cover_sent: None,
            meta_sent: None,
            status_sent: None,
        });
        Ok(())
    })?;
    // Davet sayfasının adı, kapağı ve mod sayısı.
    crate::invite_live::spawn_meta(app, id);
    Ok(code)
}

/// Kayıtlı kısa kodun süresini (ve içindeki dünya adını) tazeler; sunucuda yoksa yenisini alır.
/// Dönen: değiştiyse yeni kod.
async fn refresh_short(app: &AppHandle, id: &str) -> AppResult<Option<String>> {
    let inst = instance::get(app, id)?;
    let Some(s) = inst
        .short_invite
        .clone()
        .filter(|s| Some(&s.token) == inst.invite_token.as_ref())
    else {
        return Ok(None);
    };
    let invite = invite_of(app, &inst);
    let http = app.state::<AppState>().http.clone();
    if short_invite::refresh(&http, &s, &invite.encode()).await? {
        crate::invite_live::spawn_meta(app, id);
        return Ok(None);
    }
    Ok(Some(new_short(app, id, &invite).await?))
}

/// Arka planda tazeler; kod değiştiyse açık panele bildirir. Hatalar yalnız günlüğe.
pub fn spawn_refresh(app: &AppHandle, id: &str) {
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move {
        match refresh_short(&app, &id).await {
            Ok(Some(code)) => {
                let links = links(Some(&code));
                let _ = app.emit(EVENT_SHORT, ShortPayload { id, links });
            }
            Ok(None) => {}
            Err(e) => eprintln!("Kısa davet kodu tazelenemedi: {e}"),
        }
    });
}

/// Dünya açılınca kısa kodu tazeler: kullanılan dünyaların kodu 60 günde düşmez.
pub fn install_refresh(app: &AppHandle) {
    #[derive(serde::Deserialize)]
    struct StatusPayload {
        id: String,
        status: String,
    }
    let handle = app.clone();
    app.listen_any(crate::server::EVENT_STATUS, move |event| {
        if let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload())
            && p.status == "running"
        {
            spawn_refresh(&handle, &p.id);
        }
    });
}

async fn invite_for(app: &AppHandle, id: &str, reset: bool) -> AppResult<InviteLinks> {
    let dir = paths::instance_dir(app, id)?;
    let old = instance::get(app, id)?.short_invite;
    let inst = instance::modify(&dir, |i| {
        if reset || i.invite_token.is_none() {
            i.invite_token = Some(new_token());
        }
        Ok(())
    })?;
    let invite = invite_of(app, &inst);
    // Yenilemede eski kısa kod sunucudan silinir (olmazsa 60 günde kendiliğinden düşer).
    if reset && let Some(old) = old {
        let http = app.state::<AppState>().http.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = short_invite::delete(&http, &old).await {
                eprintln!("Eski kısa davet kodu silinemedi: {e}");
            }
        });
    }
    let current = inst
        .short_invite
        .as_ref()
        .filter(|s| !reset && Some(&s.token) == inst.invite_token.as_ref())
        .map(|s| s.code.clone());
    let short = match current {
        Some(code) => {
            spawn_refresh(app, id);
            Some(code)
        }
        None => match new_short(app, id, &invite).await {
            Ok(code) => Some(code),
            // Davet sunucusuna ulaşılamadı: panel söyler, "Tekrar dene" yeniden ister.
            Err(e) => {
                eprintln!("Kısa davet kodu alınamadı: {e}");
                None
            }
        },
    };
    Ok(links(short.as_deref()))
}

#[tauri::command]
pub async fn create_invite(app: AppHandle, id: String) -> AppResult<InviteLinks> {
    invite_for(&app, &id, false).await
}

/// Yeni anahtar üretir; eski linkler ve kodlar geçersiz olur.
#[tauri::command]
pub async fn reset_invite(app: AppHandle, id: String) -> AppResult<InviteLinks> {
    invite_for(&app, &id, true).await
}

/// Katıl penceresi açılınca: panoda davet kodu ya da linki varsa yalnız kodu döner (panonun geri
/// kalanı arayüze gitmez).
#[tauri::command]
pub fn clipboard_invite_code() -> Option<String> {
    let text = arboard::Clipboard::new().ok()?.get_text().ok()?;
    short_invite::find_in_text(&text)
}

/// Kısa kod, web linki, uzun kod ya da `cubby://` linki → davet.
async fn invite_from(app: &AppHandle, input: &str) -> AppResult<Invite> {
    match short_invite::normalize(input) {
        Some(code) => {
            let http = app.state::<AppState>().http.clone();
            Invite::parse(&short_invite::resolve(&http, &code).await?)
        }
        None => Invite::parse(input),
    }
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
    /// Kendi dünyasıysa kimliği ("Dünyana git").
    own_world: Option<String>,
    /// Daha önce katılınmış (güncellenecek).
    already_joined: bool,
    /// Oyunu açacak launcher (Prism'de sürümü Prism indirir).
    launcher: Option<crate::client::Launcher>,
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
pub(crate) fn join_key(host: &str, world: &str) -> String {
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
    let target = crate::client_cmds::target(app).ok();
    let launcher = target.as_ref().map(crate::client_cmds::Target::launcher);
    let have: std::collections::HashSet<String> = match &target {
        Some(t) => {
            let dir = crate::client_cmds::dir_name(name, &join_key(host, world));
            let (_, mods_dir) = t.dirs(&dir, true);
            let mut have: std::collections::HashSet<String> =
                mods::scan(&mods_dir).into_iter().map(|(_, s)| s).collect();
            have.extend(
                mods::scan(&mods_dir.join("_disabled"))
                    .into_iter()
                    .map(|(_, s)| s),
            );
            have
        }
        None => Default::default(),
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
    let invite = invite_from(&app, &code).await?;
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let own = invite.host == p2p.id();
    let status = if own {
        JoinStatus::default()
    } else {
        let host = invite
            .host
            .parse()
            .map_err(|_| AppError::msg(tx!("Davet bozuk.", "Broken invite.")))?;
        crate::join::status_from(p2p.ping(host, &invite.world, &invite.token).await)
    };
    let (mods, mods_error) = if !own && invite.loader.is_modded() && status.reachable == Some(true)
    {
        let host = invite
            .host
            .parse()
            .map_err(|_| AppError::msg(tx!("Davet bozuk.", "Broken invite.")))?;
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
    let prism = match crate::client_cmds::target(&app) {
        Ok(crate::client_cmds::Target::Prism(p)) => Some(p),
        _ => None,
    };
    let mc = match &prism {
        Some(p) => Some(p.instances.clone()),
        None => minecraft_dir(&app),
    };
    let required = client::required_version(
        invite.loader,
        &invite.mc_version,
        invite.loader_version.as_deref(),
    );
    Ok(InvitePreview {
        already_joined: joins.find(&invite.host, &invite.world).await.is_some(),
        launcher: crate::client_cmds::target(&app).ok().map(|t| t.launcher()),
        version_installed: prism.is_some()
            || mc
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
        own_world: own.then(|| invite.world.clone()),
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
        AppError::msg(tx!(
            "Arkadaşının {} sürümü bilinmiyor.",
            "Your friend's {} version is unknown.",
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
        crate::client::Launcher::Official | crate::client::Launcher::Prism => {
            mods_dir.parent().map(|p| p.display().to_string())
        }
        crate::client::Launcher::TLauncher => None,
    };

    let mut wanted: Vec<crate::client::Wanted> = wanted_mods
        .iter()
        .map(|m| crate::client::Wanted {
            file: m.file.clone(),
            sha1: m.sha1.clone(),
        })
        .collect();
    // Bu dünya için kurduğun shader modları (Iris, Sodium…) arkadaşının listesinde yok; kendi
    // klasörlerinden kopyalanır, eşitleme onları silmez.
    let (extras, extras_dir) = crate::content_cmds::joined_dir(app, &w.id)
        .map(|d| crate::content_cmds::extras_for(&d))
        .unwrap_or_default();
    for e in &extras {
        if !wanted.iter().any(|x| x.sha1 == e.sha1) {
            wanted.push(e.clone());
        }
    }
    let extras = Arc::new(extras);
    let http = app.state::<AppState>().http.clone();
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let host: iroh::EndpointId = w
        .host
        .parse()
        .map_err(|_| AppError::msg(tx!("Davet bozuk.", "Broken invite.")))?;
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
        let extra = extras
            .iter()
            .any(|e| e.sha1 == want.sha1)
            .then(|| extras_dir.join(&want.file));
        index += 1;
        let i = index;
        async move {
            if let Some(from) = extra {
                std::fs::copy(from, &dest)?;
                return Ok(());
            }
            let m = all
                .iter()
                .find(|m| m.sha1 == want.sha1)
                .cloned()
                .ok_or_else(|| {
                    AppError::msg(tx!("Mod listede yok.", "That mod isn't in the list."))
                })?;
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
                return Err(AppError::msg(tx!(
                    "{} doğrulanamadı (hash tutmadı).",
                    "Couldn't verify {} (hash mismatch).",
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
        return Err(AppError::msg(tx!(
            "Minecraft açık. Kapatmazsan sunucu listesine eklediğimiz kayıt silinebilir; önce oyunu kapat.",
            "Minecraft is running. If you don't close it, the server-list entry we added may be lost; close the game first."
        )));
    }
    let dir = entry_dir(app, w).ok_or_else(|| {
        AppError::msg(tx!(
            "Minecraft klasörü bulunamadı. Ayarlar'dan Minecraft klasörünü seç.",
            "Minecraft folder not found. Choose your Minecraft folder in Settings."
        ))
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
    let invite = invite_from(&app, &code).await?;
    if invite.host == app.state::<Arc<P2p>>().id() {
        return Err(AppError::msg(tx!(
            "Bu kod senin kendi dünyanın. Arkadaşlarına gönder; sen dünyana Oyna'dan girebilirsin.",
            "This code is for your own world. Send it to your friends; you can jump in from Play."
        )));
    }
    if !force && client::minecraft_running() {
        return Err(AppError::msg(tx!(
            "Minecraft açık. Kapatmazsan sunucu listesine eklediğimiz kayıt silinebilir; önce oyunu kapat.",
            "Minecraft is running. If you don't close it, the server-list entry we added may be lost; close the game first."
        )));
    }
    // Katılırken yazılan kod hemen görünsün (ping sonra güncel tutar).
    let typed = short_invite::normalize(&code).map(|c| short_invite::format(&c));
    let mut joined = joins.inner().join(&app, &invite, typed).await?;
    // Modlu dünya: oyuncuda gereken modlar varsa profile kur (yoksa sunucu listesi ana klasöre).
    if invite.loader.is_modded() {
        let p2p = app.state::<Arc<P2p>>().inner().clone();
        let host = invite
            .host
            .parse()
            .map_err(|_| AppError::msg(tx!("Davet bozuk.", "Broken invite.")))?;
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
    // modları (TLauncher) kaldırılır; Prism'in örneği kalır ama sunucuya bağlanmaz.
    let key = join_key(&removed.host, &removed.world);
    if let Some(p) = crate::client_cmds::prism_install(&app) {
        crate::client::prism::forget(&p, &crate::client_cmds::dir_name(&removed.name, &key));
    }
    if let Some(mc) = minecraft_dir(&app) {
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
    if let crate::client_cmds::Target::Prism(p) = crate::client_cmds::target(&app)? {
        return play_in_prism(&app, w, &p, &dir).await;
    }
    let (launcher, pick) = match (&w.profile, &w.loader_version) {
        // Modlar kuruldu: profil ve mod altyapısının sürümü zaten var.
        (Some(_), Some(lv)) if w.loader.is_modded() => {
            let mc = crate::client_cmds::minecraft_dir(&app)?;
            let launcher = crate::client::detect_launcher(&mc).ok_or_else(|| {
                AppError::msg(tx!(
                    "Minecraft Launcher bulunamadı.",
                    "Minecraft Launcher not found."
                ))
            })?;
            let base = crate::client::version_id(w.loader, &w.mc_version, lv).ok_or_else(|| {
                AppError::msg(tx!(
                    "Dünyanın sürümü bilinmiyor.",
                    "The world's version is unknown."
                ))
            })?;
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

/// Prism: dünyanın örneği hazırlanır (modlu dünyada modlar örnekte değilse, ör. başka launcher'la
/// katılmıştı, yeniden kurulur) ve oyun Prism'in komutuyla doğrudan dünyada açılır.
async fn play_in_prism(
    app: &AppHandle,
    mut w: JoinedWorld,
    p: &crate::client::prism::PrismInstall,
    dir: &str,
) -> AppResult<crate::client_cmds::LaunchResult> {
    let game = crate::client::prism::game_dir(p, dir);
    let in_prism = w.game_dir.as_deref().map(std::path::Path::new) == Some(game.as_path());
    if w.loader.is_modded() && w.profile.is_some() && !in_prism {
        let host = w
            .host
            .parse()
            .map_err(|_| AppError::msg(tx!("Davet bozuk.", "Broken invite.")))?;
        let list = app
            .state::<Arc<P2p>>()
            .manifest(host, &w.world, &w.token)
            .await?;
        let with = w.with_recommended;
        w = install_client_mods(app, &w, list, with).await?;
    }
    let name = crate::client_cmds::profile_name(&w.name);
    let addr = w.address();
    let (game, id) = crate::client::prism::prepare(
        p,
        dir,
        &crate::client::prism::InstanceSpec {
            name: &name,
            kind: w.loader,
            mc_version: &w.mc_version,
            loader_version: w.loader_version.as_deref(),
            addr: Some(&addr),
            icon_png: None,
        },
    )?;
    let mut root = servers_dat::read(&game)?;
    if !servers_dat::contains(&mut root, &addr) {
        servers_dat::upsert(&mut root, &addr, &w.name);
        servers_dat::write(&game, &root)?;
    }
    Ok(crate::client_cmds::launch_now(
        app,
        crate::client::Launcher::Prism,
        id,
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
    let host = w
        .host
        .parse()
        .map_err(|_| AppError::msg(tx!("Davet bozuk.", "Broken invite.")))?;
    let list = p2p.manifest(host, &w.world, &w.token).await?;
    let updated =
        install_client_mods(&app, &w, list, w.with_recommended || w.profile.is_none()).await?;
    Ok(view(&joins, updated).await)
}

#[tauri::command]
pub fn take_pending_invite(pending: State<'_, PendingInvite>) -> Option<String> {
    pending.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}
