//! Katılımcının bilgisayarındaki Minecraft: açık mı, gereken sürüm kurulu mu.

use std::path::Path;

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::loaders::LoaderKind;

/// Minecraft istemcisi çalışıyor mu? (Açıkken servers.dat'ı kendi kopyasıyla ezer.)
pub fn minecraft_running() -> bool {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    sys.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        if !name.starts_with("java") {
            return false;
        }
        p.cmd().iter().any(|a| {
            let a = a.to_string_lossy();
            a.contains("net.minecraft.client")
                || a.contains("--gameDir")
                || a.contains("net.fabricmc.loader.impl.launch")
                || a.contains("org.quiltmc.loader.impl.launch")
                || a.contains("net.neoforged.fml")
                || a.contains("net.minecraftforge.bootstrap")
        })
    })
}

/// Oyuncunun bu dünyaya girebilmesi için launcher'da kurulu olması gereken sürüm klasörü.
pub fn required_version(loader: LoaderKind, mc: &str, loader_version: Option<&str>) -> String {
    loader_version
        .and_then(|lv| crate::client::version_id(loader, mc, lv))
        .unwrap_or_else(|| mc.to_string())
}

/// `.minecraft/versions/<sürüm>/<sürüm>.json` var mı? (Launcher sürümü bir kez açınca oluşur.)
pub fn version_installed(mc_dir: &Path, version: &str) -> bool {
    mc_dir
        .join("versions")
        .join(version)
        .join(format!("{version}.json"))
        .is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_versions() {
        assert_eq!(required_version(LoaderKind::Vanilla, "26.3", None), "26.3");
        assert_eq!(
            required_version(LoaderKind::Paper, "26.3", Some("169")),
            "26.3"
        );
        assert_eq!(
            required_version(LoaderKind::Fabric, "26.3", Some("0.19.5")),
            "fabric-loader-0.19.5-26.3"
        );
        assert_eq!(
            required_version(LoaderKind::Quilt, "26.3", Some("0.30.1")),
            "quilt-loader-0.30.1-26.3"
        );
        assert_eq!(
            required_version(LoaderKind::NeoForge, "26.3", Some("26.3.0.76")),
            "neoforge-26.3.0.76"
        );
        assert_eq!(
            required_version(LoaderKind::Forge, "26.3", Some("66.0.10")),
            "26.3-forge-66.0.10"
        );
    }

    #[test]
    fn detects_installed_version() {
        let dir = std::env::temp_dir().join(format!("mcsm-versions-{}", uuid::Uuid::new_v4()));
        assert!(!version_installed(&dir, "26.3"));
        std::fs::create_dir_all(dir.join("versions/26.3")).unwrap();
        std::fs::write(dir.join("versions/26.3/26.3.json"), "{}").unwrap();
        assert!(version_installed(&dir, "26.3"));
    }
}
