//! Resmi installer'lar (NeoForge, Forge, Quilt): jar'ı hash doğrulamalı indirir, Java ile
//! çalıştırır, çıktısını satır satır ilerleme olarak verir. Sunucu kurulumu ve oyuncunun
//! Minecraft'ına istemci kurulumu aynı kodu kullanır.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::HashAlgo;
use crate::util::hide_console;

/// Takılan bir installer sonsuza dek beklenmesin (büyük paketler yavaş bağlantıda birkaç dakika sürer).
const TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// Arayüze en fazla bu sıklıkla satır gider (installer saniyede yüzlerce satır yazabiliyor).
const LINE_INTERVAL: Duration = Duration::from_millis(150);
/// Hata mesajında gösterilen son satır sayısı.
const TAIL: usize = 12;

/// Maven'deki dosyayı yanındaki `.sha256` (yoksa `.sha1`) ile doğrulayarak indirir.
pub async fn download_maven(
    http: &reqwest::Client,
    url: &str,
    dest: &Path,
    on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<()> {
    let mut expected = None;
    for (ext, algo) in [("sha256", HashAlgo::Sha256), ("sha1", HashAlgo::Sha1)] {
        let Ok(resp) = http.get(format!("{url}.{ext}")).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let text = resp.text().await?;
        // Bazı depolar "<hash>  <dosya>" yazıyor.
        let hash = text.split_whitespace().next().unwrap_or("").to_string();
        if !hash.is_empty() && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            expected = Some((algo, hash));
            break;
        }
    }
    let (algo, hash) = expected.ok_or_else(|| {
        AppError::msg(tx!(
            "Installer'ın doğrulama bilgisi bulunamadı.",
            "Couldn't find the installer's checksum."
        ))
    })?;
    download_file(http, url, dest, Some((algo, &hash)), on_progress).await
}

/// Installer jar'ındaki bir JSON dosyası (`install_profile.json`, `version.json`).
pub fn read_json(jar: &Path, name: &str) -> AppResult<serde_json::Value> {
    let read = || -> Option<serde_json::Value> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(jar).ok()?).ok()?;
        let entry = zip.by_name(name).ok()?;
        let mut text = String::new();
        entry
            .take(16 * 1024 * 1024)
            .read_to_string(&mut text)
            .ok()?;
        serde_json::from_str(&text).ok()
    };
    read().ok_or_else(|| {
        AppError::msg(tx!(
            "Installer okunamadı ({name}).",
            "Couldn't read the installer ({name})."
        ))
    })
}

/// Installer'ın kuracağı Launcher sürümünün adı (ör. `neoforge-26.3.0.76`).
pub fn version_id(jar: &Path) -> AppResult<String> {
    read_json(jar, "version.json")?
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| crate::util::is_safe_name(id))
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::msg(tx!(
                "Installer'da sürüm adı yok.",
                "The installer has no version name."
            ))
        })
}

/// Installer'ın sunucu için beklediği resmi Minecraft jar'ının yolu (sunucu klasörüne göre).
/// Önceden konursa installer onu (hash'i tutuyorsa) yeniden indirmez.
pub fn server_jar_path(jar: &Path, mc: &str) -> Option<String> {
    let profile = read_json(jar, "install_profile.json").ok()?;
    let raw = profile.get("serverJarPath")?.as_str()?;
    let path = raw
        .replace("{LIBRARY_DIR}", "libraries")
        .replace("{MINECRAFT_VERSION}", mc);
    (!path.contains('{') && !path.contains("..")).then_some(path)
}

/// `java -jar <jar> <args>`; `cwd` içinde çalışır. Çıkış kodu 0 değilse son satırlarla hata döner.
pub async fn run(
    java: &Path,
    jar: &Path,
    args: &[OsString],
    cwd: &Path,
    on_line: &mut (impl FnMut(String) + Send),
) -> AppResult<()> {
    let mut cmd = Command::new(java);
    cmd.arg("-jar")
        .arg(jar)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| {
        AppError::msg(tx!(
            "Installer başlatılamadı: {e}",
            "Couldn't start the installer: {e}"
        ))
    })?;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    for stream in [
        child
            .stdout
            .take()
            .map(|s| Box::new(s) as Box<dyn AsyncRead + Unpin + Send>),
        child
            .stderr
            .take()
            .map(|s| Box::new(s) as Box<dyn AsyncRead + Unpin + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stream).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);

    let mut tail: VecDeque<String> = VecDeque::with_capacity(TAIL);
    let mut last_sent = Instant::now() - LINE_INTERVAL;
    let collect = async {
        while let Some(line) = rx.recv().await {
            let line = line.trim_end().to_string();
            if line.is_empty() {
                continue;
            }
            if last_sent.elapsed() >= LINE_INTERVAL {
                last_sent = Instant::now();
                on_line(line.clone());
            }
            if tail.len() == TAIL {
                tail.pop_front();
            }
            tail.push_back(line);
        }
        child.wait().await
    };
    let status = match tokio::time::timeout(TIMEOUT, collect).await {
        Ok(status) => status?,
        Err(_) => {
            return Err(AppError::msg(tx!(
                "Installer çok uzun sürdü ve durduruldu. İnternet bağlantını kontrol edip tekrar dene.",
                "The installer took too long and was stopped. Check your internet connection and try again."
            )));
        }
    };
    if !status.success() {
        let last: Vec<String> = tail.into_iter().collect();
        return Err(AppError::msg(format!(
            "Installer hata verdi (kod {}):\n{}",
            status.code().unwrap_or(-1),
            last.join("\n")
        )));
    }
    Ok(())
}

