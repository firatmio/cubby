//! Otomatik güncelleme. Cubby'nin uç noktası (`consts::UPDATE_URL`, Vercel) GitHub Releases'tan
//! kanala göre son sürümü verir. Arkada denetlenir ve (ayar açıksa) indirilir; kurulum kullanıcıya
//! sorulur ya da uygulama kapatılırken sessizce yapılır. Asla kendiliğinden yeniden başlatılmaz.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::consts::UPDATE_URL;
use crate::error::{AppError, AppResult};
use crate::settings::SettingsStore;

pub const EVENT_STATE: &str = "update://state";
const FIRST_CHECK: Duration = Duration::from_secs(20);
/// Uygulama günlerce görev çubuğunda açık kalabiliyor: saatte bir bakılır (uç CDN'de önbellekli, ucuz).
const INTERVAL: Duration = Duration::from_secs(60 * 60);
/// Denetim başarısızsa (ör. bilgisayar yeni açıldı, ağ hazır değil) kısa süre sonra yeniden.
const RETRY: Duration = Duration::from_secs(5 * 60);
/// Pencere öne gelince, son denetimden bu kadar geçtiyse hemen bakılır.
const ON_FOCUS: Duration = Duration::from_secs(15 * 60);
const META_FILE: &str = "update.json";

/// Arayüzün gördüğü durum.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Status {
    #[default]
    Idle,
    Checking,
    UpToDate,
    /// Yeni sürüm var, kendiliğinden indirme kapalı.
    #[serde(rename_all = "camelCase")]
    Available {
        version: String,
        notes: String,
    },
    #[serde(rename_all = "camelCase")]
    Downloading {
        version: String,
        downloaded: u64,
        total: Option<u64>,
    },
    /// İndi, doğrulandı; yeniden başlatınca (ya da kapatınca) kurulur.
    #[serde(rename_all = "camelCase")]
    Ready {
        version: String,
        notes: String,
    },
    Installing,
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
    },
    /// Geliştirme derlemesi: güncellenmez.
    Dev,
}

#[derive(Default)]
pub struct Updates {
    status: Mutex<Status>,
    update: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
    /// Aynı anda tek denetim/indirme.
    busy: tokio::sync::Mutex<()>,
    /// Son denetimin başladığı an (pencere öne gelince yeniden bakmak için).
    last_check: Mutex<Option<Instant>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn set(app: &AppHandle, status: Status) {
    *lock(&app.state::<Updates>().status) = status;
    let _ = app.emit(EVENT_STATE, view(app, false));
}

/// Deneme sürümü kullanan (ör. `0.2.0-beta.1`) zaten test ediyordur: ayar kapalı olsa da sonraki
/// deneme sürümleri gelir.
pub fn wants_beta(setting: bool, current: &str) -> bool {
    setting || current.contains('-')
}

/// Kanala göre uç adresi; `{{…}}` yerlerini güncelleyici doldurur.
pub fn endpoint(beta: bool) -> String {
    let channel = if beta { "beta" } else { "stable" };
    format!(
        "{UPDATE_URL}?channel={channel}&target={{{{target}}}}&arch={{{{arch}}}}&current={{{{current_version}}}}"
    )
}

fn failed(e: impl std::fmt::Display) -> AppError {
    AppError::msg(tx!(
        "Güncelleme denetlenemedi: {e}",
        "Couldn't check for updates: {e}"
    ))
}

/// Yeni sürüm var mı; varsa ve `download` ise indirir.
async fn check(app: &AppHandle, download: bool) -> AppResult<()> {
    let state = app.state::<Updates>();
    let Ok(_guard) = state.busy.try_lock() else {
        return Ok(());
    };
    // Zaten inmiş bir güncelleme varsa yeniden bakılmaz (kurulmayı bekliyor).
    if matches!(
        *lock(&state.status),
        Status::Ready { .. } | Status::Installing
    ) {
        return Ok(());
    }
    *lock(&state.last_check) = Some(Instant::now());
    set(app, Status::Checking);
    let beta = wants_beta(
        app.state::<SettingsStore>().get().beta_updates,
        &app.package_info().version.to_string(),
    );
    let url = endpoint(beta).parse().map_err(failed)?;
    let result = async {
        app.updater_builder()
            .endpoints(vec![url])
            .map_err(failed)?
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(failed)?
            .check()
            .await
            .map_err(failed)
    }
    .await;
    let update = match result {
        Ok(Some(u)) => u,
        Ok(None) => {
            *lock(&state.update) = None;
            set(app, Status::UpToDate);
            return Ok(());
        }
        Err(e) => {
            set(
                app,
                Status::Error {
                    message: e.to_string(),
                },
            );
            return Err(e);
        }
    };
    let (version, notes) = (
        update.version.clone(),
        update.body.clone().unwrap_or_default(),
    );
    *lock(&state.update) = Some(update);
    if download {
        fetch(app).await
    } else {
        set(app, Status::Available { version, notes });
        Ok(())
    }
}

/// Bulunan güncellemeyi indirir (imzası doğrulanır).
async fn fetch(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<Updates>();
    let Some(update) = lock(&state.update).clone() else {
        return Ok(());
    };
    let version = update.version.clone();
    let notes = update.body.clone().unwrap_or_default();
    let mut downloaded = 0u64;
    let mut last = Instant::now();
    set(
        app,
        Status::Downloading {
            version: version.clone(),
            downloaded: 0,
            total: None,
        },
    );
    let result = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last.elapsed() >= Duration::from_millis(250) {
                    last = Instant::now();
                    set(
                        app,
                        Status::Downloading {
                            version: version.clone(),
                            downloaded,
                            total,
                        },
                    );
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            *lock(&state.bytes) = Some(bytes);
            set(app, Status::Ready { version, notes });
            Ok(())
        }
        Err(e) => {
            let e = AppError::msg(tx!(
                "Güncelleme indirilemedi: {e}",
                "Couldn't download the update: {e}"
            ));
            set(
                app,
                Status::Error {
                    message: e.to_string(),
                },
            );
            Err(e)
        }
    }
}

