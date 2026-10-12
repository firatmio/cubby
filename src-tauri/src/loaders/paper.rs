//! Paper: PaperMC Fill API v3 (eski api.papermc.io/v2 kapatıldı, 410 döner).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use super::mojang::{MojangApi, is_listed};
use super::{
    GameVersion, GameVersionList, InstallRequest, InstallStage, Installed, Loader, LoaderVersion,
    LoaderVersionList, encode_segment,
};
use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::HashAlgo;

const FILL: &str = "https://fill.papermc.io/v3/projects/paper";

pub const PAPER_JAR: &str = "paper.jar";

const DOWNLOAD_KEY: &str = "server:default";

#[derive(Debug, Deserialize)]
struct VersionsResponse {
    versions: Vec<VersionEntry>,
}

#[derive(Debug, Deserialize)]
struct VersionEntry {
    version: VersionInfo,
    #[serde(default)]
    builds: Vec<u64>,
}

#[derive(Debug, Deserialize)]
struct VersionInfo {
    id: String,
    java: Option<JavaInfo>,
}

#[derive(Debug, Deserialize)]
struct JavaInfo {
    version: JavaVersion,
}

#[derive(Debug, Deserialize)]
struct JavaVersion {
    minimum: u32,
}

#[derive(Debug, Deserialize)]
struct Build {
    id: u64,
    channel: String,
    downloads: HashMap<String, BuildDownload>,
}

#[derive(Debug, Deserialize)]
struct BuildDownload {
    checksums: Checksums,
    url: String,
}

#[derive(Debug, Deserialize)]
struct Checksums {
    sha256: String,
}

pub struct PaperLoader {
    http: reqwest::Client,
    mojang: Arc<MojangApi>,
}

