//! Ortak dünyada arkadaşın tarafı: katıldığı dünyanın ortak olup olmadığını, kimin açık olduğunu ve
//! kendisinin açıp açamayacağını izler; onaylarsa dünyanın kopyasını kurar ve güncel tutar.
//! Sahip de, başkası açıkken kendi dünyasına aynı yoldan katılır.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::host::{self, Groups};
use super::web::{Act, Refusal, SharedState};
use super::{Store, sync};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance, SharedLink, SharedRole};
use crate::join::{JoinManager, JoinShared, JoinedWorld, Target};
use crate::p2p::P2p;
use crate::paths;
use crate::registry::Registry;

/// Ortak olmayan dünyaya bu kadar sonra yeniden sorulur.
const NOT_SHARED_BACKOFF: Duration = Duration::from_secs(10 * 60);
pub const EVENT_PROGRESS: &str = "shared://progress";

/// Kopya iniyor/güncelleniyor (katılınan dünya kimliği) ve ortak olmadığı öğrenilen dünyalar.
#[derive(Default)]
pub struct MemberState {
    syncing: Mutex<HashSet<String>>,
    not_shared: Mutex<HashMap<String, Instant>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    stage: &'a str,
    done: u64,
    total: u64,
}

fn emit(app: &AppHandle, id: &str, stage: &str, done: u64, total: u64) {
    let _ = app.emit(
        EVENT_PROGRESS,
        Progress {
            id,
            stage,
            done,
            total,
        },
    );
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// Katılınan dünyanın bu bilgisayardaki kopyası.
pub fn local_copy(app: &AppHandle, w: &JoinedWorld) -> Option<Instance> {
    instance::list(app).into_iter().find(|i| {
        i.shared.as_ref().is_some_and(|s| {
            s.role == SharedRole::Member && s.origin_world == w.world && s.owner_device == w.host
        })
    })
}

fn code_of(w: &JoinedWorld) -> Option<String> {
    w.code.as_deref().and_then(crate::short_invite::normalize)
}

/// Dakikada bir (grup döngüsünden): katılınan her dünya için ortak dünya durumu.
pub async fn poll_joined(app: &AppHandle) {
    let joins = app.state::<Arc<JoinManager>>().inner().clone();
    let me = app.state::<Arc<P2p>>().id();
    let ms = app.state::<MemberState>();
    for w in joins.list().await {
        let Some(code) = code_of(&w) else { continue };
        if lock(&ms.not_shared)
            .get(&w.id)
            .is_some_and(|t| t.elapsed() < NOT_SHARED_BACKOFF)
        {
            continue;
        }
        let state = match host::act(app, &code, Act::State).await {
            Ok(Ok(s)) => s,
            Ok(Err(Refusal::NotShared | Refusal::NotMember)) => {
                lock(&ms.not_shared).insert(w.id.clone(), Instant::now());
                joins.set_live(&w.id, None);
                joins.set_shared(app, &w.id, None).await;
                continue;
            }
            _ => continue,
        };
        lock(&ms.not_shared).remove(&w.id);
        apply_state(app, &joins, &w, &state, &me).await;
    }
}

/// Durumdan: bağlantının gideceği yer, arayüzdeki bilgi, gerekirse kopyanın güncellenmesi.
async fn apply_state(
    app: &AppHandle,
    joins: &JoinManager,
    w: &JoinedWorld,
    state: &SharedState,
    me: &str,
) {
    let local = local_copy(app, w);
    let owner_name = None::<&str>;
    let lease = state.lease.clone().filter(|l| l.until > now());
    let target = match &lease {
        Some(l) if l.device == me => local.as_ref().and_then(|i| {
            let dir = paths::server_dir(app, &i.id).ok()?;
            Some(Target::Local(crate::commands::server_port(&dir, i.port)))
        }),
        Some(l) => l.device.parse().ok().map(Target::Remote),
        None => None,
    };
    joins.set_live(&w.id, target);
    let local_generation = local
        .as_ref()
        .and_then(|i| paths::instance_dir(app, &i.id).ok())
        .map_or(0, |d| Store::for_instance(&d).manifest().generation);
    let syncing = lock(&app.state::<MemberState>().syncing).contains(&w.id);
    let waiting = state.dirty.clone().or_else(|| {
        state
            .lease
            .as_ref()
            .filter(|l| l.until <= now())
            .map(|l| l.device.clone())
    });
    let info = JoinShared {
        member: state.members.iter().any(|m| m.device == me),
        local: local.as_ref().map(|i| i.id.clone()),
        syncing,
        open_by: lease
            .as_ref()
            .map(|l| host::name_of(state, &l.device, owner_name)),
        open_by_me: lease.as_ref().is_some_and(|l| l.device == me),
        waiting_for: waiting.map(|d| host::name_of(state, &d, owner_name)),
        generation: state.generation,
        local_generation,
    };
    joins.set_shared(app, &w.id, Some(info)).await;
    // Kopya kabul edildiyse ve geride kaldıysa arka planda güncellenir (açık değilken).
    if let Some(i) = local
        && local_generation < state.generation
        && !app.state::<AppState>().servers.is_active(&i.id)
    {
        let sources = state.holders_of(state.generation);
        spawn_pull(app, w, &i, state.generation, sources);
    }
}

/// Kopyayı `generation` nesline getirir ve davet sunucusuna "bende var" der.
fn spawn_pull(
    app: &AppHandle,
    w: &JoinedWorld,
    inst: &Instance,
    generation: u64,
    sources: Vec<String>,
) {
    if !lock(&app.state::<MemberState>().syncing).insert(w.id.clone()) {
        return;
    }
    let (app, w, inst) = (app.clone(), w.clone(), inst.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = pull_into(&app, &w, &inst, generation, &sources).await {
            eprintln!("Ortak dünya kopyası güncellenemedi: {e}");
        }
        lock(&app.state::<MemberState>().syncing).remove(&w.id);
        poll_one(&app, &w).await;
    });
}