/// NeoForge/Forge sunucu kurulumu: installer, önceden konan resmi Minecraft jar'ı (sha1
/// doğrulamalı) ve `--installServer`. `args_file` (sunucu klasörüne göre) kurulumdan sonra var
/// olmalı. Gereken Java major sürümünü döner.
pub async fn install_forge_like(
    http: &reqwest::Client,
    mojang: &super::mojang::MojangApi,
    req: &super::InstallRequest<'_>,
    url: &str,
    server_dir: &Path,
    args_file: &str,
    on_stage: &mut (impl FnMut(super::InstallStage) + Send),
) -> AppResult<u32> {
    use super::InstallStage;
    let java = req.java.ok_or_else(|| {
        AppError::msg(tx!(
            "Kurulum için Java gerekli.",
            "Java is required for the install."
        ))
    })?;
    tokio::fs::create_dir_all(server_dir).await?;
    let jar = server_dir.join("mcsm-installer.jar");
    download_maven(http, url, &jar, |downloaded, total| {
        on_stage(InstallStage::Download {
            file: "installer",
            downloaded,
            total,
        })
    })
    .await?;
    let java_major = match server_jar_path(&jar, req.mc_version) {
        Some(rel) => {
            mojang
                .install_server_jar(req.mc_version, &server_dir.join(rel), on_stage)
                .await?
        }
        None => mojang.java_major(req.mc_version).await?,
    };
    let result = run(
        java,
        &jar,
        &["--installServer".into(), server_dir.as_os_str().to_owned()],
        server_dir,
        &mut |line| on_stage(InstallStage::Installer { line }),
    )
    .await;
    cleanup(server_dir, &jar).await;
    result?;
    if !server_dir.join(args_file).is_file() {
        return Err(AppError::msg(tx!(
            "Kurulum bitti ama başlatma dosyası oluşmadı. Başka bir sürüm deneyebilirsin.",
            "The install finished but no launch file was created. You can try another version."
        )));
    }
    tokio::fs::create_dir_all(server_dir.join("mods")).await?;
    Ok(java_major)
}

/// Java'nın `@dosya` argümanı: Windows'ta `win_args.txt`, diğerlerinde `unix_args.txt`.
pub fn args_file_name() -> &'static str {
    if cfg!(windows) {
        "win_args.txt"
    } else {
        "unix_args.txt"
    }
}

/// Installer'ın arkasında bıraktığı jar ve log dosyaları.
pub async fn cleanup(dir: &Path, jar: &Path) {
    let _ = tokio::fs::remove_file(jar).await;
    let mut log = jar.as_os_str().to_owned();
    log.push(".log");
    let _ = tokio::fs::remove_file(log).await;
    let _ = tokio::fs::remove_file(dir.join("installer.log")).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar_with(dir: &Path, files: &[(&str, &str)]) -> std::path::PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join("installer.jar");
        let mut zw = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, body) in files {
            zw.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zw.write_all(body.as_bytes()).unwrap();
        }
        zw.finish().unwrap();
        path
    }

    #[test]
    fn reads_installer_metadata() {
        let dir = std::env::temp_dir().join(format!("mcsm-installer-{}", uuid::Uuid::new_v4()));
        let jar = jar_with(
            &dir,
            &[
                (
                    "version.json",
                    r#"{"id":"neoforge-26.3.0.76","inheritsFrom":"26.3"}"#,
                ),
                (
                    "install_profile.json",
                    r#"{"serverJarPath":"{LIBRARY_DIR}/net/minecraft/server/{MINECRAFT_VERSION}/server-{MINECRAFT_VERSION}.jar"}"#,
                ),
            ],
        );
        assert_eq!(version_id(&jar).unwrap(), "neoforge-26.3.0.76");
        assert_eq!(
            server_jar_path(&jar, "26.3").as_deref(),
            Some("libraries/net/minecraft/server/26.3/server-26.3.jar")
        );

        let bad = jar_with(&dir.join("bad"), &[("version.json", r#"{"id":"../evil"}"#)]);
        assert!(version_id(&bad).is_err());
        assert_eq!(server_jar_path(&bad, "26.3"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