impl PaperLoader {
    pub fn new(http: reqwest::Client, mojang: Arc<MojangApi>) -> Self {
        Self { http, mojang }
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        Ok(self
            .http
            .get(format!("{FILL}{path}"))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    /// Yeniden eskiye sıralı build listesi.
    async fn builds(&self, game: &str) -> AppResult<Vec<Build>> {
        let mut builds: Vec<Build> = self
            .get(&format!("/versions/{}/builds", encode_segment(game)))
            .await?;
        builds.sort_by_key(|b| std::cmp::Reverse(b.id));
        Ok(builds)
    }

    async fn java_major(&self, game: &str) -> AppResult<u32> {
        let resp: VersionsResponse = self.get("/versions").await?;
        let from_fill = resp
            .versions
            .iter()
            .find(|v| v.version.id == game)
            .and_then(|v| v.version.java.as_ref())
            .map(|j| j.version.minimum);
        match from_fill {
            Some(j) => Ok(j),
            None => self.mojang.java_major(game).await,
        }
    }
}

/// En yeni STABLE; yoksa en yeni BETA. Sadece ALPHA varsa öneri yok.
fn recommend(builds: &[Build]) -> Option<&Build> {
    builds
        .iter()
        .find(|b| b.channel == "STABLE")
        .or_else(|| builds.iter().find(|b| b.channel == "BETA"))
}

impl Loader for PaperLoader {
    /// Fill'in listesi (build'i olanlar); tür ve tarih Mojang'dan, Mojang'da yoksa snapshot sayılır.
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let resp: VersionsResponse = self.get("/versions").await?;
        let manifest = self.mojang.manifest().await?;
        let versions: Vec<GameVersion> = resp
            .versions
            .into_iter()
            .filter(|v| !v.builds.is_empty())
            .filter_map(|v| {
                let entry = manifest.entry(&v.version.id);
                let kind = entry.map_or("snapshot", |e| e.kind.as_str()).to_string();
                is_listed(&kind, include_snapshots).then(|| GameVersion {
                    release_time: entry.map(|e| e.release_time.clone()).unwrap_or_default(),
                    id: v.version.id,
                    kind,
                })
            })
            .collect();
        Ok(GameVersionList::new(&manifest.latest.release, versions))
    }

    async fn list_loader_versions(&self, game: &str) -> AppResult<LoaderVersionList> {
        let builds = self.builds(game).await?;
        Ok(LoaderVersionList {
            recommended: recommend(&builds).map(|b| b.id.to_string()),
            versions: builds
                .iter()
                .map(|b| LoaderVersion {
                    version: b.id.to_string(),
                    stable: b.channel == "STABLE",
                    channel: Some(b.channel.to_lowercase()),
                })
                .collect(),
        })
    }

    async fn install(
        &self,
        req: &InstallRequest<'_>,
        server_dir: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<Installed> {
        on_stage(InstallStage::Meta);
        let builds = self.builds(req.mc_version).await?;
        let build = match req.loader_version {
            Some(v) => builds.iter().find(|b| b.id.to_string() == v),
            None => recommend(&builds),
        }
        .ok_or_else(|| AppError::msg(format!("{} için uygun Paper build'i yok", req.mc_version)))?;
        let download = build
            .downloads
            .get(DOWNLOAD_KEY)
            .ok_or_else(|| AppError::msg("Paper build'inde sunucu dosyası yok"))?;
        let java_major = self.java_major(req.mc_version).await?;

        download_file(
            &self.http,
            &download.url,
            &server_dir.join(PAPER_JAR),
            Some((HashAlgo::Sha256, &download.checksums.sha256)),
            |downloaded, total| {
                on_stage(InstallStage::Download {
                    file: "paper",
                    downloaded,
                    total,
                })
            },
        )
        .await?;
        tokio::fs::create_dir_all(server_dir.join("plugins")).await?;

        Ok(Installed {
            java_major,
            loader_version: Some(build.id.to_string()),
        })
    }

    fn launch_args(&self, _mc: &str, _loader: Option<&str>) -> Vec<String> {
        vec!["-jar".into(), PAPER_JAR.into(), "--nogui".into()]
    }

    fn content_dir(&self) -> Option<&'static str> {
        Some("plugins")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(id: u64, channel: &str) -> Build {
        Build {
            id,
            channel: channel.into(),
            downloads: HashMap::new(),
        }
    }

    #[test]
    fn parses_fill_responses() {
        let v: VersionsResponse = serde_json::from_str(
            r#"{"versions":[{"version":{"id":"26.3","support":{"status":"SUPPORTED"},"java":{"version":{"minimum":25},"flags":{"recommended":[]}}},"builds":[3,4,169]},
                            {"version":{"id":"1.8.8","support":{"status":"UNSUPPORTED"}},"builds":[]}]}"#,
        )
        .unwrap();
        assert_eq!(
            v.versions[0].version.java.as_ref().unwrap().version.minimum,
            25
        );
        assert!(v.versions[1].version.java.is_none() && v.versions[1].builds.is_empty());

        let b: Vec<Build> = serde_json::from_str(
            r#"[{"id":169,"time":"2026-10-09T18:50:09Z","channel":"BETA","commits":[],
                 "downloads":{"server:default":{"name":"paper-26.3-169.jar","checksums":{"sha256":"185d"},"size":55138949,"url":"https://x/paper.jar"}}}]"#,
        )
        .unwrap();
        let d = &b[0].downloads[DOWNLOAD_KEY];
        assert_eq!(
            (d.checksums.sha256.as_str(), d.url.as_str()),
            ("185d", "https://x/paper.jar")
        );
    }

    #[test]
    fn recommends_stable_then_beta_never_alpha() {
        let mixed = [build(12, "ALPHA"), build(11, "BETA"), build(10, "STABLE")];
        assert_eq!(recommend(&mixed).map(|b| b.id), Some(10));
        let no_stable = [build(12, "ALPHA"), build(11, "BETA")];
        assert_eq!(recommend(&no_stable).map(|b| b.id), Some(11));
        assert!(recommend(&[build(12, "ALPHA")]).is_none());
    }

    #[test]
    fn game_kind_comes_from_mojang() {
        let m = super::super::mojang::tests::sample();
        assert_eq!(m.entry("26.3").map(|e| e.kind.as_str()), Some("release"));
        assert!(m.entry("26.3-rc-3").is_none()); // → snapshot sayılır
    }

    #[tokio::test]
    #[ignore = "ağ erişimi gerekir"]
    async fn live_install_paper() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let loader = PaperLoader::new(http.clone(), Arc::new(MojangApi::new(http)));
        let list = loader.list_game_versions(false).await.unwrap();
        let dir = crate::util::live_test_dir("paper");
        let installed = loader
            .install(
                &InstallRequest {
                    mc_version: &list.latest_release,
                    loader_version: None,
                    java: None,
                },
                &dir,
                &mut |_| {},
            )
            .await
            .unwrap();
        assert!(dir.join(PAPER_JAR).is_file());
        println!(
            "paper {} build {:?} java {} -> {}",
            list.latest_release,
            installed.loader_version,
            installed.java_major,
            dir.display()
        );
    }
}
