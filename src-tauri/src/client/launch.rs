//! Minecraft Launcher'ı açma. Launcher'da "Oyna"ya basmak oyuncuda kalır; dünyanın profili seçili
//! gelir ve (1.20+) oyun doğrudan dünyaya bağlanır.

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

use super::Launcher;

/// Microsoft Store'daki Java Launcher'ın paket ailesi ve uygulama kimliği.
#[cfg(windows)]
const STORE_FAMILY: &str = "Microsoft.4297127D64EC6_8wekyb3d8bbwe";
#[cfg(windows)]
const STORE_APP: &str = "Minecraft";

/// Launcher şu an açık mı? (Açıkken profil seçimini yeni dosyadan okumayabilir.)
pub fn launcher_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        // Store sürümü "Minecraft.exe", eski kurulum "MinecraftLauncher.exe".
        name == "minecraft.exe" || name == "minecraftlauncher.exe" || name == "minecraft-launcher"
    })
}

/// Resmi Launcher'ı açar (açıksa öne getirir). TLauncher'ın yeri belli olmadığı için açılmaz.
pub fn open_launcher(launcher: Launcher) -> bool {
    if launcher != Launcher::Official {
        return false;
    }
    open_official()
}

#[cfg(windows)]
fn open_official() -> bool {
    use std::process::Command;
    let local = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from);
    if local.is_some_and(|d| d.join("Packages").join(STORE_FAMILY).is_dir()) {
        return Command::new("explorer.exe")
            .arg(format!("shell:AppsFolder\\{STORE_FAMILY}!{STORE_APP}"))
            .spawn()
            .is_ok();
    }
    let candidates = ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|d| {
            std::path::PathBuf::from(d)
                .join("Minecraft Launcher")
                .join("MinecraftLauncher.exe")
        });
    for exe in candidates {
        if exe.is_file() {
            return Command::new(exe).spawn().is_ok();
        }
    }
    false
}

#[cfg(target_os = "macos")]
fn open_official() -> bool {
    std::process::Command::new("open")
        .args(["-a", "Minecraft"])
        .spawn()
        .is_ok()
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_official() -> bool {
    std::process::Command::new("minecraft-launcher")
        .spawn()
        .is_ok()
}
