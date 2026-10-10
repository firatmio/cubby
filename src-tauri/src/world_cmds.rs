//! Dünya ayarları (`server.properties`) ve oyuncu yönetimi komutları.
//! Sunucu açıkken değişiklikler konsol komutlarıyla yapılır (sunucu kendi dosyasını yazar),
//! kapalıyken dosyalar doğrudan düzenlenir.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::instance;
use crate::paths;
use crate::players::{self, OpEntry, Profile};
use crate::properties::Properties;

/// Komut gönderildikten sonra sunucunun dosyayı yazması için kısa bekleme.
const COMMAND_SETTLE: Duration = Duration::from_millis(600);

#[derive(Serialize)]
pub struct PropertiesView {
    values: BTreeMap<String, String>,
    /// Dosya henüz yoksa (dünya hiç açılmadı) sunucu ilk açılışta kalan ayarları ekler.
    exists: bool,
}

fn properties_view(server_dir: &std::path::Path) -> AppResult<PropertiesView> {
    Ok(PropertiesView {
        values: Properties::load(server_dir)?.to_map(),
        exists: Properties::exists_on_disk(server_dir),
    })
}

#[tauri::command]
pub fn get_properties(app: AppHandle, id: String) -> AppResult<PropertiesView> {
    properties_view(&paths::server_dir(&app, &id)?)
}

fn check_int(key: &str, value: &str, min: i64, max: i64) -> AppResult<()> {
    match value.trim().parse::<i64>() {
        Ok(n) if (min..=max).contains(&n) => Ok(()),
        _ => Err(AppError::msg(format!(
            "{key}: {min} ile {max} arasında bir sayı olmalı"
        ))),
    }
}

fn check_choice(key: &str, value: &str, allowed: &[&str]) -> AppResult<()> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(AppError::msg(format!("{key}: geçersiz değer \"{value}\"")))
    }
}

/// Bilinen alanların değerleri doğrulanır; diğerleri olduğu gibi yazılır.
fn validate_property(key: &str, value: &str) -> AppResult<()> {
    match key {
        "max-players" => check_int(key, value, 1, 1000),
        "server-port" => check_int(key, value, 1024, 65535),
        "view-distance" | "simulation-distance" => check_int(key, value, 2, 32),
        "spawn-protection" => check_int(key, value, 0, 1000),
        "difficulty" => check_choice(key, value, &["peaceful", "easy", "normal", "hard"]),
        "gamemode" => check_choice(
            key,
            value,
            &["survival", "creative", "adventure", "spectator"],
        ),
        "pvp" | "hardcore" | "allow-flight" | "white-list" | "enforce-whitelist"
        | "online-mode" => check_choice(key, value, &["true", "false"]),
        "motd" if value.chars().count() > 120 => {
            Err(AppError::msg("Açıklama en fazla 120 karakter olabilir"))
        }
        _ if key.trim().is_empty() || key.contains(['\n', '\r']) => {
            Err(AppError::msg("Geçersiz ayar adı"))
        }
        _ => Ok(()),
    }
}

