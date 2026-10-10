mod fabric;
mod mojang;
mod paper;
mod vanilla;

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use fabric::FabricLoader;
use mojang::MojangApi;
use paper::PaperLoader;
use vanilla::VanillaLoader;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind {
    Vanilla,
    Fabric,
    Paper,
}

/// Arayüzde gösterilen oyun sürümü.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersionList {
    /// Varsayılan seçilecek sürüm (listedeki en yeni release).
    pub latest_release: String,
    pub versions: Vec<GameVersion>,
}

impl GameVersionList {
    /// `preferred` listede yoksa listedeki ilk release'e, o da yoksa ilk öğeye düşer.
    fn new(preferred: &str, versions: Vec<GameVersion>) -> Self {
        let latest_release = versions
            .iter()
            .find(|v| v.id == preferred)
            .or_else(|| versions.iter().find(|v| v.kind == "release"))
            .or(versions.first())
            .map(|v| v.id.clone())
            .unwrap_or_default();
        Self {
            latest_release,
            versions,
        }
    }
}

/// Fabric loader sürümü veya Paper build'i.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
    /// Paper: "stable" | "beta" | "alpha"
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersionList {
    pub versions: Vec<LoaderVersion>,
    pub recommended: Option<String>,
}

pub struct InstallRequest<'a> {
    pub mc_version: &'a str,
    /// `None` ise önerilen sürüm kullanılır.
    pub loader_version: Option<&'a str>,
}

pub struct Installed {
    pub java_major: u32,
    pub loader_version: Option<String>,
}

pub enum InstallStage {
    Meta,
    /// `file`: "server" (vanilla jar) | "fabric" (başlatıcı) | "paper"
    Download {
        file: &'static str,
        downloaded: u64,
        total: Option<u64>,
    },
}

/// Her sunucu türünün uygulaması. Çağrılar `Loaders` üzerinden `LoaderKind`'e göre dağıtılır
/// (native async trait; `dyn` kullanılmıyor).
pub trait Loader {
    async fn list_game_versions(&self, include_snapshots: bool) -> AppResult<GameVersionList>;

    /// Vanilla için boş liste.
    async fn list_loader_versions(&self, game: &str) -> AppResult<LoaderVersionList>;

    /// Sunucu dosyalarını `server_dir`'e kurar.
    async fn install(
        &self,
        req: &InstallRequest<'_>,
        server_dir: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<Installed>;

    /// JVM ayarlarından sonraki kısım: `-jar <jar> nogui`.
    fn launch_args(&self) -> Vec<String>;

    /// `mods` / `plugins`; yoksa `None`.
    fn content_dir(&self) -> Option<&'static str>;
}

pub struct Loaders {
    vanilla: VanillaLoader,
    fabric: FabricLoader,
    paper: PaperLoader,
}

macro_rules! dispatch {
    ($self:ident, $kind:expr, $loader:ident => $body:expr) => {
        match $kind {
            LoaderKind::Vanilla => {
                let $loader = &$self.vanilla;
                $body
            }
            LoaderKind::Fabric => {
                let $loader = &$self.fabric;
                $body
            }
            LoaderKind::Paper => {
                let $loader = &$self.paper;
                $body
            }
        }
    };
}

impl Loaders {
    pub fn new(http: reqwest::Client) -> Self {
        let mojang = Arc::new(MojangApi::new(http.clone()));
        Self {
            vanilla: VanillaLoader::new(mojang.clone()),
            fabric: FabricLoader::new(http.clone(), mojang.clone()),
            paper: PaperLoader::new(http, mojang),
        }
    }

    pub async fn list_game_versions(
        &self,
        kind: LoaderKind,
        include_snapshots: bool,
    ) -> AppResult<GameVersionList> {
        dispatch!(self, kind, l => l.list_game_versions(include_snapshots).await)
    }

    pub async fn list_loader_versions(
        &self,
        kind: LoaderKind,
        game: &str,
    ) -> AppResult<LoaderVersionList> {
        dispatch!(self, kind, l => l.list_loader_versions(game).await)
    }

    pub async fn install(
        &self,
        kind: LoaderKind,
        req: &InstallRequest<'_>,
        server_dir: &Path,
        on_stage: &mut (impl FnMut(InstallStage) + Send),
    ) -> AppResult<Installed> {
        dispatch!(self, kind, l => l.install(req, server_dir, on_stage).await)
    }

    pub fn launch_args(&self, kind: LoaderKind) -> Vec<String> {
        dispatch!(self, kind, l => l.launch_args())
    }

    pub fn content_dir(&self, kind: LoaderKind) -> Option<&'static str> {
        dispatch!(self, kind, l => l.content_dir())
    }
}

/// URL yol parçası için yüzde kodlama (ör. "1.14 Pre-Release 5").
fn encode_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// İndirilen dosyanın gerçekten jar (zip) olduğunu kontrol eder; hash vermeyen kaynaklar için.
async fn ensure_jar(path: &Path) -> AppResult<()> {
    use tokio::io::AsyncReadExt;
    let mut magic = [0u8; 2];
    let ok = match tokio::fs::File::open(path).await {
        Ok(mut f) => f.read_exact(&mut magic).await.is_ok() && &magic == b"PK",
        Err(_) => false,
    };
    if !ok {
        let _ = tokio::fs::remove_file(path).await;
        return Err(crate::error::AppError::msg(format!(
            "İndirilen dosya geçerli bir jar değil: {}",
            path.file_name().unwrap_or_default().to_string_lossy()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gv(id: &str, kind: &str) -> GameVersion {
        GameVersion {
            id: id.into(),
            kind: kind.into(),
            release_time: String::new(),
        }
    }

    #[test]
    fn latest_release_falls_back() {
        let l = GameVersionList::new(
            "26.3",
            vec![gv("26.4-snap", "snapshot"), gv("26.3", "release")],
        );
        assert_eq!(l.latest_release, "26.3");
        let l = GameVersionList::new(
            "26.3",
            vec![gv("26.3-rc-1", "snapshot"), gv("26.2", "release")],
        );
        assert_eq!(l.latest_release, "26.2");
        let l = GameVersionList::new("26.3", vec![]);
        assert_eq!(l.latest_release, "");
    }

    #[test]
    fn encodes_path_segments() {
        assert_eq!(encode_segment("26.3"), "26.3");
        assert_eq!(
            encode_segment("1.14 Pre-Release 5"),
            "1.14%20Pre-Release%205"
        );
        assert_eq!(encode_segment("../x"), "..%2Fx");
    }
}
