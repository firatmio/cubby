//! Sunucu id → klasör kaydı. Sunucular varsayılan olarak `app_data/instances/<id>` altında,
//! kullanıcı isterse kendi seçtiği bir klasörde (`<seçilen>/<isim>`) durur.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::instance::INSTANCE_FILE;

const REGISTRY_FILE: &str = "instances.json";
const DEFAULT_ROOT: &str = "instances";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    id: String,
    path: PathBuf,
}

pub struct Registry {
    file: PathBuf,
    default_root: PathBuf,
    entries: Mutex<Vec<Entry>>,
}

impl Registry {
    /// Kaydı okur; varsayılan kökte olup kayıtta olmayan sunucuları (ör. M1'den kalanlar) ekler.
    pub fn load(app_data: &Path) -> Self {
        let file = app_data.join(REGISTRY_FILE);
        let default_root = app_data.join(DEFAULT_ROOT);
        let mut entries: Vec<Entry> = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();

        let before = entries.len();
        if let Ok(dirs) = std::fs::read_dir(&default_root) {
            for dir in dirs.flatten() {
                let path = dir.path();
                let id = dir.file_name().to_string_lossy().into_owned();
                if path.join(INSTANCE_FILE).is_file() && !entries.iter().any(|e| e.id == id) {
                    entries.push(Entry { id, path });
                }
            }
        }

        let reg = Self {
            file,
            default_root,
            entries: Mutex::new(entries),
        };
        if reg.lock().len() != before {
            let _ = reg.save();
        }
        reg
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Entry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self) -> AppResult<()> {
        let json = serde_json::to_string_pretty(&*self.lock())?;
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, &self.file)?;
        Ok(())
    }

    pub fn path_of(&self, id: &str) -> Option<PathBuf> {
        self.lock()
            .iter()
            .find(|e| e.id == id)
            .map(|e| e.path.clone())
    }

    pub fn paths(&self) -> Vec<PathBuf> {
        self.lock().iter().map(|e| e.path.clone()).collect()
    }

    pub fn insert(&self, id: &str, path: PathBuf) -> AppResult<()> {
        self.lock().push(Entry {
            id: id.to_string(),
            path,
        });
        self.save()
    }

    pub fn remove(&self, id: &str) -> AppResult<()> {
        self.lock().retain(|e| e.id != id);
        self.save()
    }

    /// Yeni sunucu için henüz var olmayan bir klasör yolu seçer (oluşturmaz).
    pub fn allocate(&self, id: &str, name: &str, parent: Option<&Path>) -> AppResult<PathBuf> {
        let Some(parent) = parent else {
            return Ok(self.default_root.join(id));
        };
        if !parent.is_absolute() || !parent.is_dir() {
            return Err(AppError::msg(tx!(
                "Seçilen konum bulunamadı",
                "The chosen location wasn't found"
            )));
        }
        let base = slug(name);
        (1..1000)
            .map(|n| match n {
                1 => parent.join(&base),
                _ => parent.join(format!("{base}-{n}")),
            })
            .find(|p| !p.exists())
            .ok_or_else(|| {
                AppError::msg(tx!(
                    "Seçilen konumda uygun klasör adı bulunamadı",
                    "Couldn't find a suitable folder name in the chosen location"
                ))
            })
    }
}

/// Klasör adı: Windows'ta geçersiz karakterler `-` olur, Türkçe harfler kalır.
fn slug(name: &str) -> String {
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let mut out = String::new();
    for c in name.trim().chars() {
        let bad =
            c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        let c = if bad || c.is_whitespace() { '-' } else { c };
        if !(c == '-' && out.ends_with('-')) {
            out.push(c);
        }
    }
    let out = out.trim_matches(|c| c == '-' || c == '.').to_string();
    if out.is_empty() {
        "sunucu".into()
    } else if RESERVED.contains(&out.to_ascii_uppercase().as_str()) {
        format!("{out}-sunucu")
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mcsm-reg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn slugs_names() {
        assert_eq!(slug("Fabric 26.3 survival"), "Fabric-26.3-survival");
        assert_eq!(slug("  Kardeş: <test>?  "), "Kardeş-test");
        assert_eq!(slug("..."), "sunucu");
        assert_eq!(slug("con"), "con-sunucu");
    }

    #[test]
    fn migrates_default_root_and_persists() {
        let app = temp();
        let old = app.join(DEFAULT_ROOT).join("abc-1");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join(INSTANCE_FILE), "{}").unwrap();
        std::fs::create_dir_all(app.join(DEFAULT_ROOT).join("yarim")).unwrap(); // instance.json yok

        let reg = Registry::load(&app);
        assert_eq!(reg.path_of("abc-1"), Some(old.clone()));
        assert!(reg.path_of("yarim").is_none());

        reg.insert("custom", app.join("x")).unwrap();
        let again = Registry::load(&app);
        assert_eq!(again.paths().len(), 2);
        again.remove("custom").unwrap();
        assert!(Registry::load(&app).path_of("custom").is_none());
        let _ = std::fs::remove_dir_all(app);
    }

    #[test]
    fn allocates_unique_dirs() {
        let app = temp();
        let reg = Registry::load(&app);
        assert_eq!(
            reg.allocate("id1", "x", None).unwrap(),
            app.join(DEFAULT_ROOT).join("id1")
        );

        let parent = app.join("secilen");
        std::fs::create_dir_all(parent.join("Benim-Sunucum")).unwrap();
        assert_eq!(
            reg.allocate("id2", "Benim Sunucum", Some(&parent)).unwrap(),
            parent.join("Benim-Sunucum-2")
        );
        assert!(
            reg.allocate("id3", "x", Some(Path::new("goreli/yol")))
                .is_err()
        );
        let _ = std::fs::remove_dir_all(app);
    }
}
