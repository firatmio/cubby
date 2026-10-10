use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde::Deserialize;
use tokio::sync::Mutex;

use super::{GameVersion, GameVersionList};
use crate::consts::MANIFEST_TTL;
use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::{HashAlgo, hash_bytes};

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/// Java sürümü belirtmeyen çok eski sürümler Java 8 ile çalışır.
const LEGACY_JAVA_MAJOR: u32 = 8;

pub const SERVER_JAR: &str = "server.jar";

#[derive(Debug, Deserialize)]
struct Manifest {
    latest: Latest,
    versions: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize)]
struct Latest {
    release: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    url: String,
    sha1: String,
    release_time: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionDetail {
    downloads: Downloads,
    java_version: Option<JavaVersion>,
}

#[derive(Debug, Deserialize)]
struct Downloads {
    server: Option<DownloadInfo>,
}

#[derive(Debug, Deserialize)]
struct DownloadInfo {
    sha1: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JavaVersion {
    major_version: u32,
}

pub enum InstallStage {
    Meta,
    Download { downloaded: u64, total: Option<u64> },
}

pub struct VanillaApi {
    http: reqwest::Client,
    cache: Mutex<Option<(Instant, Arc<Manifest>)>>,
}

impl VanillaApi {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            cache: Mutex::new(None),
        }
    }

    async fn manifest(&self) -> AppResult<Arc<Manifest>> {
        let mut cache = self.cache.lock().await;
        if let Some((at, m)) = cache.as_ref()
            && at.elapsed() < MANIFEST_TTL
        {
            return Ok(m.clone());
        }
        let m: Arc<Manifest> = Arc::new(
            self.http
                .get(MANIFEST_URL)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?,
        );
        *cache = Some((Instant::now(), m.clone()));
        Ok(m)
    }

    pub async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let m = self.manifest().await?;
        Ok(GameVersionList {
            latest_release: m.latest.release.clone(),
            versions: filter_versions(&m.versions, include_snapshots),
        })
    }

    /// `server_dir/server.jar`'ı indirip sha1 ile doğrular. Gereken Java major sürümünü döner.
    pub async fn install(
        &self,
        mc_version: &str,
        server_dir: &Path,
        mut on_stage: impl FnMut(InstallStage),
    ) -> AppResult<u32> {
        on_stage(InstallStage::Meta);
        let m = self.manifest().await?;
        let entry = m
            .versions
            .iter()
            .find(|v| v.id == mc_version)
            .ok_or_else(|| AppError::msg(format!("Sürüm bulunamadı: {mc_version}")))?;

        let bytes = self
            .http
            .get(&entry.url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        let actual = hash_bytes(HashAlgo::Sha1, &bytes);
        if !actual.eq_ignore_ascii_case(&entry.sha1) {
            return Err(AppError::HashMismatch {
                file: format!("{mc_version}.json"),
                expected: entry.sha1.clone(),
                actual,
            });
        }
        let detail: VersionDetail = serde_json::from_slice(&bytes)?;
        let server = detail.downloads.server.ok_or_else(|| {
            AppError::msg(format!("{mc_version} sürümünün resmi sunucu dosyası yok"))
        })?;

        download_file(
            &self.http,
            &server.url,
            &server_dir.join(SERVER_JAR),
            Some((HashAlgo::Sha1, &server.sha1)),
            |downloaded, total| on_stage(InstallStage::Download { downloaded, total }),
        )
        .await?;

        Ok(detail
            .java_version
            .map(|j| j.major_version)
            .unwrap_or(LEGACY_JAVA_MAJOR))
    }
}

/// Alpha/beta sürümlerinin sunucu jar'ı yok; yalnız release (+ istenirse snapshot) listelenir.
fn filter_versions(entries: &[ManifestEntry], include_snapshots: bool) -> Vec<GameVersion> {
    entries
        .iter()
        .filter(|v| v.kind == "release" || (include_snapshots && v.kind == "snapshot"))
        .map(|v| GameVersion {
            id: v.id.clone(),
            kind: v.kind.clone(),
            release_time: v.release_time.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "latest": {"release": "26.3", "snapshot": "26.4-snapshot-1"},
        "versions": [
            {"id": "26.4-snapshot-1", "type": "snapshot", "url": "u1", "sha1": "a", "time": "t", "releaseTime": "2026-10-01T00:00:00+00:00", "complianceLevel": 1},
            {"id": "26.3", "type": "release", "url": "u2", "sha1": "b", "time": "t", "releaseTime": "2026-09-01T00:00:00+00:00", "complianceLevel": 1},
            {"id": "b1.7.3", "type": "old_beta", "url": "u3", "sha1": "c", "time": "t", "releaseTime": "2011-07-08T00:00:00+00:00", "complianceLevel": 0}
        ]
    }"#;

    #[test]
    fn parses_and_filters_manifest() {
        let m: Manifest = serde_json::from_str(SAMPLE).unwrap();
        assert_eq!(m.latest.release, "26.3");

        let releases = filter_versions(&m.versions, false);
        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].id, "26.3");

        let all = filter_versions(&m.versions, true);
        assert_eq!(
            all.iter().map(|v| v.id.as_str()).collect::<Vec<_>>(),
            ["26.4-snapshot-1", "26.3"]
        );
    }

    #[test]
    fn parses_version_detail() {
        let d: VersionDetail = serde_json::from_str(
            r#"{"downloads": {"server": {"sha1": "x", "size": 1, "url": "y"}}, "javaVersion": {"component": "java-runtime-epsilon", "majorVersion": 25}}"#,
        )
        .unwrap();
        assert_eq!(d.java_version.unwrap().major_version, 25);
        assert_eq!(d.downloads.server.unwrap().url, "y");

        let old: VersionDetail = serde_json::from_str(r#"{"downloads": {}}"#).unwrap();
        assert!(old.java_version.is_none() && old.downloads.server.is_none());
    }

    /// Gerçek Mojang API'sine gider: `cargo test -- --ignored live_install`
    /// Jar, `MCSM_TEST_DIR` (yoksa temp) altına indirilir.
    #[tokio::test]
    #[ignore = "ağ erişimi gerekir"]
    async fn live_install_latest_release() {
        let api = VanillaApi::new(reqwest::Client::new());
        let list = api.list_game_versions(false).await.unwrap();
        let dir = std::env::var_os("MCSM_TEST_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("mcsm-live-install"));
        let mut downloaded = 0;
        let java = api
            .install(&list.latest_release, &dir, |s| {
                if let InstallStage::Download { downloaded: d, .. } = s {
                    downloaded = d;
                }
            })
            .await
            .unwrap();
        let size = std::fs::metadata(dir.join(SERVER_JAR)).unwrap().len();
        assert_eq!(size, downloaded);
        assert!(java >= 21, "java major {java}");
        println!(
            "{} -> {} ({size} bayt, Java {java})",
            list.latest_release,
            dir.display()
        );
    }
}
