//! Davetle gelen oyuncuların kimlik koruması (dünya başına `meta/identities.json`).
//!
//! Premium olmayan sunucuda Minecraft adları doğrulanmaz: kodu olan biri başka birinin (yöneticinin)
//! adıyla girebilir. Davetle gelen her bağlantı Cubby'den geçtiği için bağlanan cihaz bilinir:
//! bir ad, onunla ilk giren cihaza bağlanır, başka cihaz o adla giremez. Yasaklanan cihaz adını
//! değiştirse de giremez. Dünyanın sahibi kendi bilgisayarından (`localhost`) girer; onun adı
//! davetle hiç kullanılamaz.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

const FILE: &str = "identities.json";

/// Aynı anda iki girişin kaydı birbirinin üstüne yazmasın.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bound {
    pub device: String,
    /// Görünen ad (ilk girişteki yazımıyla).
    pub name: String,
    pub first_seen: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BannedDevice {
    pub device: String,
    pub name: String,
    pub at: u64,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identities {
    /// Küçük harfli ad → bağlı cihaz.
    #[serde(default)]
    pub names: BTreeMap<String, Bound>,
    #[serde(default)]
    pub banned: Vec<BannedDevice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Check {
    Pass,
    /// Ad başka bir cihaza (ya da dünyanın sahibine) ait.
    NameTaken,
    Banned,
}

impl Identities {
    /// Girişe izin verilir mi; premium olmayan dünyada bağsız ad bu cihaza bağlanır.
    pub fn check(
        &mut self,
        name: &str,
        device: &str,
        offline: bool,
        host_name: Option<&str>,
        now: u64,
    ) -> Check {
        if self.banned.iter().any(|b| b.device == device) {
            return Check::Banned;
        }
        if !offline {
            return Check::Pass;
        }
        if host_name.is_some_and(|h| h.eq_ignore_ascii_case(name)) {
            return Check::NameTaken;
        }
        let key = name.to_lowercase();
        match self.names.get(&key) {
            Some(b) if b.device != device => Check::NameTaken,
            Some(_) => Check::Pass,
            None => {
                self.names.insert(
                    key,
                    Bound {
                        device: device.to_string(),
                        name: name.to_string(),
                        first_seen: now,
                    },
                );
                Check::Pass
            }
        }
    }

    /// Adın bağlı olduğu cihazı yasaklar; ad hiç davetle girmediyse `false`.
    pub fn ban(&mut self, name: &str, now: u64) -> bool {
        let Some(b) = self.names.get(&name.to_lowercase()).cloned() else {
            return false;
        };
        if !self.banned.iter().any(|x| x.device == b.device) {
            self.banned.push(BannedDevice {
                device: b.device,
                name: b.name,
                at: now,
            });
        }
        true
    }

    /// Bu adla yasaklanmış cihazın yasağını kaldırır.
    pub fn unban(&mut self, name: &str) -> bool {
        let before = self.banned.len();
        let device = self
            .names
            .get(&name.to_lowercase())
            .map(|b| b.device.clone());
        self.banned
            .retain(|b| !b.name.eq_ignore_ascii_case(name) && Some(&b.device) != device.as_ref());
        self.banned.len() != before
    }

    /// Adın cihaz bağını kaldırır (arkadaş yeni bilgisayara geçti).
    pub fn unbind(&mut self, name: &str) -> bool {
        self.names.remove(&name.to_lowercase()).is_some()
    }

    pub fn is_device_banned(&self, name: &str) -> bool {
        let device = self.names.get(&name.to_lowercase()).map(|b| &b.device);
        self.banned
            .iter()
            .any(|b| b.name.eq_ignore_ascii_case(name) || Some(&b.device) == device)
    }
}

pub fn load(meta: &Path) -> Identities {
    std::fs::read_to_string(meta.join(FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Kilitli oku-değiştir-yaz; değişmediyse dosyaya dokunulmaz.
pub fn update<T>(meta: &Path, f: impl FnOnce(&mut Identities) -> T) -> AppResult<T> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut ids = load(meta);
    let before = ids.clone();
    let out = f(&mut ids);
    if ids != before {
        std::fs::create_dir_all(meta)?;
        let path = meta.join(FILE);
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(&ids)?)?;
        std::fs::rename(tmp, path)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binds_names_to_the_first_device() {
        let mut ids = Identities::default();
        assert_eq!(
            ids.check("Ali", "cihaz-a", true, Some("firatmio"), 1),
            Check::Pass
        );
        assert_eq!(
            ids.check("ali", "cihaz-a", true, Some("firatmio"), 2),
            Check::Pass
        );
        assert_eq!(
            ids.check("ALI", "cihaz-b", true, Some("firatmio"), 3),
            Check::NameTaken
        );
        assert_eq!(ids.names["ali"].name, "Ali");
        assert_eq!(ids.names["ali"].first_seen, 1);
        // Dünyanın sahibinin adı davetle kullanılamaz.
        assert_eq!(
            ids.check("FiratMio", "cihaz-b", true, Some("firatmio"), 4),
            Check::NameTaken
        );
        // Aynı cihaz birden çok adla girebilir.
        assert_eq!(ids.check("Zeynep", "cihaz-a", true, None, 5), Check::Pass);
    }

    #[test]
    fn premium_worlds_only_check_bans() {
        let mut ids = Identities::default();
        assert_eq!(
            ids.check("Ali", "cihaz-a", false, Some("Ali"), 1),
            Check::Pass
        );
        assert!(ids.names.is_empty(), "premium dünyada ad bağlanmaz");
    }

    #[test]
    fn bans_follow_the_device() {
        let mut ids = Identities::default();
        ids.check("Ali", "cihaz-a", true, None, 1);
        assert!(!ids.ban("Kimse", 2));
        assert!(ids.ban("ali", 2));
        assert!(ids.is_device_banned("Ali"));
        // Adını değiştirse de giremez; premium dünyada da.
        assert_eq!(ids.check("Ali2", "cihaz-a", true, None, 3), Check::Banned);
        assert_eq!(ids.check("Ali2", "cihaz-a", false, None, 3), Check::Banned);
        assert_eq!(ids.check("Veli", "cihaz-b", true, None, 3), Check::Pass);
        assert!(ids.unban("Ali"));
        assert_eq!(ids.check("Ali", "cihaz-a", true, None, 4), Check::Pass);
        // Bağ kaldırılınca ad yeni cihaza bağlanabilir.
        assert!(ids.unbind("ALI"));
        assert_eq!(ids.check("Ali", "cihaz-c", true, None, 5), Check::Pass);
        assert_eq!(ids.names["ali"].device, "cihaz-c");
    }

    #[test]
    fn update_writes_only_on_change() {
        let dir = std::env::temp_dir().join(format!("cubby-ids-{}", uuid::Uuid::new_v4()));
        assert_eq!(
            update(&dir, |ids| ids.check("Ali", "a", true, None, 1)).unwrap(),
            Check::Pass
        );
        let written = std::fs::metadata(dir.join(FILE))
            .unwrap()
            .modified()
            .unwrap();
        update(&dir, |ids| ids.check("Ali", "a", true, None, 2)).unwrap();
        assert_eq!(
            std::fs::metadata(dir.join(FILE))
                .unwrap()
                .modified()
                .unwrap(),
            written
        );
        assert_eq!(load(&dir).names["ali"].device, "a");
    }
}
