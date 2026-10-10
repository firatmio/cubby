//! Oyuncu dosyaları: beyaz liste (`whitelist.json`), yetkililer (`ops.json`), daha önce girenler
//! (`usercache.json`) ve oyuncu UUID'leri (premium: Mojang, premium olmayan: offline UUID).

use std::path::Path;

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const WHITELIST: &str = "whitelist.json";
pub const OPS: &str = "ops.json";
const USERCACHE: &str = "usercache.json";

/// Mojang profil araması (yeni uç nokta önce, eskisi yedek).
const PROFILE_URLS: [&str; 2] = [
    "https://api.minecraftservices.com/minecraft/profile/lookup/name/",
    "https://api.mojang.com/users/profiles/minecraft/",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    pub uuid: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpEntry {
    pub uuid: String,
    pub name: String,
    pub level: u8,
    pub bypasses_player_limit: bool,
}

/// Minecraft kullanıcı adı: 3–16 harf, rakam veya `_`.
pub fn is_valid_name(name: &str) -> bool {
    (3..=16).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if !is_valid_name(name) {
        return Err(AppError::msg(
            "Oyuncu adı 3–16 karakter olmalı; yalnız harf, rakam ve alt çizgi",
        ));
    }
    Ok(name.to_string())
}

fn hyphenate(hex: &str) -> String {
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Premium olmayan (offline mode) sunucuların kullandığı UUID:
/// Java'daki `UUID.nameUUIDFromBytes("OfflinePlayer:" + isim)` (MD5, sürüm 3).
pub fn offline_uuid(name: &str) -> String {
    let mut bytes: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    hyphenate(&hex::encode(bytes))
}

#[derive(Deserialize)]
struct MojangProfile {
    id: String,
    name: String,
}

/// Premium hesap araması; hesap yoksa açıklayıcı hata.
pub async fn lookup_premium(http: &reqwest::Client, name: &str) -> AppResult<Profile> {
    let mut last_err = None;
    for base in PROFILE_URLS {
        match http.get(format!("{base}{name}")).send().await {
            Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => {
                return Err(AppError::msg(format!(
                    "\"{name}\" adında bir Minecraft hesabı yok. Arkadaşın TLauncher kullanıyorsa \"Premium olmayanlar da girebilsin\"i aç."
                )));
            }
            Ok(resp) => match resp.error_for_status() {
                Ok(resp) => {
                    let p: MojangProfile = resp.json().await?;
                    if p.id.len() == 32 {
                        return Ok(Profile {
                            uuid: hyphenate(&p.id),
                            name: p.name,
                        });
                    }
                }
                Err(e) => last_err = Some(e),
            },
            Err(e) => last_err = Some(e),
        }
    }
    Err(match last_err {
        Some(e) => AppError::msg(format!("Mojang'a ulaşılamadı: {e}")),
        None => AppError::msg("Mojang'dan geçersiz yanıt"),
    })
}

/// Sunucunun moduna uygun profil: offline ise hesaplanır, değilse Mojang'dan.
pub async fn resolve(http: &reqwest::Client, name: &str, offline: bool) -> AppResult<Profile> {
    let name = validate_name(name)?;
    if offline {
        Ok(Profile {
            uuid: offline_uuid(&name),
            name,
        })
    } else {
        lookup_premium(http, &name).await
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Vec<T> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &Path, items: &[T]) -> AppResult<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(items)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

pub fn read_whitelist(server_dir: &Path) -> Vec<Profile> {
    read_json(&server_dir.join(WHITELIST))
}

pub fn write_whitelist(server_dir: &Path, list: &[Profile]) -> AppResult<()> {
    std::fs::create_dir_all(server_dir)?;
    write_json(&server_dir.join(WHITELIST), list)
}

pub fn read_ops(server_dir: &Path) -> Vec<OpEntry> {
    read_json(&server_dir.join(OPS))
}

pub fn write_ops(server_dir: &Path, list: &[OpEntry]) -> AppResult<()> {
    std::fs::create_dir_all(server_dir)?;
    write_json(&server_dir.join(OPS), list)
}

#[derive(Deserialize)]
struct CacheEntry {
    name: String,
}

/// Bu sunucuya daha önce girmiş oyuncuların adları.
pub fn known_names(server_dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = read_json::<CacheEntry>(&server_dir.join(USERCACHE))
        .into_iter()
        .map(|e| e.name)
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
}

/// Listeye ekler (aynı isim büyük/küçük harf duyarsız tekrar edilmez).
pub fn upsert(list: &mut Vec<Profile>, p: Profile) {
    list.retain(|x| !x.name.eq_ignore_ascii_case(&p.name));
    list.push(p);
}

/// Mod değişince (premium ↔ değil) UUID'ler artık eşleşmez: isimden yeniden çözülür.
/// Premium'a geçerken bulunamayan isimler listeden düşer ve döndürülür.
pub async fn rekey(
    http: &reqwest::Client,
    server_dir: &Path,
    offline: bool,
) -> AppResult<Vec<String>> {
    let mut dropped = Vec::new();
    let mut whitelist = Vec::new();
    for p in read_whitelist(server_dir) {
        match resolve(http, &p.name, offline).await {
            Ok(np) => whitelist.push(np),
            Err(_) => dropped.push(p.name),
        }
    }
    let mut ops = Vec::new();
    for o in read_ops(server_dir) {
        if let Ok(np) = resolve(http, &o.name, offline).await {
            ops.push(OpEntry {
                uuid: np.uuid,
                name: np.name,
                ..o
            });
        }
    }
    write_whitelist(server_dir, &whitelist)?;
    write_ops(server_dir, &ops)?;
    Ok(dropped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_offline_uuids() {
        // Bilinen değerler (Minecraft'ın offline UUID'i).
        assert_eq!(
            offline_uuid("Notch"),
            "b50ad385-829d-3141-a216-7e7d7539ba7f"
        );
        assert_eq!(&offline_uuid("firatmio")[14..15], "3");
    }

    #[test]
    fn validates_names() {
        assert!(is_valid_name("firatmio"));
        assert!(is_valid_name("Ali_2"));
        assert!(!is_valid_name("ab"));
        assert!(!is_valid_name("çok-uzun"));
        assert!(!is_valid_name("a b c"));
        assert!(validate_name("  Ali_2 ").is_ok());
    }

    #[test]
    fn whitelist_and_ops_files() {
        let dir = std::env::temp_dir().join(format!("mcsm-players-{}", uuid::Uuid::new_v4()));
        assert!(read_whitelist(&dir).is_empty());
        let mut list = vec![];
        upsert(
            &mut list,
            Profile {
                uuid: offline_uuid("Ali"),
                name: "Ali".into(),
            },
        );
        upsert(
            &mut list,
            Profile {
                uuid: offline_uuid("ali"),
                name: "ali".into(),
            },
        );
        assert_eq!(list.len(), 1);
        write_whitelist(&dir, &list).unwrap();
        assert_eq!(read_whitelist(&dir), list);

        let text = std::fs::read_to_string(dir.join(WHITELIST)).unwrap();
        assert!(text.contains("\"uuid\"") && text.contains("\"name\""));

        let ops = vec![OpEntry {
            uuid: "u".into(),
            name: "Ali".into(),
            level: 4,
            bypasses_player_limit: false,
        }];
        write_ops(&dir, &ops).unwrap();
        let text = std::fs::read_to_string(dir.join(OPS)).unwrap();
        assert!(text.contains("bypassesPlayerLimit"));
        assert_eq!(read_ops(&dir), ops);

        std::fs::write(
            dir.join(USERCACHE),
            r#"[{"uuid":"b23e1637-8c3e-4f20-bd2f-4c16af66d432","name":"firatmio","expiresOn":"2026-11-10 16:10:39 +0300"}]"#,
        )
        .unwrap();
        assert_eq!(known_names(&dir), ["firatmio"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn rekey_to_offline_needs_no_network() {
        let dir = std::env::temp_dir().join(format!("mcsm-rekey-{}", uuid::Uuid::new_v4()));
        write_whitelist(
            &dir,
            &[Profile {
                uuid: "premium-uuid".into(),
                name: "Ali".into(),
            }],
        )
        .unwrap();
        let dropped = rekey(&reqwest::Client::new(), &dir, true).await.unwrap();
        assert!(dropped.is_empty());
        assert_eq!(read_whitelist(&dir)[0].uuid, offline_uuid("Ali"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    #[ignore = "ağ erişimi gerekir"]
    async fn live_lookup_premium() {
        let http = reqwest::Client::new();
        let p = lookup_premium(&http, "firatmio").await.unwrap();
        assert_eq!(p.uuid, "b23e1637-8c3e-4f20-bd2f-4c16af66d432");
        assert!(lookup_premium(&http, "bu_isim_yok_xq9z").await.is_err());
    }
}
