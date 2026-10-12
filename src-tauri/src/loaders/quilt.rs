//! Quilt: meta.quiltmc.org v3. Sunucu jar'ını doğrudan veren bir uç nokta yok; resmi installer
//! (`install server`) başlatıcıyı ve kütüphaneleri kurar. Resmi Minecraft jar'ını biz (sha1
//! doğrulamalı) `server.jar` olarak koyarız; başlatıcı onu kullanır.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use super::installer::{cleanup, download_maven, run};
use super::mojang::{MojangApi, SERVER_JAR};
use super::{
    GameVersionList, InstallRequest, InstallStage, Installed, Loader, LoaderVersion,
    LoaderVersionList, cmp_versions, encode_segment, intersect_manifest,
};
use crate::error::{AppError, AppResult};

pub const META: &str = "https://meta.quiltmc.org/v3";

pub const LAUNCHER_JAR: &str = "quilt-server-launch.jar";

#[derive(Debug, Deserialize)]
struct QuiltGame {
    version: String,
}

#[derive(Debug, Deserialize)]
struct LoaderEntry {
    loader: Version,
}

#[derive(Debug, Deserialize)]
struct Version {
    version: String,
}

#[derive(Debug, Deserialize)]
struct InstallerEntry {
    version: String,
    url: String,
}

fn is_stable(v: &str) -> bool {
    !v.contains('-')
}

/// Yeniden eskiye sıralı listede ilk kararlı, yoksa en yeni.
fn pick_recommended(list: &[LoaderVersion]) -> Option<String> {
    list.iter()
        .find(|v| v.stable)
        .or(list.first())
        .map(|v| v.version.clone())
}

pub struct QuiltLoader {
    http: reqwest::Client,
    mojang: Arc<MojangApi>,
}

impl QuiltLoader {
    pub fn new(http: reqwest::Client, mojang: Arc<MojangApi>) -> Self {
        Self { http, mojang }
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        Ok(self
            .http
            .get(format!("{META}{path}"))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
}

impl Loader for QuiltLoader {
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let games: Vec<QuiltGame> = self.get("/versions/game").await?;
        let supported: HashSet<String> = games.into_iter().map(|g| g.version).collect();
        let manifest = self.mojang.manifest().await?;
        Ok(intersect_manifest(&manifest, &supported, include_snapshots))
    }

    async fn list_loader_versions(&self, game: &str) -> AppResult<LoaderVersionList> {
        let entries: Vec<LoaderEntry> = self
            .get(&format!("/versions/loader/{}", encode_segment(game)))
            .await?;
        let mut versions: Vec<LoaderVersion> = entries
            .into_iter()
            .map(|e| LoaderVersion {
                stable: is_stable(&e.loader.version),
                version: e.loader.version,
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
        let java = req
            .java
            .ok_or_else(|| AppError::msg("Kurulum için Java gerekli."))?;
        let loader_version = match req.loader_version {
            Some(v) => v.to_string(),
            None => self
                .list_loader_versions(req.mc_version)
                .await?
                .recommended
                .ok_or_else(|| {
                    AppError::msg(format!("{} için Quilt sürümü yok", req.mc_version))
                })?,
        };
        if !crate::util::is_safe_name(&loader_version) {
            return Err(AppError::msg("Geçersiz Quilt sürümü."));
        }
        let installers: Vec<InstallerEntry> = self.get("/versions/installer").await?;
        let installer = installers
            .iter()
            .max_by(|a, b| {
                is_stable(&a.version)
                    .cmp(&is_stable(&b.version))
                    .then_with(|| cmp_versions(&a.version, &b.version))
            })
            .ok_or_else(|| AppError::msg("Quilt installer bulunamadı"))?;

        let java_major = self
            .mojang
            .install_server_jar(req.mc_version, &server_dir.join(SERVER_JAR), on_stage)
            .await?;

        let jar = server_dir.join("mcsm-installer.jar");
        // Meta'daki hash'ler eski kalabiliyor (2026-10-12'de 0.15.1 için tutmuyordu); Maven'in
        // kendi `.sha256` dosyası esas alınır.
        download_maven(&self.http, &installer.url, &jar, |downloaded, total| {
            on_stage(InstallStage::Download {
                file: "installer",
                downloaded,
                total,
            })
        })
        .await?;
        let mut install_dir = std::ffi::OsString::from("--install-dir=");
        install_dir.push(server_dir.as_os_str());
        let result = run(
            java,
            &jar,
            &[
                "install".into(),
                "server".into(),
                req.mc_version.into(),
                loader_version.as_str().into(),
                install_dir,
            ],
            server_dir,
            &mut |line| on_stage(InstallStage::Installer { line }),
        )
        .await;
        cleanup(server_dir, &jar).await;
        result?;
        if !server_dir.join(LAUNCHER_JAR).is_file() {
            return Err(AppError::msg(
                "Quilt kurulumu bitti ama başlatıcı oluşmadı. Başka bir sürüm deneyebilirsin.",
            ));
        }
        tokio::fs::create_dir_all(server_dir.join("mods")).await?;

        Ok(Installed {
            java_major,
            loader_version: Some(loader_version),
        })
    }

    fn launch_args(&self, _mc: &str, _loader: Option<&str>) -> Vec<String> {
        vec!["-jar".into(), LAUNCHER_JAR.into(), "nogui".into()]
    }

    fn content_dir(&self) -> Option<&'static str> {
        Some("mods")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_meta_and_picks_stable() {
        let entries: Vec<LoaderEntry> = serde_json::from_str(
            r#"[{"loader":{"version":"0.20.0-beta.9","maven":"m"},"launcherMeta":{}},
                {"loader":{"version":"0.30.1","maven":"m"},"launcherMeta":{}},
                {"loader":{"version":"0.31.0-beta.4","maven":"m"},"launcherMeta":{}},
                {"loader":{"version":"0.30.0","maven":"m"},"launcherMeta":{}}]"#,
        )
        .unwrap();
        let mut versions: Vec<LoaderVersion> = entries
            .into_iter()
            .map(|e| LoaderVersion {
                stable: is_stable(&e.loader.version),
                version: e.loader.version,
                channel: None,
            })
            .collect();
        versions.sort_by(|a, b| cmp_versions(&b.version, &a.version));
        assert_eq!(versions[0].version, "0.31.0-beta.4");
        assert_eq!(pick_recommended(&versions).as_deref(), Some("0.30.1"));

        let inst: Vec<InstallerEntry> = serde_json::from_str(
            r#"[{"version":"0.15.1","url":"u","maven":"m","hashes":{"sha1":"a","sha256":"b"}}]"#,
        )
        .unwrap();
        assert_eq!(inst[0].url, "u");
    }

    #[tokio::test]
    #[ignore = "ağ erişimi ve Java gerekir"]
    async fn live_install_quilt() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let mojang = Arc::new(MojangApi::new(http.clone()));
        let loader = QuiltLoader::new(http, mojang.clone());
        let list = loader.list_game_versions(false).await.unwrap();
        let mc = list.latest_release.clone();
        let java = crate::java::test_java(mojang.java_major(&mc).await.unwrap()).await;
        let dir = crate::util::live_test_dir("quilt");
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
        assert!(dir.join(LAUNCHER_JAR).is_file());
        println!(
            "quilt {mc} loader {:?} -> {}",
            installed.loader_version,
            dir.display()
        );
    }
}
