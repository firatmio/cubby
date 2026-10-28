//! Davet sayfasını canlı tutar: davet edenin adı, kapak, oyuncuda gereken mod sayısı (`meta`) ve
//! dünyanın açık/kapalı durumu ile oyuncu sayısı (`status`). Yalnız geçerli bir kısa kodu olan
//! dünyalar için; hatalar yalnız günlüğe (davet sayfası süs, oyunu etkilemez). Oyuncu isimleri
//! gönderilmez.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Listener, Manager};

use crate::commands::AppState;
use crate::covers::COVER_FILE;
use crate::instance::{self, Instance};
use crate::properties::Properties;
use crate::sessions::META_DIR;
use crate::settings::SettingsStore;
use crate::short_invite::{self, ShortInvite};
use crate::{client, mods, paths};

/// Açık dünyanın durumu bu sıklıkla tazelenir (sunucuda 6 dk sonra düşer).
const HEARTBEAT: Duration = Duration::from_secs(120);
/// Art arda gelen değişiklikler (giriş/çıkış) tek gönderimde toplanır.
const DEBOUNCE: Duration = Duration::from_secs(3);

// ---- Davet edenin adı ----

/// Resmi Launcher'ın hesap dosyası: etkin hesabın Minecraft adı.
pub fn name_from_launcher_accounts(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let accounts = v.get("accounts")?.as_object()?;
    let name = |a: &serde_json::Value| {
        a.pointer("/minecraftProfile/name")
            .and_then(|n| n.as_str())
            .filter(|n| !n.is_empty())
            .map(str::to_string)
    };
    v.get("activeAccountLocalId")
        .and_then(|id| id.as_str())
        .and_then(|id| accounts.get(id))
        .and_then(name)
        .or_else(|| accounts.values().find_map(name))
}

/// TLauncher'ın hesap dosyası: seçili hesabın görünen adı.
pub fn name_from_tlauncher(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let accounts = v.get("accounts")?.as_object()?;
    let name = |a: &serde_json::Value| {
        ["displayName", "username"]
            .iter()
            .find_map(|k| a.get(*k).and_then(|n| n.as_str()))
            .filter(|n| !n.is_empty())
            .map(str::to_string)
    };
    v.get("selectedAccountUUID")
        .and_then(|id| id.as_str())
        .and_then(|id| accounts.get(id))
        .and_then(name)
        .or_else(|| accounts.values().find_map(name))
}

/// Oyunun kendi `usercache.json`'ı yalnız bir kişi içeriyorsa o, bu bilgisayarın oyuncusudur.
pub fn name_from_usercache(json: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Entry {
        name: String,
    }
    let list: Vec<Entry> = serde_json::from_str(json).ok()?;
    match list.as_slice() {
        [only] if !only.name.is_empty() => Some(only.name.clone()),
        _ => None,
    }
}

/// Bu bilgisayardaki oyuncunun adı: Launcher, TLauncher, sonra oyunun önbelleği.
pub fn detect_player_name(minecraft: &Path) -> Option<String> {
    let read = |f: &str| std::fs::read_to_string(minecraft.join(f)).ok();
    [
        "launcher_accounts_microsoft_store.json",
        "launcher_accounts.json",
    ]
    .iter()
    .find_map(|f| read(f).as_deref().and_then(name_from_launcher_accounts))
    .or_else(|| {
        ["TlauncherProfiles.json", "tlauncher_profiles.json"]
            .iter()
            .find_map(|f| read(f).as_deref().and_then(name_from_tlauncher))
    })
    .or_else(|| {
        read("usercache.json")
            .as_deref()
            .and_then(name_from_usercache)
    })
}

/// Ayardaki ad, yoksa bulunan.
pub fn player_name(app: &AppHandle) -> Option<String> {
    let store = app.state::<SettingsStore>();
    store
        .get()
        .player_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .or_else(|| store.minecraft_dir().and_then(|d| detect_player_name(&d)))
}

// ---- Meta ----

/// Dünyanın geçerli kısa kodu (davet anahtarı yenilendiyse eskisi sayılmaz).
fn current_short(inst: &Instance) -> Option<ShortInvite> {
    inst.short_invite
        .clone()
        .filter(|s| Some(&s.token) == inst.invite_token.as_ref())
}

/// Arkadaşın Minecraft'ında olması gereken mod sayısı.
fn required_mods(app: &AppHandle, inst: &Instance) -> usize {
    if !inst.loader.is_modded() {
        return 0;
    }
    let (Ok(server), Ok(meta)) = (
        paths::server_dir(app, &inst.id),
        paths::instance_dir(app, &inst.id),
    ) else {
        return 0;
    };
    client::manifest::build_with(
        &server.join("mods"),
        &mods::load_records(&meta.join(META_DIR)),
        inst.loader,
        false,
    )
    .iter()
    .filter(|m| m.need == client::manifest::Need::Required)
    .count()
}

