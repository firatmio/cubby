mod fabric;
mod forge;
mod installer;
mod mojang;
mod neoforge;
mod paper;
mod quilt;
mod vanilla;

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use fabric::FabricLoader;
use forge::ForgeLoader;
pub use installer::{
    cleanup as installer_cleanup, download_maven, run as run_installer,
    version_id as installer_version_id,
};
use mojang::MojangApi;
use neoforge::NeoForgeLoader;
use paper::PaperLoader;
use quilt::QuiltLoader;
use vanilla::VanillaLoader;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind {
    Vanilla,
    Fabric,
    Paper,
    #[serde(rename = "neoforge")]
    NeoForge,
    Forge,
    Quilt,
}

impl LoaderKind {
    /// Oyuncunun da aynı modları kurması gereken türler (`mods/` klasörü olanlar).
    pub fn is_modded(self) -> bool {
        matches!(
            self,
            Self::Fabric | Self::NeoForge | Self::Forge | Self::Quilt
        )
    }

    /// Kurulumu resmi installer'ı Java ile çalıştırarak yapılanlar.
    pub fn uses_installer(self) -> bool {
        matches!(self, Self::NeoForge | Self::Forge | Self::Quilt)
    }

    /// Mesajlarda görünen ad.
    pub fn label(self) -> &'static str {
        match self {
            Self::Vanilla => "Vanilla",
            Self::Fabric => "Fabric",
            Self::Paper => "Paper",
            Self::NeoForge => "NeoForge",
            Self::Forge => "Forge",
            Self::Quilt => "Quilt",
        }
    }
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
    /// Installer'ı çalıştıracak Java (yalnız `uses_installer` türleri için gerekli).
    pub java: Option<&'a Path>,
}

pub struct Installed {
    pub java_major: u32,
    pub loader_version: Option<String>,
}

pub enum InstallStage {
    Meta,
    /// `file`: "server" (vanilla jar) | "fabric" (başlatıcı) | "paper" | "installer"
    Download {
        file: &'static str,
        downloaded: u64,
        total: Option<u64>,
    },
    /// Installer çalışıyor; çıktısının son satırı.
    Installer {
        line: String,
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
    fn launch_args(&self, mc_version: &str, loader_version: Option<&str>) -> Vec<String>;

    /// `mods` / `plugins`; yoksa `None`.
    fn content_dir(&self) -> Option<&'static str>;
}

pub struct Loaders {
    mojang: Arc<MojangApi>,
    vanilla: VanillaLoader,
    fabric: FabricLoader,
    paper: PaperLoader,
    neoforge: NeoForgeLoader,
    forge: ForgeLoader,
    quilt: QuiltLoader,
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
            LoaderKind::NeoForge => {
                let $loader = &$self.neoforge;
                $body
            }
            LoaderKind::Forge => {
                let $loader = &$self.forge;
                $body
            }
            LoaderKind::Quilt => {
                let $loader = &$self.quilt;
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
            paper: PaperLoader::new(http.clone(), mojang.clone()),
            neoforge: NeoForgeLoader::new(http.clone(), mojang.clone()),
            forge: ForgeLoader::new(http.clone(), mojang.clone()),
            quilt: QuiltLoader::new(http, mojang.clone()),
            mojang,
        }
    }

    /// Sürümün istediği Java major sürümü (Mojang sürüm JSON'undan).
    pub async fn java_major(&self, mc_version: &str) -> AppResult<u32> {
        self.mojang.java_major(mc_version).await
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

    pub fn launch_args(
        &self,
        kind: LoaderKind,
        mc_version: &str,
        loader_version: Option<&str>,
    ) -> Vec<String> {
        dispatch!(self, kind, l => l.launch_args(mc_version, loader_version))
    }

    pub fn content_dir(&self, kind: LoaderKind) -> Option<&'static str> {
        dispatch!(self, kind, l => l.content_dir())
    }
}

/// NeoForge/Forge installer'ının adresi (installer kullanmayan türlerde `None`).
pub fn installer_url(kind: LoaderKind, mc: &str, loader: &str) -> Option<String> {
    match kind {
        LoaderKind::NeoForge => Some(neoforge::installer_url(loader)),
        LoaderKind::Forge => Some(forge::installer_url(mc, loader)),
        _ => None,
    }
}

/// Sürüm adlarını sayısal karşılaştırır: `0.30.1` > `0.30.0` > `0.30.0-beta.10` > `0.30.0-beta.9`.
pub(crate) fn cmp_versions(a: &str, b: &str) -> std::cmp::Ordering {
    fn split(v: &str) -> (Vec<u64>, Option<&str>) {
        let (base, pre) = match v.split_once(['-', '+']) {
            Some((b, p)) => (b, Some(p)),
            None => (v, None),
        };
        (
            base.split('.').map(|p| p.parse().unwrap_or(0)).collect(),
            pre,
        )
    }
    /// "beta.10" → [("beta", 0), ("", 10)] gibi parçalar; sayılar sayı olarak karşılaştırılır.
    fn natural(s: &str) -> Vec<(String, u64)> {
        let mut out = Vec::new();
        let mut text = String::new();
        let mut num = String::new();
        for c in s.chars() {
            if c.is_ascii_digit() {
                num.push(c);
            } else {
                if !num.is_empty() {
                    out.push((std::mem::take(&mut text), num.parse().unwrap_or(0)));
                    num.clear();
                }
                text.push(c);
            }
        }
        out.push((text, num.parse().unwrap_or(0)));
        out
    }
    let ((ab, ap), (bb, bp)) = (split(a), split(b));
    let len = ab.len().max(bb.len());
    for i in 0..len {
        let (x, y) = (
            ab.get(i).copied().unwrap_or(0),
            bb.get(i).copied().unwrap_or(0),
        );
        if x != y {
            return x.cmp(&y);
        }
    }
    match (ap, bp) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(_), None) => std::cmp::Ordering::Less,
        (Some(x), Some(y)) => natural(x).cmp(&natural(y)),
    }
}

/// Mojang listesinde olan sürümler, Mojang sırasıyla (tür ve tarih oradan).
fn intersect_manifest(
    manifest: &mojang::Manifest,
    supported: &std::collections::HashSet<String>,
    include_snapshots: bool,
) -> GameVersionList {
    let versions: Vec<GameVersion> = manifest
        .versions
        .iter()
        .filter(|v| {
            supported.contains(v.id.as_str()) && mojang::is_listed(&v.kind, include_snapshots)
        })
        .map(|v| GameVersion {
            id: v.id.clone(),
            kind: v.kind.clone(),
            release_time: v.release_time.clone(),
        })
        .collect();
    GameVersionList::new(&manifest.latest.release, versions)
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
    fn compares_versions() {
        use std::cmp::Ordering::*;
        assert_eq!(cmp_versions("0.30.1", "0.30.0"), Greater);
        assert_eq!(cmp_versions("0.30.0", "0.30.0-beta.10"), Greater);
        assert_eq!(cmp_versions("0.30.0-beta.10", "0.30.0-beta.9"), Greater);
        assert_eq!(cmp_versions("21.10.3", "21.2.9"), Greater);
        assert_eq!(cmp_versions("26.3.0.76", "26.3.0.75-beta"), Greater);
        assert_eq!(cmp_versions("66.0.10", "66.0.10"), Equal);
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
