//! Fabric: meta.fabricmc.net v2. Vanilla sunucu jar'ını biz (sha1 doğrulamalı) başlatıcının
//! önbellek yoluna koyarız; başlatıcı onu bulursa tekrar indirmez.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use super::mojang::{MojangApi, is_listed};
use super::{
    GameVersion, GameVersionList, InstallRequest, InstallStage, Installed, Loader, LoaderVersion,
    LoaderVersionList, encode_segment, ensure_jar,
};
use crate::download::download_file;
use crate::error::{AppError, AppResult};

const META: &str = "https://meta.fabricmc.net/v2";

pub const LAUNCHER_JAR: &str = "fabric-server-launch.jar";

/// Fabric sunucu başlatıcısının (1.1.x) vanilla jar'ı aradığı yer. Yol değişirse başlatıcı
/// jar'ı kendisi indirir; yalnızca bir kez fazladan indirme olur.
fn vanilla_cache_path(server_dir: &Path, mc_version: &str) -> std::path::PathBuf {
    server_dir
        .join(".fabric")
        .join("server")
        .join(format!("{mc_version}-server.jar"))
}

#[derive(Debug, Deserialize)]
struct FabricGame {
    version: String,
}

#[derive(Debug, Deserialize)]
struct LoaderEntry {
    loader: VersionFlag,
}

#[derive(Debug, Deserialize)]
struct VersionFlag {
    version: String,
    stable: bool,
}

pub struct FabricLoader {
    http: reqwest::Client,
    mojang: Arc<MojangApi>,
}

impl FabricLoader {
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

    async fn latest_installer(&self) -> AppResult<String> {
        let installers: Vec<VersionFlag> = self.get("/versions/installer").await?;
        pick_recommended(&installers)
            .ok_or_else(|| AppError::msg("Fabric başlatıcı sürümü bulunamadı"))
    }
}

/// İlk stable, yoksa ilk sürüm (liste yeniden eskiye sıralı gelir).
fn pick_recommended(list: &[VersionFlag]) -> Option<String> {
    list.iter()
        .find(|v| v.stable)
        .or(list.first())
        .map(|v| v.version.clone())
}

impl Loader for FabricLoader {
    /// Fabric'in desteklediği sürümler ∩ Mojang manifest (tür ve tarih Mojang'dan).
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let games: Vec<FabricGame> = self.get("/versions/game").await?;
        let manifest = self.mojang.manifest().await?;
        let supported: HashSet<&str> = games.iter().map(|g| g.version.as_str()).collect();
        let versions: Vec<GameVersion> = manifest
            .versions
            .iter()
            .filter(|v| supported.contains(v.id.as_str()) && is_listed(&v.kind, include_snapshots))
            .map(|v| GameVersion {
                id: v.id.clone(),
                kind: v.kind.clone(),
                release_time: v.release_time.clone(),
            })
            .collect();
        Ok(GameVersionList::new(&manifest.latest.release, versions))
    }

    async fn list_loader_versions(&self, game: &str) -> AppResult<LoaderVersionList> {
        let entries: Vec<LoaderEntry> = self
            .get(&format!("/versions/loader/{}", encode_segment(game)))
            .await?;
        let flags: Vec<VersionFlag> = entries.into_iter().map(|e| e.loader).collect();
        Ok(LoaderVersionList {
            recommended: pick_recommended(&flags),
            versions: flags
                .into_iter()
                .map(|f| LoaderVersion {
                    version: f.version,
                    stable: f.stable,
                    channel: None,
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
        let loader_version = match req.loader_version {
            Some(v) => v.to_string(),
            None => self
                .list_loader_versions(req.mc_version)
                .await?
                .recommended
                .ok_or_else(|| {
                    AppError::msg(format!("{} için Fabric sürümü yok", req.mc_version))
                })?,
        };
        let installer = self.latest_installer().await?;

        let java_major = self
            .mojang
            .install_server_jar(
                req.mc_version,
                &vanilla_cache_path(server_dir, req.mc_version),
                on_stage,
            )
            .await?;

        let url = format!(
            "{META}/versions/loader/{}/{}/{}/server/jar",
            encode_segment(req.mc_version),
            encode_segment(&loader_version),
            encode_segment(&installer)
        );
        let jar = server_dir.join(LAUNCHER_JAR);
        // Fabric bu dosya için hash yayınlamıyor; en azından gerçekten jar olduğunu kontrol et.
        download_file(&self.http, &url, &jar, None, |downloaded, total| {
            on_stage(InstallStage::Download {
                file: "fabric",
                downloaded,
                total,
            })
        })
        .await?;
        ensure_jar(&jar).await?;
        tokio::fs::create_dir_all(server_dir.join("mods")).await?;

        Ok(Installed {
            java_major,
            loader_version: Some(loader_version),
        })
    }

    fn launch_args(&self) -> Vec<String> {
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
    fn parses_meta_responses() {
        let games: Vec<FabricGame> = serde_json::from_str(
            r#"[{"version":"26.4-snapshot-3","stable":false},{"version":"26.3","stable":true}]"#,
        )
        .unwrap();
        assert_eq!(games[1].version, "26.3");

        let loaders: Vec<LoaderEntry> = serde_json::from_str(
            r#"[{"loader":{"separator":".","build":5,"maven":"net.fabricmc:fabric-loader:0.20.0-beta.1","version":"0.20.0-beta.1","stable":false},"intermediary":{"version":"0.0.0","stable":true},"launcherMeta":{}},
                {"loader":{"separator":".","build":5,"maven":"net.fabricmc:fabric-loader:0.19.5","version":"0.19.5","stable":true},"intermediary":{"version":"0.0.0","stable":true},"launcherMeta":{}}]"#,
        )
        .unwrap();
        let flags: Vec<VersionFlag> = loaders.into_iter().map(|e| e.loader).collect();
        assert_eq!(pick_recommended(&flags).as_deref(), Some("0.19.5"));

        let installers: Vec<VersionFlag> = serde_json::from_str(
            r#"[{"url":"u","maven":"m","version":"1.1.2","stable":true},{"url":"u","maven":"m","version":"1.1.1","stable":false}]"#,
        )
        .unwrap();
        assert_eq!(pick_recommended(&installers).as_deref(), Some("1.1.2"));
    }

    #[test]
    fn recommended_falls_back_to_newest_unstable() {
        let only_unstable = vec![VersionFlag {
            version: "0.20.0-beta.1".into(),
            stable: false,
        }];
        assert_eq!(
            pick_recommended(&only_unstable).as_deref(),
            Some("0.20.0-beta.1")
        );
        assert_eq!(pick_recommended(&[]), None);
    }

    #[tokio::test]
    #[ignore = "ağ erişimi gerekir"]
    async fn live_install_fabric() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let loader = FabricLoader::new(http.clone(), Arc::new(MojangApi::new(http)));
        let list = loader.list_game_versions(false).await.unwrap();
        let dir = crate::util::live_test_dir("fabric");
        let installed = loader
            .install(
                &InstallRequest {
                    mc_version: &list.latest_release,
                    loader_version: None,
                },
                &dir,
                &mut |_| {},
            )
            .await
            .unwrap();
        assert!(dir.join(LAUNCHER_JAR).is_file());
        assert!(vanilla_cache_path(&dir, &list.latest_release).is_file());
        println!(
            "fabric {} loader {:?} -> {}",
            list.latest_release,
            installed.loader_version,
            dir.display()
        );
    }
}