async fn publish_meta(app: &AppHandle, id: &str) -> crate::error::AppResult<()> {
    let inst = instance::get(app, id)?;
    let Some(short) = current_short(&inst) else {
        return Ok(());
    };
    let http = app.state::<AppState>().http.clone();
    let meta_dir = paths::instance_dir(app, id)?.join(META_DIR);
    let version = inst.cover.as_ref().map(|c| c.version);
    // Kapak yalnız sürümü değiştiyse yüklenir.
    let jpeg = match version {
        Some(v) if short.cover_sent != Some(v) => {
            let src = meta_dir.join(COVER_FILE);
            tauri::async_runtime::spawn_blocking(move || crate::covers::share_jpeg(&src))
                .await
                .map_err(|e| crate::error::AppError::msg(e.to_string()))?
                .ok()
                .map(|bytes| (bytes, v))
        }
        _ => None,
    };
    let cover = match (&jpeg, version, short.cover_sent) {
        (Some((bytes, v)), _, _) => Some(Some((bytes.as_slice(), *v))),
        (None, None, Some(_)) => Some(None),
        _ => None,
    };
    let host = player_name(app);
    let mods = required_mods(app, &inst);
    // Hiçbir şey değişmediyse (ör. her açılışta) davet sunucusuna yeniden gidilmez.
    let signature = format!("{host:?}|{mods}|{version:?}");
    if cover.is_none() && short.meta_sent.as_deref() == Some(signature.as_str()) {
        return Ok(());
    }
    short_invite::publish_meta(&http, &short, host.as_deref(), mods, cover).await?;
    let sent_cover = cover.is_some().then(|| jpeg.map(|(_, v)| v));
    let dir = paths::instance_dir(app, id)?;
    let code = short.code.clone();
    instance::modify(&dir, move |i| {
        if let Some(s) = i.short_invite.as_mut().filter(|s| s.code == code) {
            if let Some(c) = sent_cover {
                s.cover_sent = c;
            }
            s.meta_sent = Some(signature);
        }
        Ok(())
    })?;
    Ok(())
}

/// Arkada meta gönderir (kısa kod oluştu/tazelendi, kapak ya da ad değişti).
pub fn spawn_meta(app: &AppHandle, id: &str) {
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = publish_meta(&app, &id).await {
            eprintln!("Davet sayfası bilgileri gönderilemedi: {e}");
        }
    });
}

/// Ad değişti (ya da uygulama açıldı): kısa kodu olan bütün dünyaların sayfası güncellensin.
pub fn spawn_meta_all(app: &AppHandle) {
    for inst in instance::list(app) {
        if current_short(&inst).is_some() {
            spawn_meta(app, &inst.id);
        }
    }
}

// ---- Canlı durum ----

#[derive(Default)]
pub struct LiveStatus {
    /// Açık dünyalar (kalp atışı bunlar için).
    running: Mutex<HashSet<String>>,
    /// Dünya başına son planlanan gönderimin sırası (bekleme sırasında yenisi geldiyse eskisi düşer).
    pending: Mutex<HashMap<String, u64>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

async fn publish_status(app: &AppHandle, id: &str) -> crate::error::AppResult<()> {
    let inst = instance::get(app, id)?;
    // Ortak dünyada canlı durumu, dünyayı açık tutanın kirası yazar (sahip olmayabilir).
    if inst.shared.is_some() {
        return Ok(());
    }
    let Some(short) = current_short(&inst) else {
        return Ok(());
    };
    let snap = app.state::<AppState>().servers.snapshot(id);
    let running = snap.status == crate::server::ServerStatus::Running;
    let max = paths::server_dir(app, id)
        .ok()
        .and_then(|d| Properties::load(&d).ok())
        .and_then(|p| p.get("max-players").and_then(|v| v.parse().ok()))
        .unwrap_or(20);
    // "Kapalı" davetle birlikte kalır: zaten gönderildiyse (ör. her açılışta) tekrar gidilmez.
    if !running && short.status_sent == Some(false) {
        return Ok(());
    }
    let http = app.state::<AppState>().http.clone();
    short_invite::publish_status(&http, &short, running, snap.players.len(), max).await?;
    if short.status_sent != Some(running) {
        let code = short.code.clone();
        instance::modify(&paths::instance_dir(app, id)?, move |i| {
            if let Some(s) = i.short_invite.as_mut().filter(|s| s.code == code) {
                s.status_sent = Some(running);
            }
            Ok(())
        })?;
    }
    Ok(())
}

/// Kısa bir beklemeden sonra gönderir; arada yeni bir değişiklik geldiyse yalnız sonuncusu gider.
fn schedule(app: &AppHandle, id: &str) {
    let live = app.state::<LiveStatus>();
    let ticket = {
        let mut p = lock(&live.pending);
        let t = p.get(id).copied().unwrap_or(0) + 1;
        p.insert(id.to_string(), t);
        t
    };
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DEBOUNCE).await;
        if lock(&app.state::<LiveStatus>().pending).get(&id) != Some(&ticket) {
            return;
        }
        if let Err(e) = publish_status(&app, &id).await {
            eprintln!("Dünya durumu davet sayfasına gönderilemedi: {e}");
        }
    });
}

