//! Eclipse Temurin JRE indirme (Adoptium API v3). Paket sha256 ile doğrulanır,
//! `app_data/java/<sürüm>-jre/` altına açılır.

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::scan::java_in;
use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::HashAlgo;

const API: &str = "https://api.adoptium.net/v3";

pub enum JavaStage {
    Download { downloaded: u64, total: Option<u64> },
    Extract,
}

#[derive(Debug, Deserialize)]
struct AvailableReleases {
    available_releases: Vec<u32>,
    available_lts_releases: Vec<u32>,
}

#[derive(Debug, Deserialize)]
struct Asset {
    release_name: String,
    binary: Binary,
}

#[derive(Debug, Deserialize)]
struct Binary {
    package: Package,
}

#[derive(Debug, Deserialize)]
struct Package {
    name: String,
    link: String,
    checksum: String,
}

/// Adoptium'un işletim sistemi / mimari adları.
fn platform() -> Option<(&'static str, &'static str)> {
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "mac",
        "linux" => "linux",
        _ => return None,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        _ => return None,
    };
    Some((os, arch))
}

/// Denenecek Java sürümleri: önce gerekeni karşılayan en küçük LTS (bakımı süren),
/// sonra tam istenen, sonra mevcut diğer daha yeniler. (Ör. 16 → 17; 16'nın JRE'si yok.)
fn feature_candidates(required: u32, rel: &AvailableReleases) -> Vec<u32> {
    let mut lts: Vec<u32> = rel
        .available_lts_releases
        .iter()
        .copied()
        .filter(|&v| v >= required)
        .collect();
    lts.sort_unstable();
    let mut rest: Vec<u32> = rel
        .available_releases
        .iter()
        .copied()
        .filter(|&v| v > required)
        .collect();
    rest.sort_unstable();

    let mut out = Vec::new();
    for v in lts.into_iter().chain([required]).chain(rest) {
        if !out.contains(&v) {
            out.push(v);
        }
    }
    out
}

/// Klasör adı için güvenli hale getirir ("jdk-25.0.4.1+1" olduğu gibi kalır).
fn dir_name(release_name: &str) -> String {
    let clean: String = release_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._+-".contains(c) {
                c
            } else {
                '-'
            }
        })
        .collect();
    format!("{clean}-jre")
}

pub struct Adoptium {
    http: reqwest::Client,
}

