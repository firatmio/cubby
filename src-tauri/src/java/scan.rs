//! Sistemde java çalıştırılabilirlerini arar: JAVA_HOME, PATH, yaygın kurulum dizinleri,
//! Minecraft Launcher'ın kendi runtime'ları, Windows kayıt defteri ve bizim indirdiklerimiz.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

pub const JAVA_EXE: &str = if cfg!(windows) { "java.exe" } else { "java" };

/// `home` bir Java kurulumu ise içindeki java'yı döner (macOS paket yapısı dahil).
pub fn java_in(home: &Path) -> Option<PathBuf> {
    [
        home.join("bin").join(JAVA_EXE),
        home.join("Contents")
            .join("Home")
            .join("bin")
            .join(JAVA_EXE),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

fn children(root: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(root)
        .map(|it| {
            it.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default()
}

/// `root` altında `depth` seviyeye kadar Java kurulumu arar (Minecraft runtime klasörleri derin).
fn walk(root: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    if let Some(java) = java_in(root) {
        out.push(java);
        return;
    }
    if depth == 0 {
        return;
    }
    for child in children(root) {
        walk(&child, depth - 1, out);
    }
}

fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// Altındaki her klasörün bir Java kurulumu olabileceği kök dizinler.
fn install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        for pf in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
            .iter()
            .filter_map(|v| env_path(v))
        {
            for vendor in [
                "Java",
                "Eclipse Adoptium",
                "Eclipse Foundation",
                "AdoptOpenJDK",
                "Microsoft",
                "Zulu",
                "BellSoft",
                "Amazon Corretto",
                "Semeru",
            ] {
                roots.push(pf.join(vendor));
            }
        }
        if let Some(local) = env_path("LOCALAPPDATA") {
            roots.push(local.join("Programs").join("Eclipse Adoptium"));
        }
    } else if cfg!(target_os = "macos") {
        roots.push("/Library/Java/JavaVirtualMachines".into());
        if let Some(home) = env_path("HOME") {
            roots.push(home.join("Library/Java/JavaVirtualMachines"));
        }
    } else {
        roots.extend(["/usr/lib/jvm", "/usr/java", "/opt/java", "/opt/jdk"].map(PathBuf::from));
    }
    if let Some(home) = env_path(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        roots.push(home.join(".sdkman").join("candidates").join("java"));
        roots.push(home.join(".jdks")); // IntelliJ
    }
    roots
}

/// Minecraft Launcher'ın indirdiği Java'lar (`runtime/java-runtime-*/.../bin/java`).
fn minecraft_runtime_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        if let Some(local) = env_path("LOCALAPPDATA") {
            roots.push(
                local
                    .join("Packages")
                    .join("Microsoft.4297127D64EC6_8wekyb3d8bbwe")
                    .join("LocalCache")
                    .join("Local")
                    .join("runtime"),
            );
        }
        if let Some(pf) = env_path("ProgramFiles(x86)") {
            roots.push(pf.join("Minecraft Launcher").join("runtime"));
        }
        if let Some(appdata) = env_path("APPDATA") {
            roots.push(appdata.join(".minecraft").join("runtime"));
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = env_path("HOME") {
            roots.push(home.join("Library/Application Support/minecraft/runtime"));
        }
    } else if let Some(home) = env_path("HOME") {
        roots.push(home.join(".minecraft").join("runtime"));
    }
    roots
}

#[cfg(windows)]
fn registry_homes() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let mut out = Vec::new();
    // Oracle / OpenJDK kurulumları: <anahtar>\<sürüm>\JavaHome
    for base in [
        r"SOFTWARE\JavaSoft\JDK",
        r"SOFTWARE\JavaSoft\JRE",
        r"SOFTWARE\JavaSoft\Java Development Kit",
        r"SOFTWARE\JavaSoft\Java Runtime Environment",
    ] {
        let Ok(key) = hklm.open_subkey_with_flags(base, KEY_READ) else {
            continue;
        };
        for ver in key.enum_keys().flatten() {
            if let Ok(home) = key
                .open_subkey(&ver)
                .and_then(|k| k.get_value::<String, _>("JavaHome"))
            {
                out.push(PathBuf::from(home));
            }
        }
    }
    // Adoptium / Microsoft MSI: <anahtar>\<sürüm>\hotspot\MSI\Path
    for base in [
        r"SOFTWARE\Eclipse Adoptium\JDK",
        r"SOFTWARE\Eclipse Adoptium\JRE",
        r"SOFTWARE\Eclipse Foundation\JDK",
        r"SOFTWARE\Microsoft\JDK",
    ] {
        let Ok(key) = hklm.open_subkey_with_flags(base, KEY_READ) else {
            continue;
        };
        for ver in key.enum_keys().flatten() {
            if let Ok(home) = key
                .open_subkey(format!(r"{ver}\hotspot\MSI"))
                .and_then(|k| k.get_value::<String, _>("Path"))
            {
                out.push(PathBuf::from(home));
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn registry_homes() -> Vec<PathBuf> {
    Vec::new()
}

/// Bulunan tüm java yolları (henüz çalıştırılmamış, tekrarsız).
pub fn candidates(managed_root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();

    for home in children(managed_root) {
        walk(&home, 2, &mut found);
    }
    if let Some(home) = env_path("JAVA_HOME") {
        found.extend(java_in(&home));
    }
    if let Some(path) = std::env::var_os("PATH") {
        found.extend(
            std::env::split_paths(&path)
                .map(|p| p.join(JAVA_EXE))
                .filter(|p| p.is_file()),
        );
    }
    for home in registry_homes() {
        found.extend(java_in(&home));
    }
    for root in install_roots() {
        for home in children(&root) {
            found.extend(java_in(&home));
        }
    }
    for root in minecraft_runtime_roots() {
        walk(&root, 4, &mut found);
    }

    let mut seen = HashSet::new();
    found.retain(|p| {
        let key = std::fs::canonicalize(p).unwrap_or_else(|_| p.clone());
        seen.insert(key)
    });
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_java_in_layouts_and_dedupes() {
        let root = std::env::temp_dir().join(format!("mcsm-scan-{}", uuid::Uuid::new_v4()));
        let plain = root.join("jdk-25-jre").join("bin");
        let mac = root
            .join("mac-jre")
            .join("Contents")
            .join("Home")
            .join("bin");
        let deep = root.join("deep").join("a").join("b").join("bin");
        for d in [&plain, &mac, &deep] {
            std::fs::create_dir_all(d).unwrap();
            std::fs::write(d.join(JAVA_EXE), b"").unwrap();
        }

        assert!(java_in(&root.join("jdk-25-jre")).is_some());
        assert!(java_in(&root.join("mac-jre")).is_some());
        assert!(java_in(&root.join("deep")).is_none());

        let mut walked = Vec::new();
        walk(&root, 3, &mut walked);
        assert_eq!(walked.len(), 3);

        let all = candidates(&root);
        let ours: Vec<_> = all.iter().filter(|p| p.starts_with(&root)).collect();
        assert_eq!(ours.len(), 3, "{ours:?}");
        let _ = std::fs::remove_dir_all(root);
    }
}
