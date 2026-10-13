//! Forge: sürümler maven-metadata.xml'den, önerilenler promotions_slim.json'dan; kurulum resmi
//! installer'la. Yalnız Minecraft 1.17 ve sonrası (`@win_args.txt` ile başlatılanlar).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde::Deserialize;
use tokio::sync::Mutex;

use super::installer::{args_file_name, install_forge_like};
use super::mojang::MojangApi;
use super::{
    GameVersionList, InstallRequest, InstallStage, Installed, Loader, LoaderVersion,
    LoaderVersionList, cmp_versions, intersect_manifest,
};
use crate::consts::MANIFEST_TTL;
use crate::error::{AppError, AppResult};

const MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

#[derive(Debug, Deserialize)]
struct Promotions {
    promos: HashMap<String, String>,
}

/// MC sürümü → Forge sürümleri (yeniden eskiye) ve önerilenler.
#[derive(Debug, Default)]
struct Index {
    by_mc: HashMap<String, Vec<String>>,
    promos: HashMap<String, String>,
}

/// `maven-metadata.xml`'deki `<version>` değerleri.
fn parse_metadata(xml: &str) -> Vec<String> {
    xml.split("<version>")
        .skip(1)
        .filter_map(|p| {
            p.split_once("</version>")
                .map(|(v, _)| v.trim().to_string())
        })
        .collect()
}

/// `1.17` ve sonrası ya da yeni (yıl tabanlı, 26+) sürüm adları.
pub(crate) fn mc_supported(mc: &str) -> bool {
    let mut it = mc.split('.').map(|p| p.parse::<u32>().ok());
    match (it.next().flatten(), it.next().flatten()) {
        (Some(1), Some(minor)) => minor >= 17,
        (Some(major), _) => major >= 26,
        _ => false,
    }
}

/// `1.20.1-47.4.26` → (`1.20.1`, `47.4.26`). Eski biçimler (`1.7.10-10.13.4.1614-1.7.10`) elenir.
fn split_version(full: &str) -> Option<(&str, &str)> {
    let (mc, forge) = full.split_once('-')?;
    (mc_supported(mc) && !forge.contains('-') && crate::util::is_safe_name(forge))
        .then_some((mc, forge))
}

fn build_index(versions: &[String], promos: HashMap<String, String>) -> Index {
    let mut by_mc: HashMap<String, Vec<String>> = HashMap::new();
    for full in versions {
        if let Some((mc, forge)) = split_version(full) {
            by_mc
                .entry(mc.to_string())
                .or_default()
                .push(forge.to_string());
        }
    }
    for list in by_mc.values_mut() {
        list.sort_by(|a, b| cmp_versions(b, a));
    }
    Index { by_mc, promos }
}

fn full_version(mc: &str, forge: &str) -> String {
    format!("{mc}-{forge}")
}

pub fn installer_url(mc: &str, forge: &str) -> String {
    let full = full_version(mc, forge);
    format!("{MAVEN}/{full}/forge-{full}-installer.jar")
}

fn args_file(mc: &str, forge: &str) -> String {
    format!(
        "libraries/net/minecraftforge/forge/{}/{}",
        full_version(mc, forge),
        args_file_name()
    )
}

pub struct ForgeLoader {
    http: reqwest::Client,
    mojang: Arc<MojangApi>,
    cache: Mutex<Option<(Instant, Arc<Index>)>>,
}

impl ForgeLoader {
    pub fn new(http: reqwest::Client, mojang: Arc<MojangApi>) -> Self {
        Self {
            http,
            mojang,
            cache: Mutex::new(None),
        }
    }

    /// Liste ~5000 sürüm; kısa süre önbellekte tutulur.
    async fn index(&self) -> AppResult<Arc<Index>> {
        let mut cache = self.cache.lock().await;
        if let Some((at, idx)) = cache.as_ref()
            && at.elapsed() < MANIFEST_TTL
        {
            return Ok(idx.clone());
        }
        let xml = self
            .http
            .get(format!("{MAVEN}/maven-metadata.xml"))
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;
        // Önerilen bilgisi olmadan da liste kullanılabilir.
        let promos = match self.http.get(PROMOTIONS).send().await {
            Ok(r) => r
                .json::<Promotions>()
                .await
                .map(|p| p.promos)
                .unwrap_or_default(),
            Err(_) => HashMap::new(),
        };
        let idx = Arc::new(build_index(&parse_metadata(&xml), promos));
        *cache = Some((Instant::now(), idx.clone()));
        Ok(idx)
    }
}

