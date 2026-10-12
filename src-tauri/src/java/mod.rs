//! Java tespiti ve yönetimi: sistemdeki kurulumları tarar, sürüme uygun olanı seçer,
//! yoksa Adoptium'dan taşınabilir JRE indirir (`app_data/java/`).

mod adoptium;
mod scan;

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::util::hide_console;

pub use adoptium::JavaStage;

/// `java -version` asılı kalırsa (bozuk kurulum) beklenecek en uzun süre.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInfo {
    pub path: String,
    pub major: u32,
    pub version: String,
    /// Bu uygulamanın indirdiği (app_data/java altındaki) bir JRE mi?
    pub managed: bool,
}

pub struct JavaManager {
    root: PathBuf,
    adoptium: adoptium::Adoptium,
    cache: Mutex<Option<Vec<JavaInfo>>>,
    /// Aynı anda iki kurulum aynı JRE'yi indirmesin.
    install_lock: Mutex<()>,
}

impl JavaManager {
    pub fn new(root: PathBuf, http: reqwest::Client) -> Self {
        Self {
            root,
            adoptium: adoptium::Adoptium::new(http),
            cache: Mutex::new(None),
            install_lock: Mutex::new(()),
        }
    }

    /// Bulunan tüm Java'lar; büyük sürümden küçüğe. Tarama sonucu önbelleklenir.
    pub async fn list(&self, refresh: bool) -> Vec<JavaInfo> {
        let mut cache = self.cache.lock().await;
        if let Some(list) = cache.as_ref().filter(|_| !refresh) {
            return list.clone();
        }
        let root = self.root.clone();
        let paths = tokio::task::spawn_blocking(move || scan::candidates(&root))
            .await
            .unwrap_or_default();
        let probes = paths
            .iter()
            .map(|p| probe(p.to_string_lossy().into_owned()));
        let mut list: Vec<JavaInfo> = futures_util::future::join_all(probes)
            .await
            .into_iter()
            .flatten()
            .map(|mut j| {
                j.managed = PathBuf::from(&j.path).starts_with(&self.root);
                j
            })
            .collect();
        list.sort_by(|a, b| b.major.cmp(&a.major).then(a.path.cmp(&b.path)));
        *cache = Some(list.clone());
        list
    }

    /// Sunucunun kullanacağı Java: sabitlenmiş yol varsa o, yoksa listeden en uygunu.
    pub async fn resolve(
        &self,
        pinned: Option<&str>,
        required: u32,
    ) -> AppResult<Option<JavaInfo>> {
        if let Some(path) = pinned {
            let java = probe(path.to_string()).await.ok_or_else(|| {
                AppError::msg(tx!(
                    "Seçili Java çalıştırılamadı: {path}",
                    "Couldn't run the selected Java: {path}"
                ))
            })?;
            if java.major < required {
                return Err(AppError::msg(tx!(
                    "Seçili Java {} bu sunucu için eski; Java {required}+ gerekli.",
                    "The selected Java {} is too old for this server; Java {required}+ is required.",
                    java.major
                )));
            }
            return Ok(Some(java));
        }
        Ok(pick(&self.list(false).await, required).cloned())
    }

    /// Uygun Java yoksa Adoptium'dan indirir. İndirdiyse yeni Java'yı döner.
    pub async fn ensure(
        &self,
        required: u32,
        on_stage: impl FnMut(JavaStage) + Send,
    ) -> AppResult<Option<JavaInfo>> {
        if pick(&self.list(false).await, required).is_some() {
            return Ok(None);
        }
        self.install(required, on_stage).await.map(Some)
    }

    /// `required` veya üstü bir JRE'yi indirip kurar.
    pub async fn install(
        &self,
        required: u32,
        on_stage: impl FnMut(JavaStage) + Send,
    ) -> AppResult<JavaInfo> {
        let _guard = self.install_lock.lock().await;
        // Bekleyen başka bir kurulum az önce indirmiş olabilir.
        if let Some(j) = pick(&self.list(true).await, required).filter(|j| j.managed) {
            return Ok(j.clone());
        }
        let exe = self
            .adoptium
            .install(required, &self.root, on_stage)
            .await?;
        let java = probe(exe.to_string_lossy().into_owned())
            .await
            .ok_or_else(|| {
                AppError::msg(tx!(
                    "İndirilen Java çalıştırılamadı",
                    "Couldn't run the downloaded Java"
                ))
            })?;
        self.list(true).await;
        Ok(JavaInfo {
            managed: true,
            ..java
        })
    }
}

