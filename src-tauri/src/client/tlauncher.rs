//! TLauncher: Cubby onu bulup açar ve dünyanın sürümünü seçili getirir; oyuncu "Oyna"ya basar, oyun
//! (1.20+) ana menüye uğramadan dünyaya bağlanır. Seçili sürüm ve oyun klasörü TLauncher'ın kendi
//! ayar dosyasında (`%APPDATA%\.tlauncher\tlauncher-2.0.properties`, Java properties).

use std::path::{Path, PathBuf};

const PROPS_DIR: &str = ".tlauncher";
const PROPS_FILE: &str = "tlauncher-2.0.properties";
const KEY_VERSION: &str = "login.version.game";
const KEY_GAMEDIR: &str = "minecraft.gamedir";
const EXE: &str = "tlauncher.exe";

pub fn props_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(PROPS_DIR).join(PROPS_FILE))
}

/// TLauncher'ın oyun klasörü (ayarlardan değiştirildiyse).
pub fn game_dir(props: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(props).ok()?;
    prop_get(&text, KEY_GAMEDIR)
        .filter(|d| !d.trim().is_empty())
        .map(PathBuf::from)
        .filter(|d| d.is_dir())
}

/// TLauncher açıldığında bu sürüm seçili gelsin. TLauncher açıksa yazılmaz (kapanırken kendi
/// ayarlarını geri yazar); dönen: yazıldı mı.
pub fn select_version(props: &Path, id: &str) -> bool {
    let Ok(old) = std::fs::read_to_string(props) else {
        return false;
    };
    let new = prop_set(&old, KEY_VERSION, id);
    if new == old {
        return true;
    }
    let tmp = props.with_extension("cubby-tmp");
    std::fs::write(&tmp, new).is_ok() && std::fs::rename(&tmp, props).is_ok()
}

/// TLauncher açık mı: başlatıcı exe ya da onun açtığı Java süreci.
pub fn running() -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        if name == EXE {
            return true;
        }
        (name == "java.exe" || name == "javaw.exe")
            && p.cmd()
                .iter()
                .any(|a| a.to_string_lossy().to_ascii_lowercase().contains("tlauncher"))
            // TLauncher'ın açtığı oyunun kendisi de "tlauncher" içerebilir; oyun ayrı sayılır.
            && !p
                .cmd()
                .iter()
                .any(|a| a.to_string_lossy() == "net.minecraft.client.main.Main")
    })
}

/// TLauncher'ı açmanın yolu: exe ya da (yeri bilinmiyorsa) kısayolu.
pub fn find(exe_override: Option<&Path>) -> Option<PathBuf> {
    let env = |v: &str| std::env::var_os(v).map(PathBuf::from);
    exe_override
        .filter(|p| p.is_file())
        .map(Path::to_path_buf)
        .or_else(running_exe)
        .or_else(|| {
            env("APPDATA")
                .map(|a| a.join(".minecraft").join("TLauncher.exe"))
                .filter(|p| p.is_file())
        })
        .or_else(registry_exe)
        .or_else(|| {
            let mut dirs = Vec::new();
            if let Some(a) = env("APPDATA") {
                dirs.push(a.join(r"Microsoft\Windows\Start Menu\Programs"));
            }
            if let Some(p) = env("ProgramData") {
                dirs.push(p.join(r"Microsoft\Windows\Start Menu\Programs"));
            }
            if let Some(p) = env("PUBLIC") {
                dirs.push(p.join("Desktop"));
            }
            if let Some(h) = env("USERPROFILE") {
                dirs.push(h.join("Desktop"));
                dirs.push(h.join("OneDrive").join("Desktop"));
                dirs.push(h.join("OneDrive").join("Masaüstü"));
            }
            dirs.iter().find_map(|d| shortcut_in(d, 2))
        })
}