impl Loader for ForgeLoader {
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let idx = self.index().await?;
        let supported: HashSet<String> = idx.by_mc.keys().cloned().collect();
        let manifest = self.mojang.manifest().await?;
        Ok(intersect_manifest(&manifest, &supported, include_snapshots))
    }

    async fn list_loader_versions(&self, game: &str) -> AppResult<LoaderVersionList> {
        let idx = self.index().await?;
        let list = idx.by_mc.get(game).cloned().unwrap_or_default();
        let recommended = idx
            .promos
            .get(&format!("{game}-recommended"))
            .or_else(|| idx.promos.get(&format!("{game}-latest")))
            .filter(|v| list.contains(v))
            .cloned()
            .or_else(|| list.first().cloned());
        Ok(LoaderVersionList {
            versions: list
                .into_iter()
                .map(|version| LoaderVersion {
                    version,
                    stable: true,
                    channel: None,
                })
                .collect(),
            recommended,
        })
    }

    async fn install(
        &self,
        req: &InstallRequest<'_>,
        server_dir: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<Installed> {
        on_stage(InstallStage::Meta);
        let forge = match req.loader_version {
            Some(v) => v.to_string(),
            None => self
                .list_loader_versions(req.mc_version)
                .await?
                .recommended
                .ok_or_else(|| {
                    AppError::msg(tx!(
                        "{} için Forge sürümü yok",
                        "No Forge version for {}",
                        req.mc_version
                    ))
                })?,
        };
        if !crate::util::is_safe_name(&forge) || !mc_supported(req.mc_version) {
            return Err(AppError::msg(tx!(
                "Geçersiz Forge sürümü.",
                "Invalid Forge version."
            )));
        }
        let java_major = install_forge_like(
            &self.http,
            &self.mojang,
            req,
            &installer_url(req.mc_version, &forge),
            server_dir,
            &args_file(req.mc_version, &forge),
            on_stage,
        )
        .await?;
        Ok(Installed {
            java_major,
            loader_version: Some(forge),
        })
    }

    fn launch_args(&self, mc: &str, loader: Option<&str>) -> Vec<String> {
        vec![
            format!("@{}", args_file(mc, loader.unwrap_or_default())),
            "nogui".into(),
        ]
    }

    fn content_dir(&self) -> Option<&'static str> {
        Some("mods")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_metadata_and_filters_old() {
        let xml = r#"<metadata><versioning><versions>
            <version>1.7.10-10.13.4.1614-1.7.10</version>
            <version>1.16.5-36.2.42</version>
            <version>1.17.1-37.1.1</version>
            <version>1.20.1-47.4.25</version>
            <version>1.20.1-47.4.26</version>
            <version>26.3-66.0.9</version>
            <version>26.3-66.0.10</version>
        </versions></versioning></metadata>"#;
        let versions = parse_metadata(xml);
        assert_eq!(versions.len(), 7);
        let promos = HashMap::from([
            ("1.20.1-recommended".to_string(), "47.4.25".to_string()),
            ("26.3-latest".to_string(), "66.0.10".to_string()),
        ]);
        let idx = build_index(&versions, promos);
        assert!(!idx.by_mc.contains_key("1.16.5"));
        assert!(!idx.by_mc.contains_key("1.7.10"));
        assert_eq!(idx.by_mc["1.17.1"], vec!["37.1.1"]);
        assert_eq!(idx.by_mc["26.3"], vec!["66.0.10", "66.0.9"]);
        assert_eq!(idx.by_mc["1.20.1"], vec!["47.4.26", "47.4.25"]);
    }

    #[test]
    fn supports_only_modern_versions() {
        assert!(mc_supported("1.17"));
        assert!(mc_supported("1.21.11"));
        assert!(mc_supported("26.3"));
        assert!(!mc_supported("1.16.5"));
        assert!(!mc_supported("b1.7"));
    }

    #[test]
    fn builds_paths() {
        assert_eq!(
            installer_url("26.3", "66.0.10"),
            "https://maven.minecraftforge.net/net/minecraftforge/forge/26.3-66.0.10/forge-26.3-66.0.10-installer.jar"
        );
        assert!(
            args_file("26.3", "66.0.10")
                .starts_with("libraries/net/minecraftforge/forge/26.3-66.0.10/")
        );
    }

    #[tokio::test]
    #[ignore = "ağ erişimi ve Java gerekir"]
    async fn live_install_forge() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let mojang = Arc::new(MojangApi::new(http.clone()));
        let loader = ForgeLoader::new(http, mojang.clone());
        let list = loader.list_game_versions(false).await.unwrap();
        let mc = list.latest_release.clone();
        let lv = loader.list_loader_versions(&mc).await.unwrap();
        println!(
            "forge {mc}: önerilen {:?}, {} sürüm",
            lv.recommended,
            lv.versions.len()
        );
        let java = crate::java::test_java(mojang.java_major(&mc).await.unwrap()).await;
        let dir = crate::util::live_test_dir("forge");
        let _ = std::fs::remove_dir_all(&dir);
        let installed = loader
            .install(
                &InstallRequest {
                    mc_version: &mc,
                    loader_version: None,
                    java: Some(&java),
                },
                &dir,
                &mut |_| {},
            )
            .await
            .unwrap();
        let forge = installed.loader_version.unwrap();
        assert!(dir.join(args_file(&mc, &forge)).is_file());
        println!("forge {mc}-{forge} -> {}", dir.display());
    }
}
