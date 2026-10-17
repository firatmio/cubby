//! Uygulama geneli ayarlar (`app_data/settings.json`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Oyunun klasörü (TLauncher farklı kullanıyorsa); `None` = varsayılan `.minecraft`.
    pub minecraft_dir: Option<PathBuf>,
    /// Ekran görüntülerinden dünya kapağı seçilsin mi?
    pub use_screenshots: bool,
    /// Minecraft EULA'sı bir kez kabul edildi; yeni dünyalarda tekrar sorulmaz.
    pub eula_accepted: bool,
    /// Modlu dünyaların oyuncuda gereken modları kendi Minecraft'ıma da (dünyaya özel profile) kurulsun.
    pub client_sync: bool,
    /// Arayüz dili: `"tr"` / `"en"`; `None` = bilgisayarın dili.
    pub language: Option<String>,
    /// Animasyonlar: `"full"` / `"simple"`; `None` = otomatik (bilgisayar zorlanırsa sadeleşir).
    pub animations: Option<String>,
    /// Yeni sürüm arkada kendiliğinden insin (kurulum yine sorulur).
    pub auto_update: bool,
    /// Deneme sürümleri (GitHub'da pre-release) de gelsin.
    pub beta_updates: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minecraft_dir: None,
            use_screenshots: true,
            eula_accepted: false,
            client_sync: true,
            language: None,
            animations: None,
            auto_update: true,
            beta_updates: false,
        }
    }
}

/// İşletim sisteminin varsayılan Minecraft klasörü.
pub fn default_minecraft_dir() -> Option<PathBuf> {
    let env = |v: &str| std::env::var_os(v).map(PathBuf::from);
    if cfg!(windows) {
        env("APPDATA").map(|p| p.join(".minecraft"))
    } else if cfg!(target_os = "macos") {
        env("HOME").map(|p| p.join("Library/Application Support/minecraft"))
    } else {
        env("HOME").map(|p| p.join(".minecraft"))
    }
}

pub struct SettingsStore {
    file: PathBuf,
    inner: Mutex<AppSettings>,
}

impl SettingsStore {
    pub fn load(app_data: &Path) -> Self {
        let file = app_data.join(SETTINGS_FILE);
        let inner = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let store = Self {
            file,
            inner: Mutex::new(inner),
        };
        crate::i18n::set_lang(store.lang());
        store
    }

    /// Etkin dil (ayar, yoksa bilgisayarın dili).
    pub fn lang(&self) -> crate::i18n::Lang {
        crate::i18n::effective(self.get().language.as_deref())
    }

    pub fn get(&self) -> AppSettings {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set(&self, new: AppSettings) -> AppResult<()> {
        if let Some(dir) = &new.minecraft_dir
            && !dir.is_dir()
        {
            return Err(AppError::msg(tx!(
                "Seçilen Minecraft klasörü bulunamadı",
                "The selected Minecraft folder was not found"
            )));
        }
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&new)?)?;
        std::fs::rename(tmp, &self.file)?;
        *self.inner.lock().unwrap_or_else(|e| e.into_inner()) = new;
        crate::i18n::set_lang(self.lang());
        Ok(())
    }

    /// Geçerli Minecraft klasörü (ayar ya da varsayılan).
    pub fn minecraft_dir(&self) -> Option<PathBuf> {
        self.get().minecraft_dir.or_else(default_minecraft_dir)
    }

    pub fn screenshots_dir(&self) -> Option<PathBuf> {
        self.minecraft_dir().map(|d| d.join("screenshots"))
    }

    /// Ana `screenshots` + dünya profillerinin (`.minecraft/mcsm/*/screenshots`) klasörleri.
    pub fn screenshot_dirs(&self) -> Vec<PathBuf> {
        let Some(mc) = self.minecraft_dir() else {
            return Vec::new();
        };
        let mut dirs = vec![mc.join("screenshots")];
        if let Ok(entries) = std::fs::read_dir(mc.join(crate::client::PROFILES_DIR)) {
            dirs.extend(
                entries
                    .flatten()
                    .map(|e| e.path().join("screenshots"))
                    .filter(|p| p.is_dir()),
            );
        }
        dirs
    }

    /// Ekran görüntüsünün bulunduğu klasördeki tam yolu (adlar zaman damgalı, pratikte benzersiz).
    pub fn find_shot(&self, file: &str) -> Option<PathBuf> {
        self.screenshot_dirs()
            .into_iter()
            .map(|d| d.join(file))
            .find(|p| p.is_file())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_persistence() {
        let dir = std::env::temp_dir().join(format!("mcsm-settings-{}", uuid::Uuid::new_v4()));
        let store = SettingsStore::load(&dir);
        assert!(store.get().use_screenshots);
        assert!(store.get().minecraft_dir.is_none());

        assert!(
            store
                .set(AppSettings {
                    minecraft_dir: Some(dir.join("yok")),
                    ..AppSettings::default()
                })
                .is_err()
        );
        store
            .set(AppSettings {
                use_screenshots: false,
                ..AppSettings::default()
            })
            .unwrap();
        assert!(!SettingsStore::load(&dir).get().use_screenshots);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn old_files_get_defaults() {
        let s: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(s.use_screenshots);
        assert!(s.language.is_none());
        assert!(s.animations.is_none());
    }
}
