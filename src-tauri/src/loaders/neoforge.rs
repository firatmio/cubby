//! NeoForge: sürümler maven.neoforged.net'ten, kurulum resmi installer'la (`--installServer`).
//! Başlatma `@libraries/.../win_args.txt` ile (installer'ın yazdığı `run.bat` ile aynı).

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use super::installer::{args_file_name, install_forge_like};
use super::mojang::MojangApi;
use super::{
    GameVersionList, InstallRequest, InstallStage, Installed, Loader, LoaderVersion,
    LoaderVersionList, cmp_versions, intersect_manifest,
};
use crate::error::{AppError, AppResult};

const VERSIONS: &str =
    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
const MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";

#[derive(Debug, Deserialize)]
struct VersionsResponse {
    versions: Vec<String>,
}

/// NeoForge sürümünün Minecraft sürümü:
/// - `21.1.172` → `1.21.1`, `21.0.5` → `1.21`;
/// - 26'dan itibaren `26.3.0.76` → `26.3`, `26.1.1.4` → `26.1.1`;
/// - ön sürümler `26.1.0.0-alpha.8+snapshot-4` → `26.1-snapshot-4`.
pub fn mc_for(v: &str) -> Option<String> {
    let (base, rest) = match v.split_once('-') {
        Some((b, r)) => (b, Some(r)),
        None => (v, None),
    };
    let parts: Vec<u32> = base
        .split('.')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    let mc = match parts.as_slice() {
        [major, minor, patch, _build] if *major >= 26 => {
            if *patch == 0 {
                format!("{major}.{minor}")
            } else {
                format!("{major}.{minor}.{patch}")
            }
        }
        [major, minor, _build] if (20..26).contains(major) => {
            if *minor == 0 {
                format!("1.{major}")
            } else {
                format!("1.{major}.{minor}")
            }
        }
        _ => return None,
    };
    match rest.and_then(|r| r.split_once('+')) {
        Some((_, suffix)) => Some(format!("{mc}-{suffix}")),
        None => Some(mc),
    }
}

fn is_stable(v: &str) -> bool {
    !v.contains('-')
}

/// İlk kararlı, yoksa en yeni (liste yeniden eskiye sıralı).
fn pick_recommended(list: &[LoaderVersion]) -> Option<String> {
    list.iter()
        .find(|v| v.stable)
        .or(list.first())
        .map(|v| v.version.clone())
}

pub fn installer_url(version: &str) -> String {
    format!("{MAVEN}/{version}/neoforge-{version}-installer.jar")
}

/// Sunucu klasörüne göre `@` argüman dosyası.
fn args_file(version: &str) -> String {
    format!(
        "libraries/net/neoforged/neoforge/{version}/{}",
        args_file_name()
    )
}

pub struct NeoForgeLoader {
    http: reqwest::Client,
    mojang: Arc<MojangApi>,
}

impl NeoForgeLoader {
    pub fn new(http: reqwest::Client, mojang: Arc<MojangApi>) -> Self {
        Self { http, mojang }
    }

    async fn all(&self) -> AppResult<Vec<String>> {
        let resp: VersionsResponse = self
            .http
            .get(VERSIONS)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(resp.versions)
    }
}