/// Klasörde (en çok `depth` alt seviye) adı "TLauncher" ile başlayan kısayol.
fn shortcut_in(dir: &Path, depth: u8) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        if path.is_dir() {
            subdirs.push(path);
        } else if is_tlauncher_link(&path) {
            return Some(path);
        }
    }
    if depth == 0 {
        return None;
    }
    subdirs.iter().find_map(|d| shortcut_in(d, depth - 1))
}

fn is_tlauncher_link(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    name.starts_with("tlauncher") && name.ends_with(".lnk")
}

fn running_exe() -> Option<PathBuf> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.processes().values().find_map(|p| {
        (p.name().to_string_lossy().to_ascii_lowercase() == EXE)
            .then(|| p.exe().map(Path::to_path_buf))
            .flatten()
            .filter(|e| e.is_file())
    })
}

#[cfg(windows)]
fn registry_exe() -> Option<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(UNINSTALL, KEY_READ) else {
            continue;
        };
        for key in root.enum_keys().flatten() {
            let Ok(k) = root.open_subkey_with_flags(&key, KEY_READ) else {
                continue;
            };
            let name: String = k.get_value("DisplayName").unwrap_or_default();
            if !key.to_ascii_lowercase().contains("tlauncher")
                && !name.to_ascii_lowercase().contains("tlauncher")
            {
                continue;
            }
            let dir: String = k.get_value("InstallLocation").unwrap_or_default();
            let exe = PathBuf::from(dir.trim_matches('"')).join("TLauncher.exe");
            if exe.is_file() {
                return Some(exe);
            }
            // Kaldırıcının simgesi çoğu zaman exe'nin kendisidir.
            let icon: String = k.get_value("DisplayIcon").unwrap_or_default();
            let icon = PathBuf::from(icon.split(',').next().unwrap_or("").trim_matches('"'));
            if icon
                .file_name()
                .is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case("tlauncher.exe"))
                && icon.is_file()
            {
                return Some(icon);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn registry_exe() -> Option<PathBuf> {
    None
}

/// TLauncher'ı açar: exe doğrudan, kısayol Windows Gezgini'yle.
pub fn open(path: &Path) -> bool {
    let is_link = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
    let mut cmd = if is_link {
        let mut c = std::process::Command::new("explorer.exe");
        c.arg(path);
        c
    } else {
        let mut c = std::process::Command::new(path);
        if let Some(dir) = path.parent() {
            c.current_dir(dir);
        }
        c
    };
    cmd.spawn().is_ok()
}

// ---- Java properties ----

fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if let Some(ch) = u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    out.push(ch);
                }
            }
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

fn escape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ':' => out.push_str("\\:"),
            '=' => out.push_str("\\="),
            c if (c as u32) > 0x7e => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Satırın anahtarı (kaçışlı ayırıcıları atlayarak) ve değerin başladığı yer.
fn split_line(line: &str) -> Option<(String, &str)> {
    let t = line.trim_start();
    if t.is_empty() || t.starts_with('#') || t.starts_with('!') {
        return None;
    }
    let bytes = t.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'=' | b':' => {
                return Some((unescape(t[..i].trim_end()), t[i + 1..].trim_start()));
            }
            _ => i += 1,
        }
    }
    None
}

fn prop_get(text: &str, key: &str) -> Option<String> {
    text.lines()
        .filter_map(split_line)
        .find(|(k, _)| k == key)
        .map(|(_, v)| unescape(v))
}

