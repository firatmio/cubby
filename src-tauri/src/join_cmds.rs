//! Davet oluşturma (host) ve davetle katılma (katılımcı) komutları.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::{AppState, server_port};
use crate::error::{AppError, AppResult};
use crate::invite::{INVITE_VERSION, Invite, new_token};
use crate::join::{JoinManager, JoinStatus, JoinedWorld, client, servers_dat};
use crate::loaders::LoaderKind;
use crate::p2p::protocol::{Reply, StreamHeader, StreamKind};
use crate::p2p::{Decide, Decision, P2p};
use crate::server::ServerStatus;
use crate::settings::SettingsStore;
use crate::{instance, paths};

type Joins<'a> = State<'a, Arc<JoinManager>>;

/// Uygulama açılırken link ile gelen, arayüz hazır olunca alınacak davet.
#[derive(Default)]
pub struct PendingInvite(pub Mutex<Option<String>>);

/// Host: gelen bir akışı kabul eder mi, hangi porta aktarır?
pub fn host_decider(app: AppHandle) -> Decide {
    Arc::new(move |h: &StreamHeader| {
        let Ok(inst) = instance::get(&app, &h.world) else {
            return Decision::Reply(Reply::Denied, None);
        };
        if inst.invite_token.as_deref() != Some(h.token.as_str()) {
            return Decision::Reply(Reply::Denied, None);
        }
        let running =
            app.state::<AppState>().servers.snapshot(&h.world).status == ServerStatus::Running;
        let ok = Reply::Ok {
            running,
            name: inst.name.clone(),
        };
        match (h.kind, running) {
            (StreamKind::Ping, _) => Decision::Reply(ok, None),
            (StreamKind::Tcp, true) => {
                let port = paths::server_dir(&app, &h.world)
                    .map_or(inst.port, |d| server_port(&d, inst.port));
                Decision::Reply(ok, Some(port))
            }
            (StreamKind::Tcp, false) => Decision::Reply(Reply::Offline, None),
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
    })
}

fn add_server_entry(app: &AppHandle, w: &JoinedWorld, force: bool) -> AppResult<()> {
    if !force && client::minecraft_running() {
        return Err(AppError::msg(
            "Minecraft açık. Kapatmazsan sunucu listesine eklediğimiz kayıt silinebilir; önce oyunu kapat.",
        ));
    }
    let dir = minecraft_dir(app).ok_or_else(|| {
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
    let joined = joins.inner().join(&app, &invite).await?;
    add_server_entry(&app, &joined, true)?;
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
    if let Some(dir) = minecraft_dir(&app) {
        let mut root = servers_dat::read(&dir)?;
        if servers_dat::remove(&mut root, &removed.address()) {
            servers_dat::write(&dir, &root)?;
        }
    }
    Ok(())
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
    let Some(dir) = minecraft_dir(&app) else {
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

#[tauri::command]
pub fn take_pending_invite(pending: State<'_, PendingInvite>) -> Option<String> {
    pending.0.lock().unwrap_or_else(|e| e.into_inner()).take()
}
