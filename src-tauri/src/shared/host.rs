//! Ortak dünyayı açan bilgisayarın işleri (sahip ya da üye, fark etmez):
//! - açmadan önce `prepare`: kirayı al; en güncel nesil bende değilse önce çek; sunucu klasörünü
//!   son nesle getir.
//! - açıkken `watch`: dakikada bir kirayı tazele (davet sayfası "açık · N oyuncu" der), 10 dakikada
//!   bir oyun sırasında kopya alıp yayınla; kapanınca son kopyayı yayınla ve kirayı bırak.
//! - açılışta `recover`: uygulama çöktüyse ya da kapandıysa kalan ilerlemeyi yayınla.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use iroh::EndpointId;
use tauri::{AppHandle, Manager};

use super::web::{self, Act, Refusal, SharedState};
use super::{Store, snapshot, sync};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::p2p::P2p;
use crate::paths;
use crate::server::{ServerStatus, StartLog};

const RENEW_EVERY: Duration = Duration::from_secs(60);
const SNAPSHOT_EVERY: Duration = Duration::from_secs(10 * 60);
const POLL: Duration = Duration::from_secs(2);

pub fn store_of(app: &AppHandle, id: &str) -> AppResult<Store> {
    Ok(Store::for_instance(&paths::instance_dir(app, id)?))
}

/// Cihazın grupta görünen adı (sahipse oyundaki adı, bilinmiyorsa "arkadaşın").
pub fn name_of(state: &SharedState, device: &str, owner_name: Option<&str>) -> String {
    if device == state.owner {
        return owner_name
            .map(str::to_string)
            .unwrap_or_else(|| tx!("dünyanın sahibi", "the world's owner"));
    }
    state
        .members
        .iter()
        .find(|m| m.device == device && !m.name.is_empty())
        .map(|m| m.name.clone())
        .unwrap_or_else(|| tx!("bir arkadaşın", "a friend"))
}

fn refusal_message(r: &Refusal, state: Option<&SharedState>, owner_name: Option<&str>) -> AppError {
    let who = |d: &str| {
        state.map_or_else(
            || tx!("bir arkadaşın", "a friend"),
            |s| name_of(s, d, owner_name),
        )
    };
    AppError::msg(match r {
        Refusal::Busy { device } => tx!(
            "Dünya şu an {}'de açık; ona katılabilirsin.",
            "The world is open on {}'s computer right now; you can join them.",
            who(device)
        ),
        Refusal::WaitFor { device } => tx!(
            "Dünyanın son hâli {}'de kaldı. O Cubby'yi açınca kendiliğinden gelir, sonra açabilirsin.",
            "The latest version of the world is on {}'s computer. It comes over once they open Cubby, then you can open it.",
            who(device)
        ),
        Refusal::NotMember => tx!(
            "Bu dünyayı açma iznin yok. Dünyanın sahibinden seni eklemesini iste.",
            "You can't open this world. Ask the world's owner to add you."
        ),
        Refusal::NotShared => tx!(
            "Bu dünya artık ortak değil.",
            "This world isn't shared anymore."
        ),
        _ => tx!(
            "Dünya açılamadı ({:?}). Biraz sonra tekrar dene.",
            "The world couldn't be opened ({:?}). Try again in a little while.",
            r
        ),
    })
}

/// Grupların son bilinen durumu: gelen dünya akışlarında "bu cihaz grupta mı?" sorusu buradan
/// (bağlantı kararı web'e soramaz). Her istekte ve dakikada bir tazelenir.
#[derive(Default)]
pub struct Groups(std::sync::Mutex<HashMap<String, SharedState>>);

impl Groups {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SharedState>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn remember(&self, code: &str, state: &SharedState) {
        self.lock().insert(code.to_string(), state.clone());
    }

    pub fn forget(&self, code: &str) {
        self.lock().remove(code);
    }

    pub fn get(&self, code: &str) -> Option<SharedState> {
        self.lock().get(code).cloned()
    }