#[derive(Deserialize)]
struct StatusPayload {
    id: String,
    status: String,
}

#[derive(Deserialize)]
struct PlayersPayload {
    id: String,
}

/// Sunucu durumu ve oyuncu olaylarını dinler; açık dünyalar için düzenli kalp atışı.
pub fn install(app: &AppHandle) {
    app.manage(LiveStatus::default());
    // Açılışta bir kez: güncellemeden önce alınmış kodların sayfası da ad ve kapağa kavuşsun (kapak
    // yalnız değiştiyse yüklenir), durumu da bilinsin ("Şu an kapalı"; o sırada açılan dünya
    // gerçek durumunu gönderir). Açılışın işine karışmasın diye biraz sonra.
    let boot = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
        spawn_meta_all(&boot);
        for inst in instance::list(&boot) {
            if current_short(&inst).is_some() {
                schedule(&boot, &inst.id);
            }
        }
    });
    let handle = app.clone();
    app.listen_any(crate::server::EVENT_STATUS, move |event| {
        let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload()) else {
            return;
        };
        let live = handle.state::<LiveStatus>();
        match p.status.as_str() {
            "running" => {
                lock(&live.running).insert(p.id.clone());
            }
            "stopped" | "crashed" => {
                lock(&live.running).remove(&p.id);
            }
            _ => return,
        }
        schedule(&handle, &p.id);
    });

    let handle = app.clone();
    app.listen_any(crate::server::EVENT_PLAYERS, move |event| {
        if let Ok(p) = serde_json::from_str::<PlayersPayload>(event.payload()) {
            schedule(&handle, &p.id);
        }
    });

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(HEARTBEAT).await;
            let ids: Vec<String> = lock(&handle.state::<LiveStatus>().running)
                .iter()
                .cloned()
                .collect();
            for id in ids {
                if let Err(e) = publish_status(&handle, &id).await {
                    eprintln!("Dünya durumu davet sayfasına gönderilemedi: {e}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_active_launcher_account() {
        let json = r#"{"accounts":{
            "a":{"minecraftProfile":{"id":"1","name":"Other"}},
            "b":{"minecraftProfile":{"id":"2","name":"firatmio"},"accessToken":"secret"}
        },"activeAccountLocalId":"b"}"#;
        assert_eq!(
            name_from_launcher_accounts(json).as_deref(),
            Some("firatmio")
        );
        // Etkin hesap yoksa ilk adlı hesap; profil yoksa hiç.
        let no_active = r#"{"accounts":{"a":{"minecraftProfile":{"name":"Steve"}}}}"#;
        assert_eq!(
            name_from_launcher_accounts(no_active).as_deref(),
            Some("Steve")
        );
        assert_eq!(
            name_from_launcher_accounts(r#"{"accounts":{"a":{}}}"#),
            None
        );
        assert_eq!(name_from_launcher_accounts("not json"), None);
    }

    #[test]
    fn reads_tlauncher_and_usercache() {
        let tl = r#"{"accounts":{"u1":{"username":"alex","displayName":"Alex"}},"selectedAccountUUID":"u1"}"#;
        assert_eq!(name_from_tlauncher(tl).as_deref(), Some("Alex"));
        assert_eq!(
            name_from_usercache(r#"[{"name":"firatmio","uuid":"x","expiresOn":"y"}]"#).as_deref(),
            Some("firatmio")
        );
        // Birden çok kişi: kim olduğu belli değil.
        assert_eq!(name_from_usercache(r#"[{"name":"a"},{"name":"b"}]"#), None);
    }

    #[test]
    fn detects_from_a_minecraft_folder() {
        let dir = std::env::temp_dir().join(format!("cubby-name-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(detect_player_name(&dir), None);
        std::fs::write(dir.join("usercache.json"), r#"[{"name":"cache"}]"#).unwrap();
        assert_eq!(detect_player_name(&dir).as_deref(), Some("cache"));
        std::fs::write(
            dir.join("launcher_accounts.json"),
            r#"{"accounts":{"a":{"minecraftProfile":{"name":"launcher"}}},"activeAccountLocalId":"a"}"#,
        )
        .unwrap();
        assert_eq!(detect_player_name(&dir).as_deref(), Some("launcher"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
