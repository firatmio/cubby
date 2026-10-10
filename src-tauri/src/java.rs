//! M1: yalnızca JAVA_HOME ve PATH'teki java. M3'te tarama + Adoptium indirme eklenecek.

use std::path::PathBuf;
use std::process::Stdio;

use serde::Serialize;

use crate::util::hide_console;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInfo {
    pub path: String,
    pub major: u32,
    pub version: String,
}

const JAVA_EXE: &str = if cfg!(windows) { "java.exe" } else { "java" };

fn candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        out.push(PathBuf::from(home).join("bin").join(JAVA_EXE));
    }
    if let Some(path) = std::env::var_os("PATH") {
        out.extend(std::env::split_paths(&path).map(|p| p.join(JAVA_EXE)));
    }
    out.retain(|p| p.is_file());
    out.dedup();
    out
}

/// Bulunan ilk çalışan java.
pub async fn detect() -> Option<JavaInfo> {
    for path in candidates() {
        if let Some(info) = probe(&path.to_string_lossy()).await {
            return Some(info);
        }
    }
    None
}

/// `java -version` çıktısından sürümü okur (çıktı stderr'e yazılır).
pub async fn probe(path: &str) -> Option<JavaInfo> {
    let mut cmd = tokio::process::Command::new(path);
    cmd.arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    let out = cmd.output().await.ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stderr),
        String::from_utf8_lossy(&out.stdout)
    );
    let version = text.split('"').nth(1)?.to_string();
    Some(JavaInfo {
        path: path.to_string(),
        major: parse_major(&version)?,
        version,
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
    use super::parse_major;

    #[test]
    fn parses_java_versions() {
        assert_eq!(parse_major("1.8.0_392"), Some(8));
        assert_eq!(parse_major("21.0.2"), Some(21));
        assert_eq!(parse_major("27"), Some(27));
        assert_eq!(parse_major("25-ea"), Some(25));
        assert_eq!(parse_major(""), None);
    }
}