/// Ayarları yazar. Beyaz liste / premium modu bu yoldan değil, kendi komutlarıyla değişir
/// (UUID'lerin ve zorunlulukların tutarlı kalması için).
#[tauri::command]
pub fn update_properties(
    app: AppHandle,
    id: String,
    changes: BTreeMap<String, String>,
) -> AppResult<PropertiesView> {
    let server_dir = paths::server_dir(&app, &id)?;
    for (k, v) in &changes {
        if matches!(
            k.as_str(),
            "online-mode" | "white-list" | "enforce-whitelist"
        ) {
            return Err(AppError::msg("Bu ayar Oyuncular panelinden değiştirilir"));
        }
        validate_property(k, v)?;
    }
    let mut props = Properties::load(&server_dir)?;
    for (k, v) in &changes {
        props.set(k, v.trim());
    }
    props.save(&server_dir)?;
    if let Some(port) = changes
        .get("server-port")
        .and_then(|p| p.trim().parse().ok())
    {
        instance::modify(&paths::instance_dir(&app, &id)?, |inst| {
            inst.port = port;
            Ok(())
        })?;
    }
    properties_view(&server_dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessView {
    /// Premium olmayan oyuncular (TLauncher) girebilir mi?
    offline_mode: bool,
    whitelist_enabled: bool,
    whitelist: Vec<Profile>,
    ops: Vec<String>,
    /// Bu sunucuya daha önce girmiş oyuncular.
    known: Vec<String>,
    /// Değişiklik ancak yeniden başlatınca geçerli olacaksa açıklama.
    notice: Option<String>,
}

fn access_view(server_dir: &std::path::Path) -> AppResult<AccessView> {
    let props = Properties::load(server_dir)?;
    let mut whitelist = players::read_whitelist(server_dir);
    whitelist.sort_by_key(|p| p.name.to_lowercase());
    Ok(AccessView {
        offline_mode: props.get_bool("online-mode") == Some(false),
        whitelist_enabled: props.get_bool("white-list").unwrap_or(false),
        whitelist,
        ops: players::read_ops(server_dir)
            .into_iter()
            .map(|o| o.name)
            .collect(),
        known: players::known_names(server_dir),
        notice: None,
    })
}

#[tauri::command]
pub fn world_access(app: AppHandle, id: String) -> AppResult<AccessView> {
    access_view(&paths::server_dir(&app, &id)?)
}

fn is_offline(server_dir: &std::path::Path) -> AppResult<bool> {
    Ok(Properties::load(server_dir)?.get_bool("online-mode") == Some(false))
}

#[tauri::command]
pub async fn lookup_player(
    state: State<'_, AppState>,
    name: String,
    offline: bool,
) -> AppResult<Profile> {
    players::resolve(&state.http, &name, offline).await
}

async fn run_command(app: &AppHandle, state: &AppState, id: &str, command: &str) -> AppResult<()> {
    state.servers.send_command(app, id, command).await?;
    tokio::time::sleep(COMMAND_SETTLE).await;
    Ok(())
}

#[tauri::command]
pub async fn whitelist_add(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<AccessView> {
    let server_dir = paths::server_dir(&app, &id)?;
    // Hesap yoksa (premium modda) eklemeden önce açıkça söyle.
    let offline = is_offline(&server_dir)?;
    let profile = players::resolve(&state.http, &name, offline).await?;
    let active = state.servers.is_active(&id);
    if active && !offline {
        run_command(
            &app,
            &state,
            &id,
            &format!("whitelist add {}", profile.name),
        )
        .await?;
    } else {
        // Premium olmayan modda sunucunun `whitelist add` komutu ismi Mojang'da arar ve premium
        // UUID yazar; TLauncher oyuncusu (offline UUID) yine giremez. Dosyayı biz yazarız.
        let mut list = players::read_whitelist(&server_dir);
        players::upsert(&mut list, profile.clone());
        players::write_whitelist(&server_dir, &list)?;
        if active {
            run_command(&app, &state, &id, "whitelist reload").await?;
        }
    }
    state.servers.forget_rejected(&app, &id, &profile.name);
    let mut view = access_view(&server_dir)?;
    // Sunucu dosyayı henüz yazmadıysa bile listede görünsün.
    if !view
        .whitelist
        .iter()
        .any(|p| p.name.eq_ignore_ascii_case(&profile.name))
    {
        view.whitelist.push(profile);
    }
    Ok(view)
}

#[tauri::command]
pub async fn whitelist_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<AccessView> {
    let server_dir = paths::server_dir(&app, &id)?;
    let name = players::validate_name(&name)?;
    let active = state.servers.is_active(&id);
    if active && !is_offline(&server_dir)? {
        run_command(&app, &state, &id, &format!("whitelist remove {name}")).await?;
    } else {
        let mut list = players::read_whitelist(&server_dir);
        list.retain(|p| !p.name.eq_ignore_ascii_case(&name));
        players::write_whitelist(&server_dir, &list)?;
        if active {
            run_command(&app, &state, &id, "whitelist reload").await?;
        }
    }
    let mut view = access_view(&server_dir)?;
    view.whitelist
        .retain(|p| !p.name.eq_ignore_ascii_case(&name));
    Ok(view)
}

#[tauri::command]
pub async fn set_whitelist_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    on: bool,
) -> AppResult<AccessView> {
    let server_dir = paths::server_dir(&app, &id)?;
    if !on && is_offline(&server_dir)? {
        return Err(AppError::msg(
            "Premium olmayanlar girebilirken beyaz liste kapatılamaz: adresi bilen biri adını taklit edebilir",
        ));
    }
    let mut props = Properties::load(&server_dir)?;
    props.set("white-list", on.to_string());
    props.set("enforce-whitelist", on.to_string());
    props.save(&server_dir)?;
    if state.servers.is_active(&id) {
        run_command(
            &app,
            &state,
            &id,
            if on { "whitelist on" } else { "whitelist off" },
        )
        .await?;
    }
    access_view(&server_dir)
}

/// TLauncher desteği: premium olmayan hesaplar (`online-mode=false`). Açılınca beyaz liste
/// zorunlu açılır; mevcut liste ve yetkililer yeni moda göre yeniden UUID'lenir.
#[tauri::command]
pub async fn set_offline_mode(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    offline: bool,
) -> AppResult<AccessView> {
    if state.servers.is_active(&id) {
        return Err(AppError::msg(
            "Bu ayarı değiştirmek için önce dünyayı kapat",
        ));
    }
    let server_dir = paths::server_dir(&app, &id)?;
    let mut props = Properties::load(&server_dir)?;
    props.set("online-mode", (!offline).to_string());
    if offline {
        props.set("white-list", "true");
        props.set("enforce-whitelist", "true");
    }
    props.save(&server_dir)?;
    let dropped = players::rekey(&state.http, &server_dir, offline).await?;
    if !dropped.is_empty() {
        return Err(AppError::msg(format!(
            "Premium hesabı bulunamadığı için beyaz listeden çıkarıldı: {}",
            dropped.join(", ")
        )));
    }
    access_view(&server_dir)
}

#[tauri::command]
pub async fn set_op(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    op: bool,
) -> AppResult<AccessView> {
    let server_dir = paths::server_dir(&app, &id)?;
    let name = players::validate_name(&name)?;
    let offline = is_offline(&server_dir)?;
    let active = state.servers.is_active(&id);
    // Bağlı oyuncu için komut doğru profili (offline UUID dahil) kullanır.
    let connected = state
        .servers
        .snapshot(&id)
        .players
        .iter()
        .any(|p| p.eq_ignore_ascii_case(&name));
    let mut notice = None;
    if active && (!offline || connected) {
        let cmd = if op {
            format!("op {name}")
        } else {
            format!("deop {name}")
        };
        run_command(&app, &state, &id, &cmd).await?;
    } else {
        let mut ops = players::read_ops(&server_dir);
        ops.retain(|o| !o.name.eq_ignore_ascii_case(&name));
        if op {
            let p = players::resolve(&state.http, &name, offline).await?;
            ops.push(OpEntry {
                uuid: p.uuid,
                name: p.name,
                level: 4,
                bypasses_player_limit: false,
            });
        }
        players::write_ops(&server_dir, &ops)?;
        if active {
            notice = Some("Yetki dünya yeniden açılınca geçerli olur".to_string());
        }
    }
    let mut view = access_view(&server_dir)?;
    view.ops.retain(|n| !n.eq_ignore_ascii_case(&name));
    if op {
        view.ops.push(name);
    }
    view.notice = notice;
    Ok(view)
}

#[tauri::command]
pub async fn kick_player(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> AppResult<()> {
    let name = players::validate_name(&name)?;
    state
        .servers
        .send_command(&app, &id, &format!("kick {name}"))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_known_properties() {
        assert!(validate_property("max-players", "8").is_ok());
        assert!(validate_property("max-players", "0").is_err());
        assert!(validate_property("server-port", "80").is_err());
        assert!(validate_property("difficulty", "hard").is_ok());
        assert!(validate_property("difficulty", "kolay").is_err());
        assert!(validate_property("pvp", "yes").is_err());
        assert!(validate_property("motd", "Kardeşlerle survival").is_ok());
        assert!(validate_property("level-seed", "herhangi").is_ok());
        assert!(validate_property("", "x").is_err());
    }

    #[test]
    fn access_view_defaults() {
        let dir = std::env::temp_dir().join(format!("mcsm-access-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let v = access_view(&dir).unwrap();
        assert!(!v.offline_mode && !v.whitelist_enabled && v.whitelist.is_empty());

        let mut p = Properties::default();
        p.set("online-mode", "false");
        p.set("white-list", "true");
        p.save(&dir).unwrap();
        let v = access_view(&dir).unwrap();
        assert!(v.offline_mode && v.whitelist_enabled);
        let _ = std::fs::remove_dir_all(dir);
    }
}