/// Canlı testler için: sistemde uygun Java, yoksa test klasörüne indirilir.
#[cfg(test)]
pub async fn test_java(required: u32) -> PathBuf {
    let http = reqwest::Client::builder()
        .user_agent(crate::consts::USER_AGENT)
        .build()
        .unwrap();
    let manager = JavaManager::new(crate::util::live_test_dir("java"), http);
    let java = match manager.resolve(None, required).await.unwrap() {
        Some(j) => j,
        None => manager.install(required, |_| {}).await.unwrap(),
    };
    println!("java {} -> {}", java.major, java.path);
    PathBuf::from(java.path)
}

/// Tam eşleşen major tercih edilir; yoksa gerekenden büyük olanların en küçüğü
/// (çok yeni Java eski Minecraft'ı bozabilir).
pub fn pick(list: &[JavaInfo], required: u32) -> Option<&JavaInfo> {
    list.iter()
        .filter(|j| j.major == required)
        .min_by_key(|j| !j.managed)
        .or_else(|| {
            list.iter()
                .filter(|j| j.major > required)
                .min_by_key(|j| j.major)
        })
}

/// `java -version` çıktısından sürümü okur (çıktı stderr'e yazılır).
pub async fn probe(path: String) -> Option<JavaInfo> {
    let mut cmd = tokio::process::Command::new(&path);
    cmd.arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide_console(&mut cmd);
    let out = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    let version = text.split('"').nth(1)?.to_string();
    Some(JavaInfo {
        major: parse_major(&version)?,
        version,
        path,
        managed: false,
    })
}

/// "1.8.0_392" → 8, "21.0.2" → 21, "27" → 27, "25-ea" → 25
fn parse_major(version: &str) -> Option<u32> {
    let mut parts = version.split(|c: char| !c.is_ascii_digit());
    let first: u32 = parts.next()?.parse().ok()?;
    if first == 1 {
        parts.next()?.parse().ok()
    } else {
        Some(first)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn j(major: u32, path: &str, managed: bool) -> JavaInfo {
        JavaInfo {
            path: path.into(),
            major,
            version: major.to_string(),
            managed,
        }
    }

    #[test]
    fn parses_java_versions() {
        assert_eq!(parse_major("1.8.0_392"), Some(8));
        assert_eq!(parse_major("21.0.2"), Some(21));
        assert_eq!(parse_major("27"), Some(27));
        assert_eq!(parse_major("25-ea"), Some(25));
        assert_eq!(parse_major(""), None);
    }

    #[test]
    fn picks_exact_then_lowest_newer() {
        let list = [
            j(27, "a", false),
            j(21, "b", false),
            j(17, "c", false),
            j(8, "d", false),
        ];
        assert_eq!(pick(&list, 21).unwrap().path, "b");
        assert_eq!(pick(&list, 16).unwrap().path, "c");
        assert_eq!(pick(&list, 25).unwrap().path, "a");
        assert!(pick(&list, 28).is_none());

        let twins = [j(25, "system", false), j(25, "ours", true)];
        assert_eq!(pick(&twins, 25).unwrap().path, "ours");
    }

    /// Bu makinedeki gerçek Java'ları listeler: `cargo test -- --ignored live_scan --nocapture`
    #[tokio::test]
    #[ignore = "makineye bağlı"]
    async fn live_scan() {
        let mgr = JavaManager::new(
            std::env::temp_dir().join("mcsm-java-none"),
            reqwest::Client::new(),
        );
        for j in mgr.list(true).await {
            println!("Java {:>2}  {}  {}", j.major, j.version, j.path);
        }
    }
}