async fn pull_into(
    app: &AppHandle,
    w: &JoinedWorld,
    inst: &Instance,
    generation: u64,
    sources: &[String],
) -> AppResult<()> {
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let peers: Vec<iroh::EndpointId> = sources.iter().filter_map(|d| d.parse().ok()).collect();
    let store = Store::for_instance(&paths::instance_dir(app, &inst.id)?);
    let src = sync::Source {
        p2p: &p2p,
        peers: &peers,
        world: &w.world,
        token: &w.token,
    };
    let id = w.id.clone();
    let progress = |done: u64, total: u64| emit(app, &id, "pull", done, total);
    sync::pull(&src, &store, generation, progress).await?;
    let code = inst
        .shared
        .as_ref()
        .map(|s| s.code.clone())
        .unwrap_or_default();
    host::act(app, &code, Act::Have(generation))
        .await?
        .map_err(|r| AppError::msg(format!("{r:?}")))?;
    Ok(())
}

async fn poll_one(app: &AppHandle, w: &JoinedWorld) {
    let Some(code) = code_of(w) else { return };
    if let Ok(Ok(state)) = host::act(app, &code, Act::State).await {
        let joins = app.state::<Arc<JoinManager>>().inner().clone();
        let me = app.state::<Arc<P2p>>().id();
        apply_state(app, &joins, w, &state, &me).await;
    }
}

/// Arkadaş daveti kabul etti: dünyanın kopyası kurulur (altyapı + son nesil). Dönen: kopyanın kimliği.
pub async fn accept(app: &AppHandle, joined_id: &str) -> AppResult<String> {
    let joins = app.state::<Arc<JoinManager>>().inner().clone();
    let w = joins.get(joined_id).await?;
    if let Some(i) = local_copy(app, &w) {
        return Ok(i.id);
    }
    let code = code_of(&w)
        .ok_or_else(|| AppError::msg(tx!("Bu dünya ortak değil.", "This world isn't shared.")))?;
    let state = match host::act(app, &code, Act::State).await? {
        Ok(s) => s,
        Err(_) => {
            return Err(AppError::msg(tx!(
                "Bu dünyayı açma iznin yok.",
                "You're not allowed to open this world."
            )));
        }
    };
    let me = app.state::<Arc<P2p>>().id();
    if !state.members.iter().any(|m| m.device == me) {
        return Err(AppError::msg(tx!(
            "Bu dünyayı açma iznin yok.",
            "You're not allowed to open this world."
        )));
    }
    if !lock(&app.state::<MemberState>().syncing).insert(w.id.clone()) {
        return Err(AppError::msg(tx!(
            "Kopya zaten iniyor.",
            "The copy is already downloading."
        )));
    }
    let result = install_copy(app, &w, &code, &state).await;
    lock(&app.state::<MemberState>().syncing).remove(&w.id);
    poll_one(app, &w).await;
    result
}

