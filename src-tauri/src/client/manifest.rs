//! Host tarafı: sunucudaki modlardan oyuncuya gidecek olanların listesi.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::{FabricEnv, fabric_env};
use crate::hash::{HashAlgo, hash_bytes};
use crate::modrinth::ClientNeed;
use crate::mods::{self, ModRecord};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Need {
    /// Olmadan sunucuya girilemez.
    Required,
    /// Olmadan da girilir; bazı özellikler (ekranlar, tuşlar) görünmez.
    Recommended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientMod {
    pub file: String,
    pub title: String,
    pub sha1: String,
    pub sha512: String,
    pub size: u64,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub need: Need,
}

/// Modrinth bilgisi (kayıtta) ve jar'ın kendi `fabric.mod.json`'ı birlikte değerlendirilir.
pub fn need_for(record: Option<ClientNeed>, env: FabricEnv) -> Option<Need> {
    match (record, env) {
        (_, FabricEnv::Server) | (Some(ClientNeed::None), _) => None,
        (Some(ClientNeed::Required), _) => Some(Need::Required),
        _ => Some(Need::Recommended),
    }
}

/// Sunucunun `mods` klasöründen oyuncuya gidecek modlar (dosya adına göre sıralı).
pub fn build(server_mods: &Path, records: &[ModRecord]) -> Vec<ClientMod> {
    build_with(server_mods, records, true)
}

/// `full: false` → sha512 hesaplanmaz (yalnız `rev` ve dosya adı kontrolü için, ucuz).
pub fn build_with(server_mods: &Path, records: &[ModRecord], full: bool) -> Vec<ClientMod> {
    mods::scan(server_mods)
        .into_iter()
        .filter_map(|(file, sha1)| {
            let path = server_mods.join(&file);
            let rec = records.iter().find(|r| r.sha1 == sha1);
            let need = need_for(rec.and_then(|r| r.need), fabric_env(&path))?;
            let (sha512, size) = if full {
                let bytes = std::fs::read(&path).ok()?;
                (hash_bytes(HashAlgo::Sha512, &bytes), bytes.len() as u64)
            } else {
                (String::new(), std::fs::metadata(&path).ok()?.len())
            };
            Some(ClientMod {
                title: rec
                    .and_then(|r| r.title.clone())
                    .unwrap_or_else(|| file.trim_end_matches(".jar").to_string()),
                sha512,
                size,
                project_id: rec.map(|r| r.project_id.clone()),
                version_id: rec.map(|r| r.version_id.clone()),
                need,
                file,
                sha1,
            })
        })
        .collect()
}

/// Mod listesinin kısa özeti; değişince katılımcı "güncelle" görür.
pub fn rev(list: &[ClientMod]) -> String {
    let joined: String = list
        .iter()
        .map(|m| format!("{}:{};", m.file, m.sha1))
        .collect();
    hash_bytes(HashAlgo::Sha1, joined.as_bytes())[..16].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn need_rules() {
        assert_eq!(
            need_for(Some(ClientNeed::Required), FabricEnv::Both),
            Some(Need::Required)
        );
        assert_eq!(
            need_for(Some(ClientNeed::Recommended), FabricEnv::Both),
            Some(Need::Recommended)
        );
        assert_eq!(need_for(Some(ClientNeed::None), FabricEnv::Both), None);
        assert_eq!(need_for(None, FabricEnv::Server), None);
        assert_eq!(need_for(None, FabricEnv::Both), Some(Need::Recommended));
        assert_eq!(
            need_for(Some(ClientNeed::Required), FabricEnv::Server),
            None
        );
    }

    #[test]
    fn build_skips_server_only_jars() {
        let d = std::env::temp_dir().join(format!("mcsm-manifest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        let make = |name: &str, env: &str| {
            let mut zw = zip::ZipWriter::new(std::fs::File::create(d.join(name)).unwrap());
            zw.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut zw, format!(r#"{{"environment":"{env}"}}"#).as_bytes())
                .unwrap();
            zw.finish().unwrap();
        };
        make("server-only.jar", "server");
        make("both.jar", "*");
        let list = build(&d, &[]);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].file, "both.jar");
        assert_eq!(list[0].need, Need::Recommended);
        assert_eq!(rev(&list).len(), 16);
        assert_ne!(rev(&list), rev(&[]));
    }
}