/// Açılıştan biraz sonra ve birkaç saatte bir sessizce bakar. Geliştirme derlemesinde bakmaz.
pub fn spawn(app: &AppHandle) {
    if cfg!(debug_assertions) {
        set(app, Status::Dev);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let auto = app.state::<SettingsStore>().get().auto_update;
            let wait = match check(&app, auto).await {
                Ok(()) => INTERVAL,
                Err(e) => {
                    eprintln!("{e}");
                    RETRY
                }
            };
            tokio::time::sleep(wait).await;
        }
    });
}

/// Pencere öne geldi: son denetim eskiyse hemen bakılır. Uyku modundan
/// dönen bilgisayarda bekleyen zamanlayıcıyı beklemeye gerek kalmaz.
pub fn nudge(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    // Kurulumdan önce pencere odak alabilir; durum henüz yoksa bakılmaz (ilk denetim zaten gelecek).
    let Some(state) = app.try_state::<Updates>() else {
        return;
    };
    // Hiç bakılmadıysa açılıştaki ilk denetim (20 sn sonra) zaten gelecek.
    let stale = lock(&state.last_check).is_some_and(|t| t.elapsed() >= ON_FOCUS);
    if !stale {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let auto = app.state::<SettingsStore>().get().auto_update;
        if let Err(e) = check(&app, auto).await {
            eprintln!("{e}");
        }
    });
}

/// Ayar değişti (ör. deneme kanalı açıldı): hemen yeniden bakılır. Hazırda bekleyen bir sürüm başka
/// kanaldansa bırakılır.
pub fn recheck(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let state = app.state::<Updates>();
    *lock(&state.update) = None;
    *lock(&state.bytes) = None;
    *lock(&state.status) = Status::Idle;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let auto = app.state::<SettingsStore>().get().auto_update;
        let _ = check(&app, auto).await;
    });
}

pub fn is_ready(app: &AppHandle) -> bool {
    lock(&app.state::<Updates>().bytes).is_some()
}

/// İnmiş güncellemeyi kurar. Windows'ta kurulum başlayınca uygulama kapanır; `restart` ise kurulum
/// bitince yeni sürüm açılır. Bekleyen güncelleme yoksa bir şey yapmaz.
pub fn install_ready(app: &AppHandle, restart: bool) -> AppResult<()> {
    let state = app.state::<Updates>();
    let (Some(update), Some(bytes)) = (lock(&state.update).clone(), lock(&state.bytes).take())
    else {
        return Ok(());
    };
    set(app, Status::Installing);
    save_meta(
        app,
        &Meta {
            whats_new: Some(WhatsNew {
                version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
            }),
        },
    );
    let result = update
        .restart_after_install(restart)
        .install(&bytes)
        .map_err(|e| {
            AppError::msg(tx!(
                "Güncelleme kurulamadı: {e}",
                "Couldn't install the update: {e}"
            ))
        });
    if let Err(e) = &result {
        *lock(&state.bytes) = Some(bytes);
        set(
            app,
            Status::Error {
                message: e.to_string(),
            },
        );
    }
    result
}

// ---- Kurulumdan sonra "Neler yeni" ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsNew {
    pub version: String,
    pub notes: String,
}

/// Ayarlardan ayrı tutulur: arayüz ayarları bütün olarak kaydettiği için üzerine yazılmasın.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Meta {
    whats_new: Option<WhatsNew>,
}