/// Anahtarı yazar (yoksa sona ekler); diğer satırlar ve yorumlar olduğu gibi kalır.
fn prop_set(text: &str, key: &str, value: &str) -> String {
    let line = format!("{key}={}", escape(value));
    let mut found = false;
    let mut lines: Vec<String> = text
        .lines()
        .map(|l| match split_line(l) {
            Some((k, _)) if k == key => {
                found = true;
                line.clone()
            }
            _ => l.to_string(),
        })
        .collect();
    if !found {
        lines.push(line);
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cubby-tl-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn reads_escaped_values() {
        let text = "#TLauncher 2.0\n#Sat Oct 18 19:00:00 TRT 2026\nminecraft.gamedir=C\\:\\\\Oyunlar\\\\mc\nlogin.version.game=Fabric 1.21.1\nname=\\u00C7a\\u011Fla\n";
        assert_eq!(
            prop_get(text, KEY_GAMEDIR).as_deref(),
            Some(r"C:\Oyunlar\mc")
        );
        assert_eq!(
            prop_get(text, KEY_VERSION).as_deref(),
            Some("Fabric 1.21.1")
        );
        assert_eq!(prop_get(text, "name").as_deref(), Some("Çağla"));
        assert_eq!(prop_get(text, "yok"), None);
    }

    #[test]
    fn sets_version_keeping_the_rest() {
        let text = "#TLauncher 2.0\nminecraft.gamedir=C\\:\\\\mc\nlogin.version.game=1.21.1\nminecraft.memory=4096\n";
        let set = prop_set(text, KEY_VERSION, "mcsm-modlu-dunya-8c86135a");
        assert!(set.starts_with("#TLauncher 2.0\nminecraft.gamedir=C\\:\\\\mc\n"));
        assert!(set.contains("login.version.game=mcsm-modlu-dunya-8c86135a\n"));
        assert!(set.contains("minecraft.memory=4096"));
        assert_eq!(
            prop_set(&set, KEY_VERSION, "mcsm-modlu-dunya-8c86135a"),
            set
        );
        // Anahtar yoksa eklenir; Türkçe karakter ve iki nokta kaçışlanır.
        let added = prop_set("#x\n", KEY_VERSION, "Dünya:1");
        assert!(
            added.ends_with("login.version.game=D\\u00FCnya\\:1\n"),
            "{added}"
        );
        assert_eq!(prop_get(&added, KEY_VERSION).as_deref(), Some("Dünya:1"));
    }

    #[test]
    fn select_and_game_dir_on_disk() {
        let d = tmp("props");
        let game = d.join("oyun klasoru");
        std::fs::create_dir_all(&game).unwrap();
        let props = d.join(PROPS_FILE);
        std::fs::write(
            &props,
            format!(
                "{KEY_GAMEDIR}={}\n{KEY_VERSION}=1.21.1\n",
                escape(&game.to_string_lossy())
            ),
        )
        .unwrap();
        assert_eq!(game_dir(&props), Some(game));
        assert!(select_version(&props, "mcsm-x"));
        assert_eq!(
            prop_get(&std::fs::read_to_string(&props).unwrap(), KEY_VERSION).as_deref(),
            Some("mcsm-x")
        );
        assert!(!select_version(&d.join("yok.properties"), "mcsm-x"));
        // Boş ya da olmayan klasör sayılmaz.
        std::fs::write(&props, format!("{KEY_GAMEDIR}=\n")).unwrap();
        assert_eq!(game_dir(&props), None);
    }

    /// Canlı: bu bilgisayardaki TLauncher (kuruluysa) bulunur ve oyun klasörü okunur.
    #[test]
    #[ignore]
    fn live_find_tlauncher() {
        let exe = find(None);
        let props = props_path().unwrap();
        eprintln!("exe: {exe:?}");
        eprintln!("ayar: {props:?} var: {}", props.is_file());
        eprintln!("oyun klasörü: {:?}", game_dir(&props));
        eprintln!("açık mı: {}", running());
        assert!(exe.is_some());
    }

    #[test]
    fn finds_shortcuts() {
        let d = tmp("lnk");
        std::fs::create_dir_all(d.join("TLauncher")).unwrap();
        std::fs::write(d.join("Başka.lnk"), b"").unwrap();
        assert_eq!(shortcut_in(&d, 1), None);
        std::fs::write(d.join("TLauncher").join("TLauncher.lnk"), b"").unwrap();
        assert_eq!(
            shortcut_in(&d, 1),
            Some(d.join("TLauncher").join("TLauncher.lnk"))
        );
        assert_eq!(shortcut_in(&d, 0), None);
        let exe = d.join("TLauncher.exe");
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(find(Some(&exe)), Some(exe));
    }
}