impl Adoptium {
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        Ok(self
            .http
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    async fn find(&self, required: u32) -> AppResult<Asset> {
        let (os, arch) = platform().ok_or_else(|| {
            AppError::msg(tx!(
                "Bu sistem için otomatik Java indirme desteklenmiyor",
                "Automatic Java download isn't supported on this system"
            ))
        })?;
        let rel: AvailableReleases = self.get(&format!("{API}/info/available_releases")).await?;
        for feature in feature_candidates(required, &rel) {
            let url = format!(
                "{API}/assets/latest/{feature}/hotspot?architecture={arch}&image_type=jre&os={os}&vendor=eclipse"
            );
            let assets: Vec<Asset> = self.get(&url).await?;
            if let Some(asset) = assets.into_iter().next() {
                return Ok(asset);
            }
        }
        Err(AppError::msg(tx!(
            "Java {required}+ için indirilebilir JRE bulunamadı",
            "No downloadable JRE found for Java {required}+"
        )))
    }

    /// İndirip açar; java çalıştırılabilirinin yolunu döner.
    pub async fn install(
        &self,
        required: u32,
        root: &Path,
        mut on_stage: impl FnMut(JavaStage) + Send,
    ) -> AppResult<PathBuf> {
        let asset = self.find(required).await?;
        let target = root.join(dir_name(&asset.release_name));
        if let Some(java) = java_in(&target) {
            return Ok(java);
        }

        let archive = root.join(".downloads").join(&asset.binary.package.name);
        download_file(
            &self.http,
            &asset.binary.package.link,
            &archive,
            Some((HashAlgo::Sha256, &asset.binary.package.checksum)),
            |downloaded, total| on_stage(JavaStage::Download { downloaded, total }),
        )
        .await?;

        on_stage(JavaStage::Extract);
        let tmp = root.join(format!(".tmp-{}", uuid::Uuid::new_v4()));
        let (a, t) = (archive.clone(), tmp.clone());
        let extracted = tokio::task::spawn_blocking(move || extract(&a, &t))
            .await
            .map_err(|e| AppError::msg(e.to_string()))?;
        let _ = tokio::fs::remove_file(&archive).await;
        let result = extracted.and_then(|_| {
            // Arşivler tek bir üst klasör içerir (jdk-25.0.4.1+1-jre/...).
            let home = single_child_dir(&tmp).unwrap_or_else(|| tmp.clone());
            if java_in(&home).is_none() {
                return Err(AppError::msg(tx!(
                    "İndirilen arşivde java bulunamadı",
                    "No java found in the downloaded archive"
                )));
            }
            std::fs::rename(&home, &target)?;
            java_in(&target)
                .ok_or_else(|| AppError::msg(tx!("Java kurulamadı", "Couldn't install Java")))
        });
        let _ = tokio::fs::remove_dir_all(&tmp).await;
        result
    }
}

fn single_child_dir(dir: &Path) -> Option<PathBuf> {
    let entries: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().collect();
    match entries.as_slice() {
        [only] if only.path().is_dir() => Some(only.path()),
        _ => None,
    }
}

/// `.zip` (Windows) veya `.tar.gz` (Linux/macOS) açar. Arşiv dışına yazan girdiler reddedilir.
fn extract(archive: &Path, dest: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest)?;
    let name = archive.to_string_lossy().to_ascii_lowercase();
    if name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(File::open(archive)?)
            .map_err(|e| AppError::msg(tx!("Zip açılamadı: {e}", "Couldn't open the zip: {e}")))?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| {
                AppError::msg(tx!("Zip okunamadı: {e}", "Couldn't read the zip: {e}"))
            })?;
            let Some(rel) = entry.enclosed_name() else {
                return Err(AppError::msg(tx!(
                    "Zip içinde geçersiz yol",
                    "Invalid path inside the zip"
                )));
            };
            let out = dest.join(rel);
            if entry.is_dir() {
                std::fs::create_dir_all(&out)?;
                continue;
            }
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            io::copy(&mut entry, &mut File::create(&out)?)?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode))?;
            }
        }
        Ok(())
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        let gz = flate2::read::GzDecoder::new(File::open(archive)?);
        // `unpack` `..` ve mutlak yolları zaten reddeder.
        tar::Archive::new(gz).unpack(dest)?;
        Ok(())
    } else {
        Err(AppError::msg(tx!(
            "Bilinmeyen arşiv türü",
            "Unknown archive type"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn chooses_feature_versions() {
        let rel = AvailableReleases {
            available_releases: vec![8, 11, 16, 17, 21, 25, 26, 27],
            available_lts_releases: vec![8, 11, 17, 21, 25],
        };
        assert_eq!(feature_candidates(25, &rel), [25, 26, 27]);
        assert_eq!(feature_candidates(16, &rel), [17, 21, 25, 16, 26, 27]);
        assert_eq!(feature_candidates(8, &rel)[0], 8);
        assert_eq!(feature_candidates(28, &rel), [28]);
    }

    #[test]
    fn parses_asset() {
        let a: Vec<Asset> = serde_json::from_str(
            r#"[{"binary":{"architecture":"x64","image_type":"jre","os":"windows",
                 "package":{"checksum":"4c95","link":"https://x/OpenJDK25U-jre.zip","name":"OpenJDK25U-jre.zip","size":58475080}},
                 "release_name":"jdk-25.0.4.1+1","vendor":"eclipse","version":{"major":25}}]"#,
        )
        .unwrap();
        assert_eq!(a[0].binary.package.checksum, "4c95");
        assert_eq!(dir_name(&a[0].release_name), "jdk-25.0.4.1+1-jre");
        assert_eq!(dir_name("a/b\\c"), "a-b-c-jre");
    }

    #[test]
    fn extracts_zip_and_rejects_traversal() {
        let base = std::env::temp_dir().join(format!("mcsm-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();

        let good = base.join("good.zip");
        let mut w = zip::ZipWriter::new(File::create(&good).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        w.start_file("jdk-x-jre/bin/java.exe", opts).unwrap();
        w.write_all(b"x").unwrap();
        w.finish().unwrap();
        extract(&good, &base.join("out")).unwrap();
        assert!(base.join("out/jdk-x-jre/bin/java.exe").is_file());
        assert_eq!(
            single_child_dir(&base.join("out")),
            Some(base.join("out/jdk-x-jre"))
        );

        let bad = base.join("bad.zip");
        let mut w = zip::ZipWriter::new(File::create(&bad).unwrap());
        w.start_file("../evil.txt", opts).unwrap();
        w.write_all(b"x").unwrap();
        w.finish().unwrap();
        assert!(extract(&bad, &base.join("out2")).is_err());
        assert!(!base.join("evil.txt").exists());
        let _ = std::fs::remove_dir_all(base);
    }

    /// Gerçek indirme: `cargo test -- --ignored live_install_jre --nocapture`
    #[tokio::test]
    #[ignore = "ağ erişimi gerekir"]
    async fn live_install_jre() {
        let root = crate::util::live_test_dir("java");
        let exe = Adoptium::new(reqwest::Client::new())
            .install(21, &root, |_| {})
            .await
            .unwrap();
        let info = super::super::probe(exe.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(info.major, 21);
        println!("{} -> {}", info.version, exe.display());
    }
}
