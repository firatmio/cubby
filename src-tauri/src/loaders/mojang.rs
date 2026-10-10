//! Mojang sürüm manifest'i (piston-meta). Vanilla doğrudan, Fabric (sunucu jar'ı + sürüm türleri)
//! ve Paper (sürüm türleri, Java yedeği) dolaylı kullanır.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use serde::Deserialize;
use tokio::sync::Mutex;

use super::{GameVersion, InstallStage};
use crate::consts::MANIFEST_TTL;
use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::{HashAlgo, hash_bytes};

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/// Java sürümü belirtmeyen çok eski sürümler Java 8 ile çalışır.
const LEGACY_JAVA_MAJOR: u32 = 8;

pub const SERVER_JAR: &str = "server.jar";

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub latest: Latest,
    pub versions: Vec<ManifestEntry>,
}

#[derive(Debug, Deserialize)]
pub struct Latest {
    pub release: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    url: String,
    sha1: String,
    pub release_time: String,
}

impl Manifest {
    pub fn entry(&self, id: &str) -> Option<&ManifestEntry> {
        self.versions.iter().find(|v| v.id == id)
    }
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

impl VersionDetail {
    fn java_major(&self) -> u32 {
        self.java_version
            .as_ref()
            .map(|j| j.major_version)
            .unwrap_or(LEGACY_JAVA_MAJOR)
    }
}

pub struct MojangApi {
    http: reqwest::Client,
    cache: Mutex<Option<(Instant, Arc<Manifest>)>>,
}

impl MojangApi {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            cache: Mutex::new(None),
        }
    }

    pub async fn manifest(&self) -> AppResult<Arc<Manifest>> {
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

    /// Sürüm JSON'unu indirir ve manifest'teki sha1 ile doğrular.
    async fn version_detail(&self, mc_version: &str) -> AppResult<VersionDetail> {
        let m = self.manifest().await?;
        let entry = m
            .entry(mc_version)
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
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub async fn java_major(&self, mc_version: &str) -> AppResult<u32> {
        Ok(self.version_detail(mc_version).await?.java_major())
    }

    /// Resmi sunucu jar'ını `dest`'e indirip sha1 ile doğrular. Gereken Java major sürümünü döner.
    pub async fn install_server_jar(
        &self,
        mc_version: &str,
        dest: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<u32> {
        let detail = self.version_detail(mc_version).await?;
        let server = detail.downloads.server.as_ref().ok_or_else(|| {
            AppError::msg(format!("{mc_version} sürümünün resmi sunucu dosyası yok"))
        })?;
        download_file(
            &self.http,
            &server.url,
            dest,
            Some((HashAlgo::Sha1, &server.sha1)),
            |downloaded, total| {
                on_stage(InstallStage::Download {
                    file: "server",
                    downloaded,
                    total,
                })
            },
        )
        .await?;
        Ok(detail.java_major())
    }
}

/// Alpha/beta sürümlerinin sunucu jar'ı yok; yalnız release (+ istenirse snapshot) listelenir.
pub fn filter_versions(entries: &[ManifestEntry], include_snapshots: bool) -> Vec<GameVersion> {
    entries
        .iter()
        .filter(|v| is_listed(&v.kind, include_snapshots))
        .map(|v| GameVersion {
            id: v.id.clone(),
            kind: v.kind.clone(),
            release_time: v.release_time.clone(),
        })
        .collect()
}

pub fn is_listed(kind: &str, include_snapshots: bool) -> bool {
    kind == "release" || (include_snapshots && kind == "snapshot")
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub const SAMPLE: &str = r#"{
        "latest": {"release": "26.3", "snapshot": "26.4-snapshot-1"},
        "versions": [
            {"id": "26.4-snapshot-1", "type": "snapshot", "url": "u1", "sha1": "a", "time": "t", "releaseTime": "2026-10-01T00:00:00+00:00", "complianceLevel": 1},
            {"id": "26.3", "type": "release", "url": "u2", "sha1": "b", "time": "t", "releaseTime": "2026-09-01T00:00:00+00:00", "complianceLevel": 1},
            {"id": "26.2", "type": "release", "url": "u4", "sha1": "d", "time": "t", "releaseTime": "2026-06-01T00:00:00+00:00", "complianceLevel": 1},
            {"id": "b1.7.3", "type": "old_beta", "url": "u3", "sha1": "c", "time": "t", "releaseTime": "2011-07-08T00:00:00+00:00", "complianceLevel": 0}
        ]
    }"#;

    pub fn sample() -> Manifest {
        serde_json::from_str(SAMPLE).unwrap()
    }

    #[test]
    fn parses_and_filters_manifest() {
        let m = sample();
        assert_eq!(m.latest.release, "26.3");

        let ids = |v: Vec<GameVersion>| v.into_iter().map(|g| g.id).collect::<Vec<_>>();
        assert_eq!(ids(filter_versions(&m.versions, false)), ["26.3", "26.2"]);
        assert_eq!(
            ids(filter_versions(&m.versions, true)),
            ["26.4-snapshot-1", "26.3", "26.2"]
        );
    }

    #[test]
    fn parses_version_detail() {
        let d: VersionDetail = serde_json::from_str(
            r#"{"downloads": {"server": {"sha1": "x", "size": 1, "url": "y"}}, "javaVersion": {"component": "java-runtime-epsilon", "majorVersion": 25}}"#,
        )
        .unwrap();
        assert_eq!(d.java_major(), 25);
        assert_eq!(d.downloads.server.unwrap().url, "y");

        let old: VersionDetail = serde_json::from_str(r#"{"downloads": {}}"#).unwrap();
        assert_eq!(old.java_major(), LEGACY_JAVA_MAJOR);
        assert!(old.downloads.server.is_none());
    }
}
