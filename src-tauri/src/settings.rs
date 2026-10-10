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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minecraft_dir: None,
            use_screenshots: true,
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
        Self {
            file,
            inner: Mutex::new(inner),
        }
    }

    pub fn get(&self) -> AppSettings {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set(&self, new: AppSettings) -> AppResult<()> {
        if let Some(dir) = &new.minecraft_dir
            && !dir.is_dir()
        {
            return Err(AppError::msg("Seçilen Minecraft klasörü bulunamadı"));
        }
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&new)?)?;
        std::fs::rename(tmp, &self.file)?;
        *self.inner.lock().unwrap_or_else(|e| e.into_inner()) = new;
        Ok(())
    }

    /// Geçerli Minecraft klasörü (ayar ya da varsayılan).
    pub fn minecraft_dir(&self) -> Option<PathBuf> {
        self.get().minecraft_dir.or_else(default_minecraft_dir)
    }

    pub fn screenshots_dir(&self) -> Option<PathBuf> {
        self.minecraft_dir().map(|d| d.join("screenshots"))
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
                    use_screenshots: true
                })
                .is_err()
        );
        store
            .set(AppSettings {
                minecraft_dir: None,
                use_screenshots: false,
            })
            .unwrap();
        assert!(!SettingsStore::load(&dir).get().use_screenshots);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn old_files_get_defaults() {
        let s: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(s.use_screenshots);
    }
}
