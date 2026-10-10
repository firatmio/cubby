use std::path::Path;
use std::sync::Arc;

use super::mojang::{MojangApi, SERVER_JAR, filter_versions};
use super::{GameVersionList, InstallRequest, InstallStage, Installed, Loader, LoaderVersionList};
use crate::error::AppResult;

pub struct VanillaLoader {
    mojang: Arc<MojangApi>,
}

impl VanillaLoader {
    pub fn new(mojang: Arc<MojangApi>) -> Self {
        Self { mojang }
    }
}

impl Loader for VanillaLoader {
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList> {
        let m = self.mojang.manifest().await?;
        Ok(GameVersionList {
            latest_release: m.latest.release.clone(),
            versions: filter_versions(&m.versions, include_snapshots),
        })
    }

    async fn list_loader_versions(&self, _game: &str) -> AppResult<LoaderVersionList> {
        Ok(LoaderVersionList::default())
    }

    async fn install(
        &self,
        req: &InstallRequest<'_>,
        server_dir: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<Installed> {
        on_stage(InstallStage::Meta);
        let java_major = self
            .mojang
            .install_server_jar(req.mc_version, &server_dir.join(SERVER_JAR), on_stage)
            .await?;
        Ok(Installed {
            java_major,
            loader_version: None,
        })
    }

    fn launch_args(&self) -> Vec<String> {
        vec!["-jar".into(), SERVER_JAR.into(), "nogui".into()]
    }

    fn content_dir(&self) -> Option<&'static str> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gerçek Mojang API'sine gider: `cargo test -- --ignored live_install`
    /// Jar'lar `MCSM_TEST_DIR` (yoksa temp) altına indirilir.
    #[tokio::test]
    #[ignore = "ağ erişimi gerekir"]
    async fn live_install_vanilla() {
        let loader = VanillaLoader::new(Arc::new(MojangApi::new(reqwest::Client::new())));
        let list = loader.list_game_versions(false).await.unwrap();
        let dir = crate::util::live_test_dir("vanilla");
        let mut downloaded = 0;
        let installed = loader
            .install(
                &InstallRequest {
                    mc_version: &list.latest_release,
                    loader_version: None,
                },
                &dir,
                &mut |s| {
                    if let InstallStage::Download { downloaded: d, .. } = s {
                        downloaded = d;
                    }
                },
            )
            .await
            .unwrap();
        let size = std::fs::metadata(dir.join(SERVER_JAR)).unwrap().len();
        assert_eq!(size, downloaded);
        assert!(installed.java_major >= 21);
        println!("vanilla {} -> {}", list.latest_release, dir.display());
    }
}