    pub fn is_member(&self, code: &str, device: &str) -> bool {
        self.lock()
            .get(code)
            .is_some_and(|s| s.owner == device || s.members.iter().any(|m| m.device == device))
    }
}

/// Davet sunucusu bu cihazı en güncel nesle sahip sayıyor ama depo eski numarada (sahip beklemeyi
/// kaldırdı): depo yeni numaraya çekilir, arkadaşlar bu numarayla isteyebilsin.
pub fn align(app: &AppHandle, id: &str, state: &SharedState) {
    let me = app.state::<Arc<P2p>>().id();
    if state.holders.get(&me) == Some(&state.generation)
        && let Ok(store) = store_of(app, id)
        && let Err(e) = store.relabel(state.generation)
    {
        eprintln!("Ortak dünya: depo yeni nesle çekilemedi: {e}");
    }
}

/// İmzalı istek; gelen durum önbelleğe yazılır.
pub async fn act(app: &AppHandle, code: &str, a: Act) -> AppResult<web::Outcome> {
    let http = app.state::<AppState>().http.clone();
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let out = web::act(&http, &p2p, code, a).await?;
    match &out {
        Ok(state) => app.state::<Groups>().remember(code, state),
        Err(Refusal::NotShared) => app.state::<Groups>().forget(code),
        Err(_) => {}
    }
    Ok(out)
}

fn peers(ids: &[String]) -> Vec<EndpointId> {
    ids.iter().filter_map(|d| d.parse().ok()).collect()
}

/// Sunucu açılmadan önce: kirayı alır; en güncel nesil bende değilse önce çeker. Sonunda sunucu
/// klasörü son nesille aynıdır.
pub async fn prepare(app: &AppHandle, inst: &Instance, log: &StartLog) -> AppResult<()> {
    let Some(link) = inst.shared.clone() else {
        return Ok(());
    };
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    let store = store_of(app, &inst.id)?;
    let owner_name = crate::invite_live::player_name(app);
    for _ in 0..3 {
        match act(app, &link.code, Act::Acquire).await? {
            Ok(state) => {
                align(app, &inst.id, &state);
                let server_dir = paths::server_dir(app, &inst.id)?;
                // Depoda bu nesil var ama sunucu klasörü eski (başkası oynadı): son hâl yerleştirilir.
                // Hiç nesil yoksa (ilk açılış) sunucu klasörü olduğu gibi kalır.
                let have = store.manifest().generation;
                if have > 0 && have == state.generation && store.checked_out() != Some(have) {
                    log.line(tx!(
                        "Dünyanın son hâli yerleştiriliyor…",
                        "Putting the latest version of the world in place…"
                    ));
                    let (s, d) = (Store::at(store.root.clone()), server_dir.clone());
                    tokio::task::spawn_blocking(move || {
                        s.checkout(&d)?;
                        s.mark_checked_out(s.manifest().generation)
                    })
                    .await
                    .map_err(|e| AppError::msg(e.to_string()))??;
                }
                return Ok(());
            }
            Err(Refusal::NeedSync { generation, from }) => {
                log.line(tx!(
                    "Dünyanın son hâli arkadaşından alınıyor…",
                    "Getting the latest version of the world from your friend…"
                ));
                let sources = peers(&from);
                let token = inst.invite_token.clone().unwrap_or_default();
                let src = sync::Source {
                    p2p: &p2p,
                    peers: &sources,
                    world: &link.origin_world,
                    token: &token,
                };
                let (_, stats) = sync::pull(&src, &store, generation, |_, _| {}).await?;
                log.line(tx!(
                    "{} dosya güncellendi ({:.1} MB).",
                    "{} files updated ({:.1} MB).",
                    stats.files,
                    stats.bytes as f64 / 1048576.0
                ));
                if let Err(r) = act(app, &link.code, Act::Have(generation)).await? {
                    return Err(refusal_message(&r, None, owner_name.as_deref()));
                }
            }
            Err(r) => {
                let state = act(app, &link.code, Act::State)
                    .await
                    .ok()
                    .and_then(Result::ok);
                return Err(refusal_message(&r, state.as_ref(), owner_name.as_deref()));
            }
        }
    }
    Err(AppError::msg(tx!(
        "Dünyanın son hâli alınamadı. Biraz sonra tekrar dene.",
        "Couldn't get the latest version of the world. Try again in a little while."
    )))
}

