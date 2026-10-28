//! Ortak dünyanın arayüz komutları. Sahip: aç/kapat, arkadaşları "açabilir" yap, kilidi kaldır.
//! (Üyenin komutları katılınan dünya tarafında.)

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::instance::{self, SharedLink, SharedRole};
use crate::p2p::P2p;
use crate::paths;
use crate::shared::host::{self, Groups};
use crate::shared::web::{self, Act, Member};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub device: String,
    pub name: String,
    /// Dünyayı açabilir (grupta).
    pub member: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharedView {
    pub enabled: bool,
    /// Davetle girmiş arkadaşlar (sahip "açabilir" yapacaklarını buradan seçer) ve grupta olanlar.
    pub friends: Vec<Friend>,
    /// Şu an açık olanın adı; ben açıksam `me` true.
    pub open_by: Option<String>,
    pub open_by_me: bool,
    /// En güncel hâl bu arkadaşta kaldı; o dönene kadar kimse açamaz.
    pub waiting_for: Option<String>,
    pub generation: u64,
}

fn http(app: &AppHandle) -> reqwest::Client {
    app.state::<AppState>().http.clone()
}

fn me(app: &AppHandle) -> String {
    app.state::<Arc<P2p>>().id()
}

/// Sahibin ortak dünya görünümü: web'in son durumu (önbellek) ve davetle girmiş arkadaşlar.
fn view(app: &AppHandle, id: &str) -> AppResult<SharedView> {
    let inst = instance::get(app, id)?;
    let meta = paths::instance_dir(app, id)?.join(crate::sessions::META_DIR);
    let seen = crate::players_guard::load(&meta).seen;
    let state = inst
        .shared
        .as_ref()
        .and_then(|l| app.state::<Groups>().get(&l.code));
    let owner_name = crate::invite_live::player_name(app);
    let mut friends: Vec<Friend> = seen
        .iter()
        .filter(|(d, _)| **d != me(app))
        .map(|(device, s)| Friend {
            device: device.clone(),
            name: s.name.clone(),
            member: state
                .as_ref()
                .is_some_and(|st| st.members.iter().any(|m| &m.device == device)),
        })
        .collect();
    // Grupta olup bu dünyaya hiç girmemiş (ör. kayıt silinmiş) üyeler de görünsün.
    if let Some(st) = &state {
        for m in &st.members {
            if !friends.iter().any(|f| f.device == m.device) {
                friends.push(Friend {
                    device: m.device.clone(),
                    name: m.name.clone(),
                    member: true,
                });
            }
        }
    }
    friends.sort_by(|a, b| {
        b.member
            .cmp(&a.member)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let lease = state
        .as_ref()
        .and_then(|s| s.lease.clone())
        .filter(|l| l.until > now);
    Ok(SharedView {
        enabled: inst.shared.is_some(),
        friends,
        open_by: match (&lease, &state) {
            (Some(l), Some(s)) => Some(host::name_of(s, &l.device, owner_name.as_deref())),
            _ => None,
        },
        open_by_me: lease.as_ref().is_some_and(|l| l.device == me(app)),
        waiting_for: state.as_ref().and_then(|s| {
            let d = s.dirty.as_deref().or(
                // Süresi geçmiş kira: sunucu "kirli" sayacak.
                s.lease
                    .as_ref()
                    .filter(|l| l.until <= now)
                    .map(|l| l.device.as_str()),
            )?;
            Some(host::name_of(s, d, owner_name.as_deref()))
        }),
        generation: state.as_ref().map_or(0, |s| s.generation),
    })
}

#[tauri::command]
pub async fn shared_view(app: AppHandle, id: String) -> AppResult<SharedView> {
    if let Some(link) = instance::get(&app, &id)?.shared {
        // Görünüm açılırken taze durum (dakikalık tazelemeyi beklemesin).
        let _ = host::act(&app, &link.code, Act::State).await;
    }
    view(&app, &id)
}

/// Sahip: dünyayı ortak yapar (ya da üyeleri değiştirir). `members`: "açabilir" cihazlar.
#[tauri::command]
pub async fn set_shared(app: AppHandle, id: String, members: Vec<String>) -> AppResult<SharedView> {
    let inst = instance::get(&app, &id)?;
    if inst
        .shared
        .as_ref()
        .is_some_and(|s| s.role == SharedRole::Member)
    {
        return Err(AppError::msg(tx!(
            "Bu dünyanın sahibi sen değilsin.",
            "You're not this world's owner."
        )));
    }
    // Kısa kod gerekiyor: arkadaşlar dünyayı bu kodla bulur.
    crate::join_cmds::invite_for(&app, &id, false).await?;
    let inst = instance::get(&app, &id)?;
    let Some(short) = inst
        .short_invite
        .clone()
        .filter(|s| Some(&s.token) == inst.invite_token.as_ref())
    else {
        return Err(AppError::msg(tx!(
            "Davet sunucusuna ulaşılamadı; ortak dünya şimdi açılamıyor. İnternetini kontrol edip tekrar dene.",
            "Couldn't reach the invite server, so the world can't be shared right now. Check your internet and try again."
        )));
    };
    let meta = paths::instance_dir(&app, &id)?.join(crate::sessions::META_DIR);
    let seen = crate::players_guard::load(&meta).seen;
    let known = app
        .state::<Groups>()
        .get(&short.code)
        .map(|s| s.members)
        .unwrap_or_default();
    let list: Vec<Member> = members
        .iter()
        .map(|d| Member {
            device: d.clone(),
            name: seen
                .get(d)
                .map(|s| s.name.clone())
                .or_else(|| {
                    known
                        .iter()
                        .find(|m| &m.device == d)
                        .map(|m| m.name.clone())
                })
                .unwrap_or_default(),
        })
        .collect();
    let state = match web::put_members(&http(&app), &short, &list).await? {
        Ok(s) => s,
        Err(r) => return Err(AppError::msg(format!("{r:?}"))),
    };
    app.state::<Groups>().remember(&short.code, &state);
    if inst.shared.is_none() {
        let link = SharedLink {
            code: short.code.clone(),
            role: SharedRole::Owner,
            origin_world: id.clone(),
            owner_device: me(&app),
        };
        instance::modify(&paths::instance_dir(&app, &id)?, move |i| {
            i.shared = Some(link);
            Ok(())
        })?;
    }
    // İlk nesil: dünyanın bugünkü hâli gruba açılır.
    if state.generation == 0 {
        let running = app.state::<AppState>().servers.is_active(&id);
        if let Ok(Ok(_)) = host::act(&app, &short.code, Act::Acquire).await {
            host::publish(&app, &id, &short.code, running).await?;
            if running {
                // Açık dünya: kira tazelensin, kapanınca son hâl yayınlansın.
                host::watch(&app, &id, &short.code);
            } else {
                let _ = host::act(&app, &short.code, Act::Release).await;
            }
        }
    }
    view(&app, &id)
}

/// Sahip: ortak dünyayı kapatır; dünya yine yalnız sahibinde.
#[tauri::command]
pub async fn disable_shared(app: AppHandle, id: String) -> AppResult<SharedView> {
    let inst = instance::get(&app, &id)?;
    if let (Some(link), Some(short)) = (&inst.shared, &inst.short_invite) {
        web::disable(&http(&app), short).await?;
        app.state::<Groups>().forget(&link.code);
    }
    instance::modify(&paths::instance_dir(&app, &id)?, |i| {
        i.shared = None;
        Ok(())
    })?;
    view(&app, &id)
}

/// Sahip: en güncel hâlin kaldığı arkadaş dönmüyorsa beklemeyi kaldırır (onun son ilerlemesi gider).
#[tauri::command]
pub async fn force_shared(app: AppHandle, id: String) -> AppResult<SharedView> {
    let inst = instance::get(&app, &id)?;
    let (Some(link), Some(short)) = (&inst.shared, &inst.short_invite) else {
        return view(&app, &id);
    };
    match web::force(&http(&app), short).await? {
        Ok(s) => app.state::<Groups>().remember(&link.code, &s),
        Err(r) => {
            return Err(AppError::msg(match r {
                web::Refusal::NoCopy => tx!(
                    "Dünyanın başka bir kopyası yok; arkadaşının dönmesini beklemek gerekiyor.",
                    "There's no other copy of the world; you'll need to wait for your friend to come back."
                ),
                other => format!("{other:?}"),
            }));
        }
    }
    view(&app, &id)
}

/// Arkadaş: sahibin daveti üzerine dünyanın kopyasını kurar. Dönen: kopyanın kimliği.
#[tauri::command]
pub async fn accept_shared(app: AppHandle, joined_id: String) -> AppResult<String> {
    crate::shared::member::accept(&app, &joined_id).await
}

/// Arkadaş: "Sen aç" — kopyayı açar (kira, gerekirse son hâlin çekilmesi `start_server`'da).
#[tauri::command]
pub async fn open_shared(app: AppHandle, joined_id: String, join: Option<bool>) -> AppResult<()> {
    let w = app
        .state::<Arc<crate::join::JoinManager>>()
        .get(&joined_id)
        .await?;
    let local = crate::shared::member::local_copy(&app, &w).ok_or_else(|| {
        AppError::msg(tx!(
            "Dünyanın kopyası bu bilgisayarda yok; önce indir.",
            "The world's copy isn't on this computer yet; download it first."
        ))
    })?;
    crate::commands::start_server(
        app.clone(),
        app.state::<AppState>(),
        app.state::<crate::java::JavaManager>(),
        local.id,
        join,
    )
    .await
}

/// Sahip: başkası açıkken kendi dünyasına katılmak için katılım kaydı. Dönen: kaydın kimliği
/// (arayüz `play_joined` ile oyunu açar).
#[tauri::command]
pub async fn join_own_shared(app: AppHandle, id: String) -> AppResult<String> {
    crate::shared::member::join_own(&app, &id).await
}