impl Loader for NeoForgeLoader {
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let supported: HashSet<String> =
            self.all().await?.iter().filter_map(|v| mc_for(v)).collect();
        let manifest = self.mojang.manifest().await?;
        Ok(intersect_manifest(&manifest, &supported, include_snapshots))
    }

    async fn list_loader_versions(&self, game: &str) -> AppResult<LoaderVersionList> {
        let mut versions: Vec<LoaderVersion> = self
            .all()
            .await?
            .into_iter()
            .filter(|v| mc_for(v).as_deref() == Some(game))
            .map(|v| LoaderVersion {
                stable: is_stable(&v),
                version: v,
                channel: None,
            })
            .collect();
        versions.sort_by(|a, b| cmp_versions(&b.version, &a.version));
        Ok(LoaderVersionList {
            recommended: pick_recommended(&versions),
            versions,
        })
    }

    async fn install(
        &self,
        req: &InstallRequest<'_>,
        server_dir: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<Installed> {
        on_stage(InstallStage::Meta);
        let version = match req.loader_version {
            Some(v) => v.to_string(),
            None => self
                .list_loader_versions(req.mc_version)
                .await?
                .recommended
                .ok_or_else(|| {
                    AppError::msg(tx!(
                        "{} için NeoForge sürümü yok",
                        "No NeoForge version for {}",
                        req.mc_version
                    ))
                })?,
        };
        if !crate::util::is_safe_name(&version) {
            return Err(AppError::msg(tx!(
                "Geçersiz NeoForge sürümü.",
                "Invalid NeoForge version."
            )));
        }
        let java_major = install_forge_like(
            &self.http,
            &self.mojang,
            req,
            &installer_url(&version),
            server_dir,
            &args_file(&version),
            on_stage,
        )
        .await?;
        Ok(Installed {
            java_major,
            loader_version: Some(version),
        })
    }

    fn launch_args(&self, _mc: &str, loader: Option<&str>) -> Vec<String> {
        vec![
            format!("@{}", args_file(loader.unwrap_or_default())),
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
    fn maps_versions_to_minecraft() {
        assert_eq!(mc_for("26.3.0.76").as_deref(), Some("26.3"));
        assert_eq!(mc_for("26.3.0.75-beta").as_deref(), Some("26.3"));
        assert_eq!(mc_for("26.1.1.4").as_deref(), Some("26.1.1"));
        assert_eq!(mc_for("21.1.172").as_deref(), Some("1.21.1"));
        assert_eq!(mc_for("21.0.5-beta").as_deref(), Some("1.21"));
        assert_eq!(mc_for("20.2.93").as_deref(), Some("1.20.2"));
        assert_eq!(
            mc_for("26.1.0.0-alpha.8+snapshot-4").as_deref(),
            Some("26.1-snapshot-4")
        );
        assert_eq!(mc_for("0.25w14craftmine.3-beta"), None);
        assert!(is_stable("26.3.0.76"));
        assert!(!is_stable("26.3.0.75-beta"));
    }

    #[test]
    fn builds_paths() {
        assert_eq!(
            installer_url("26.3.0.76"),
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/26.3.0.76/neoforge-26.3.0.76-installer.jar"
        );
        let args = NeoForgeLoader::new(
            reqwest::Client::new(),
            Arc::new(MojangApi::new(reqwest::Client::new())),
        )
        .launch_args("26.3", Some("26.3.0.76"));
        assert!(args[0].starts_with("@libraries/net/neoforged/neoforge/26.3.0.76/"));
        assert_eq!(args[1], "nogui");
    }

    #[tokio::test]
    #[ignore = "ağ erişimi ve Java gerekir"]
    async fn live_install_neoforge() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let mojang = Arc::new(MojangApi::new(http.clone()));
        let loader = NeoForgeLoader::new(http, mojang.clone());
        let list = loader.list_game_versions(false).await.unwrap();
        let mc = list.latest_release.clone();
        let major = mojang.java_major(&mc).await.unwrap();
        let java = crate::java::test_java(major).await;
        let dir = crate::util::live_test_dir("neoforge");
        let _ = std::fs::remove_dir_all(&dir);
        let installed = loader
            .install(
                &InstallRequest {
                    mc_version: &mc,
                    loader_version: None,
                    java: Some(&java),
                },
                &dir,
                &mut |s| {
                    if let InstallStage::Installer { line } = s {
                        println!("  {line}");
                    }
                },
            )
            .await
            .unwrap();
        let lv = installed.loader_version.unwrap();
        assert!(dir.join(args_file(&lv)).is_file());
        println!("neoforge {mc} {lv} -> {}", dir.display());
    }
}