/// Kopya al ve yayınla. `running`: sunucu açık (kayıt kısa süre durdurulur).
pub async fn publish(app: &AppHandle, id: &str, code: &str, running: bool) -> AppResult<()> {
    let p2p = app.state::<Arc<P2p>>().inner().clone();
    // Yalnız kirayı tutan kopya yayınlar; yoksa eski bir sunucu klasöründen yanlış bir nesil doğar.
    let current = match act(app, code, Act::State).await? {
        Ok(s) if s.lease.as_ref().is_some_and(|l| l.device == p2p.id()) => s.generation,
        _ => return Ok(()),
    };
    let next = current + 1;
    let source = paths::server_dir(app, id)?;
    let store = store_of(app, id)?;
    let made = if running {
        let servers = app.state::<AppState>().servers.clone();
        snapshot::snapshot_running(&servers, id, source, store, next).await?
    } else {
        tokio::task::spawn_blocking(move || {
            let m = snapshot::snapshot(&source, &store, next)?;
            if let Some(m) = &m {
                store.mark_checked_out(m.generation)?;
            }
            Ok::<_, AppError>(m)
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??
    };
    if let Some(m) = made {
        if running {
            // Sunucu klasörü hâlâ bu nesille aynı (kopya ondan alındı).
            store_of(app, id)?.mark_checked_out(m.generation)?;
        }
        if let Err(r) = act(app, code, Act::Publish(m.generation)).await? {
            eprintln!("Ortak dünya: nesil {} yayınlanamadı: {r:?}", m.generation);
        }
    }
    Ok(())
}

fn max_players(app: &AppHandle, id: &str) -> u32 {
    paths::server_dir(app, id)
        .ok()
        .and_then(|d| crate::properties::Properties::load(&d).ok())
        .and_then(|p| p.get("max-players").and_then(|v| v.parse().ok()))
        .unwrap_or(20)
}

/// Sunucu açıldıktan sonra: kira tazelenir, ara kopyalar yayınlanır; kapanınca son kopya yayınlanır
/// ve kira bırakılır.
pub fn watch(app: &AppHandle, id: &str, code: &str) {
    let (app, id, code) = (app.clone(), id.to_string(), code.to_string());
    tauri::async_runtime::spawn(async move {
        let servers = app.state::<AppState>().servers.clone();
        let mut last_renew = tokio::time::Instant::now();
        let mut last_snapshot = tokio::time::Instant::now();
        let mut announced = false;
        loop {
            tokio::time::sleep(POLL).await;
            let snap = servers.snapshot(&id);
            if !announced && snap.status == ServerStatus::Running {
                announced = true;
                super::member::refresh_for(&app, &id).await;
            }
            match snap.status {
                ServerStatus::Stopped | ServerStatus::Crashed => break,
                ServerStatus::Running if last_snapshot.elapsed() >= SNAPSHOT_EVERY => {
                    last_snapshot = tokio::time::Instant::now();
                    if let Err(e) = publish(&app, &id, &code, true).await {
                        eprintln!("Ortak dünya: ara kopya alınamadı: {e}");
                    }
                }
                _ => {}
            }
            if last_renew.elapsed() >= RENEW_EVERY {
                last_renew = tokio::time::Instant::now();
                let renew = Act::Renew {
                    players: snap.players.len() as u32,
                    max_players: max_players(&app, &id),
                };
                match act(&app, &code, renew).await {
                    Ok(Err(Refusal::NoLease)) => {
                        // Kira başkasına geçmiş (olmamalı): iki yerde açık kalmasın.
                        eprintln!("Ortak dünya: kira kaybedildi, sunucu kapatılıyor");
                        let _ = servers.stop(&app, &id).await;
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("Ortak dünya: kira tazelenemedi: {e}"),
                }
            }
        }
        if let Err(e) = publish(&app, &id, &code, false).await {
            eprintln!("Ortak dünya: son kopya yayınlanamadı: {e}");
        }
        if let Err(e) = act(&app, &code, Act::Release).await {
            eprintln!("Ortak dünya: kira bırakılamadı: {e}");
        }
        super::member::refresh_for(&app, &id).await;
    });
}

/// Açılışta: kirası bende kalmış (uygulama çöktü ya da kapandı) ortak dünyaların ilerlemesini yayınlar.
pub fn recover_all(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let p2p = app.state::<Arc<P2p>>().inner().clone();
        let me = p2p.id();
        for inst in instance::list(&app) {
            let Some(link) = inst.shared.clone() else {
                continue;
            };
            if app.state::<AppState>().servers.is_active(&inst.id) {
                continue;
            }
            let Ok(Ok(state)) = act(&app, &link.code, Act::State).await else {
                continue;
            };
            let mine = state.dirty.as_deref() == Some(me.as_str())
                || state.lease.as_ref().is_some_and(|l| l.device == me);
            if !mine {
                continue;
            }
            if !matches!(act(&app, &link.code, Act::Acquire).await, Ok(Ok(_))) {
                continue;
            }
            if let Err(e) = publish(&app, &inst.id, &link.code, false).await {
                eprintln!("Ortak dünya: kalan ilerleme yayınlanamadı: {e}");
            }
            let _ = act(&app, &link.code, Act::Release).await;
        }
    });
}

const REFRESH_EVERY: Duration = Duration::from_secs(60);

/// Uygulama açılırken: grup önbelleği, dakikada bir tazeleme ve kalan ilerlemenin kurtarılması.
pub fn install(app: &AppHandle) {
    app.manage(super::member::MemberState::default());
    recover_all(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            for inst in instance::list(&app) {
                if let Some(link) = &inst.shared {
                    match act(&app, &link.code, Act::State).await {
                        Ok(Ok(state)) => align(&app, &inst.id, &state),
                        Ok(Err(_)) => {}
                        Err(e) => eprintln!("Ortak dünya durumu alınamadı: {e}"),
                    }
                }
            }
            // Katılınan dünyalar: ortak mı, kim açık, kopyam güncel mi.
            super::member::poll_joined(&app).await;
            tokio::time::sleep(REFRESH_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::web::{Lease, Member};

    fn state() -> SharedState {
        SharedState {
            owner: "a".into(),
            members: vec![
                Member {
                    device: "b".into(),
                    name: "Ayşe".into(),
                },
                Member {
                    device: "c".into(),
                    name: String::new(),
                },
            ],
            generation: 2,
            holders: [("a".to_string(), 2), ("b".to_string(), 1)]
                .into_iter()
                .collect(),
            lease: Some(Lease {
                device: "b".into(),
                generation: 2,
                until: 9,
            }),
            dirty: None,
        }
    }

    #[test]
    fn group_cache_answers_membership() {
        let g = Groups::default();
        assert!(!g.is_member("K7M2QX", "a"));
        g.remember("K7M2QX", &state());
        assert!(g.is_member("K7M2QX", "a"));
        assert!(g.is_member("K7M2QX", "b"));
        assert!(!g.is_member("K7M2QX", "x"));
        g.forget("K7M2QX");
        assert!(!g.is_member("K7M2QX", "b"));
    }

    #[test]
    fn names_for_messages() {
        crate::i18n::set_lang(crate::i18n::Lang::Tr);
        let s = state();
        assert_eq!(name_of(&s, "a", Some("Ali")), "Ali");
        assert_eq!(name_of(&s, "a", None), "dünyanın sahibi");
        assert_eq!(name_of(&s, "b", None), "Ayşe");
        // Adı bilinmeyen üye.
        assert_eq!(name_of(&s, "c", None), "bir arkadaşın");
        assert_eq!(s.holders_of(2), vec!["a".to_string()]);
    }
}