fn meta_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(META_FILE))
}

fn load_meta(app: &AppHandle) -> Meta {
    meta_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_meta(app: &AppHandle, meta: &Meta) {
    if let Some(p) = meta_path(app)
        && let Ok(json) = serde_json::to_vec_pretty(meta)
    {
        let _ = std::fs::write(p, json);
    }
}

/// Kurulan sürüm şimdi çalışıyorsa notlarını bir kez verir.
fn take_whats_new(meta: &mut Meta, current: &str) -> Option<WhatsNew> {
    let w = meta.whats_new.take()?;
    (w.version == current).then_some(w)
}

// ---- Komutlar ----

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateView {
    current: String,
    status: Status,
    /// Minecraft açık mı (yeniden başlatma penceresi uyarır). Süreç taraması pahalı: yalnız
    /// `update_status`'ta bakılır, olaylarda `false`.
    minecraft_running: bool,
}

fn view(app: &AppHandle, with_minecraft: bool) -> UpdateView {
    UpdateView {
        current: app.package_info().version.to_string(),
        status: lock(&app.state::<Updates>().status).clone(),
        minecraft_running: with_minecraft && crate::join::client::minecraft_running(),
    }
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateView {
    view(&app, true)
}

/// "Şimdi denetle": otomatik indirme açıksa bulunan sürüm de iner.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    settings: State<'_, SettingsStore>,
) -> AppResult<UpdateView> {
    if cfg!(debug_assertions) {
        set(&app, Status::Dev);
        return Ok(view(&app, false));
    }
    let _ = check(&app, settings.get().auto_update).await;
    Ok(view(&app, false))
}

#[tauri::command]
pub async fn update_download(app: AppHandle) -> AppResult<UpdateView> {
    let state = app.state::<Updates>();
    let _guard = state.busy.lock().await;
    fetch(&app).await?;
    Ok(view(&app, false))
}

/// Dünyaları düzgünce kapatır, sonra kurar; kurulum bitince Cubby yeni sürümle açılır.
#[tauri::command]
pub fn update_install(app: AppHandle) -> AppResult<()> {
    if !is_ready(&app) {
        return Err(AppError::msg(tx!(
            "Kurulacak bir güncelleme yok.",
            "There's no update to install."
        )));
    }
    crate::shutdown(&app, true);
    Ok(())
}

/// Güncellemeden sonraki ilk açılışta bir kez: hangi sürüme geçildi ve neler yeni.
#[tauri::command]
pub fn update_whats_new(app: AppHandle) -> Option<WhatsNew> {
    let mut meta = load_meta(&app);
    let current = app.package_info().version.to_string();
    let found = take_whats_new(&mut meta, &current);
    if meta.whats_new.is_none() {
        save_meta(&app, &meta);
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_per_channel() {
        let stable = endpoint(false);
        assert!(stable.starts_with(UPDATE_URL));
        assert!(stable.contains("channel=stable"));
        assert!(stable.contains("current={{current_version}}"));
        assert!(stable.contains("target={{target}}") && stable.contains("arch={{arch}}"));
        assert!(endpoint(true).contains("channel=beta"));
        assert!(endpoint(true).parse::<reqwest::Url>().is_ok());
    }

    #[test]
    fn prerelease_users_stay_on_beta() {
        assert!(!wants_beta(false, "0.2.0"));
        assert!(wants_beta(true, "0.2.0"));
        assert!(wants_beta(false, "0.2.0-beta.1"));
    }

    #[test]
    fn whats_new_once_and_only_for_that_version() {
        let note = |v: &str| WhatsNew {
            version: v.into(),
            notes: "- yeni".into(),
        };
        let mut meta = Meta {
            whats_new: Some(note("0.2.0")),
        };
        assert_eq!(take_whats_new(&mut meta, "0.2.0"), Some(note("0.2.0")));
        assert_eq!(take_whats_new(&mut meta, "0.2.0"), None);
        // Kurulum olmadıysa (eski sürüm hâlâ çalışıyor) not gösterilmez ve düşer.
        let mut meta = Meta {
            whats_new: Some(note("0.3.0")),
        };
        assert_eq!(take_whats_new(&mut meta, "0.2.0"), None);
        assert!(meta.whats_new.is_none());
    }

    #[test]
    fn status_serializes_with_tag() {
        let s = serde_json::to_value(Status::Downloading {
            version: "0.2.0".into(),
            downloaded: 5,
            total: Some(10),
        })
        .unwrap();
        assert_eq!(s["state"], "downloading");
        assert_eq!(s["total"], 10);
        assert_eq!(
            serde_json::to_value(Status::UpToDate).unwrap()["state"],
            "upToDate"
        );
    }
}