async fn install_copy(
    app: &AppHandle,
    w: &JoinedWorld,
    code: &str,
    state: &SharedState,
) -> AppResult<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let registry = app.state::<Registry>();
    let dir = registry.allocate(&id, &w.name, None)?;
    let server_dir = dir.join("server");
    let jid = w.id.clone();
    let emit_stage =
        |stage: &'static str, _file: Option<&'static str>, done: u64, total: Option<u64>| {
            emit(app, &jid, stage, done, total.unwrap_or(0))
        };
    let emit_line = |_line: String| {};
    let result: AppResult<Instance> = async {
        let app_state = app.state::<AppState>();
        let java = app.state::<crate::java::JavaManager>();
        let installed = crate::commands::install_loader(
            &app_state,
            &java,
            w.loader,
            &w.mc_version,
            w.loader_version.as_deref(),
            &server_dir,
            &emit_stage,
            &emit_line,
        )
        .await?;
        let java_path = java
            .ensure(installed.java_major, |_| {})
            .await
            .ok()
            .flatten()
            .map(|j| j.path);
        let inst = Instance {
            id: id.clone(),
            name: w.name.clone(),
            loader: w.loader,
            mc_version: w.mc_version.clone(),
            loader_version: installed.loader_version,
            java_path,
            java_major: installed.java_major,
            ram_min_mb: 1024,
            ram_max_mb: 4096,
            port: crate::consts::DEFAULT_PORT,
            created_at: crate::util::now_ms(),
            cover: None,
            internet: false,
            // Arkadaşlar sahibin davetiyle gelir: bu kopya açıkken aynı anahtarı kabul eder.
            invite_token: Some(w.token.clone()),
            short_invite: None,
            shared: Some(SharedLink {
                code: code.to_string(),
                role: SharedRole::Member,
                origin_world: w.world.clone(),
                owner_device: w.host.clone(),
            }),
        };
        inst.save(&dir)?;
        registry.insert(&id, dir.clone())?;
        Ok(inst)
    }
    .await;
    let inst = match result {
        Ok(i) => i,
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            return Err(e);
        }
    };
    if state.generation > 0 {
        pull_into(
            app,
            w,
            &inst,
            state.generation,
            &state.holders_of(state.generation),
        )
        .await?;
        // Sunucu klasörü de son hâle gelsin (sahibin ayarları, EULA kaydı, modlar, dünya).
        let store = Store::for_instance(&dir);
        tokio::task::spawn_blocking(move || {
            store.checkout(&server_dir)?;
            store.mark_checked_out(store.manifest().generation)
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    }
    emit(app, &w.id, "done", 1, 1);
    Ok(id)
}

/// Sahip, başkası açıkken kendi dünyasına katılır: kendi dünyası için gizli bir katılım kaydı
/// (bağlantı o an açık olana gider). Dönen: katılım kaydının kimliği.
pub async fn join_own(app: &AppHandle, id: &str) -> AppResult<String> {
    let inst = instance::get(app, id)?;
    let link = inst
        .shared
        .clone()
        .ok_or_else(|| AppError::msg(tx!("Bu dünya ortak değil.", "This world isn't shared.")))?;
    let invite = crate::join_cmds::invite_of(app, &inst);
    let joins = app.state::<Arc<JoinManager>>().inner().clone();
    let w = joins
        .join(app, &invite, Some(crate::short_invite::format(&link.code)))
        .await?;
    if let Some(state) = app.state::<Groups>().get(&link.code) {
        let me = app.state::<Arc<P2p>>().id();
        apply_state(app, &joins, &w, &state, &me).await;
    }
    Ok(w.id)
}
