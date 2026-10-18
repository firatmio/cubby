//! Prism Launcher (ve PolyMC/PollyMC fork'ları): her dünyanın kendi örneği (instance) olur ve oyun
//! Prism'in kendi komutuyla (`--launch <örnek>`) doğrudan sunucuya bağlanarak açılır; oyuncu Prism'in
//! arayüzüne uğramaz. Minecraft'ı, mod altyapısını ve Java'yı Prism kendisi indirir; burada yalnız
//! örneğin ayarı (`instance.cfg`), bileşenleri (`mmc-pack.json`), modları ve sunucu listesi yazılır.
//! Hesap Prism'in kendi hesabıdır.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;

/// Bilinen dağıtımlar: (görünen ad, exe, ayar dosyası, veri klasörü adı).
const FLAVORS: &[(&str, &str, &str, &str)] = &[
    (
        "Prism Launcher",
        "prismlauncher.exe",
        "prismlauncher.cfg",
        "PrismLauncher",
    ),
    ("PolyMC", "polymc.exe", "polymc.cfg", "PolyMC"),
    ("PollyMC", "pollymc.exe", "pollymc.cfg", "PollyMC"),
];

/// Örnek klasörü adının öneki: `cubby-<dünya klasörü>`.
const PREFIX: &str = "cubby-";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrismInstall {
    /// Başlatmak için (bulunamadıysa örnek yine hazırlanır, oyuncu Prism'i kendi açar).
    pub exe: Option<PathBuf>,
    pub data_dir: PathBuf,
    pub instances: PathBuf,
    pub name: &'static str,
}

/// Prism'i bulur: ayardaki exe, çalışan süreç, kayıt defteri, bilinen kurulum yerleri; exe yoksa
/// yalnız veri klasörü (`%APPDATA%\PrismLauncher`).
pub fn find(exe_override: Option<&Path>) -> Option<PrismInstall> {
    let exe = exe_override
        .filter(|p| p.is_file())
        .map(Path::to_path_buf)
        .or_else(running_exe)
        .or_else(registry_exe)
        .or_else(known_exe);
    if let Some(exe) = exe {
        let flavor = flavor_of(&exe);
        let data_dir = data_dir_for(&exe, flavor.3)?;
        return Some(install(Some(exe), data_dir, flavor));
    }
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from)?;
    FLAVORS.iter().find_map(|f| {
        let dir = appdata.join(f.3);
        dir.join(f.2).is_file().then(|| install(None, dir, *f))
    })
}

fn install(
    exe: Option<PathBuf>,
    data_dir: PathBuf,
    flavor: (&'static str, &str, &str, &str),
) -> PrismInstall {
    let instances = instances_dir(&data_dir, flavor.2);
    PrismInstall {
        exe,
        data_dir,
        instances,
        name: flavor.0,
    }
}

fn flavor_of(exe: &Path) -> (&'static str, &'static str, &'static str, &'static str) {
    let file = exe
        .file_name()
        .map(|f| f.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    *FLAVORS.iter().find(|f| f.1 == file).unwrap_or(&FLAVORS[0])
}

/// Taşınabilir kurulum (`UserData/` ya da `portable.txt` exe'nin yanında) ya da `%APPDATA%\<ad>`.
fn data_dir_for(exe: &Path, folder: &str) -> Option<PathBuf> {
    let root = exe.parent()?;
    if root.join("UserData").is_dir() {
        return Some(root.join("UserData"));
    }
    if root.join("portable.txt").is_file() {
        return Some(root.to_path_buf());
    }
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(folder))
}

/// Ayar dosyasındaki `InstanceDir` (göreceli ise veri klasörüne göre), yoksa `instances`.
pub fn instances_dir(data_dir: &Path, cfg: &str) -> PathBuf {
    let dir = std::fs::read_to_string(data_dir.join(cfg))
        .ok()
        .and_then(|t| ini_get(&t, "InstanceDir"))
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| "instances".into());
    let p = PathBuf::from(dir);
    if p.is_absolute() { p } else { data_dir.join(p) }
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
        let name = p.name().to_string_lossy().to_ascii_lowercase();
        FLAVORS
            .iter()
            .any(|f| f.1 == name)
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
            let Some(flavor) = FLAVORS
                .iter()
                .find(|f| key.to_ascii_lowercase().contains(&f.3.to_ascii_lowercase()))
            else {
                continue;
            };
            let Ok(k) = root.open_subkey_with_flags(&key, KEY_READ) else {
                continue;
            };
            let dir: String = k.get_value("InstallLocation").unwrap_or_default();
            let exe = PathBuf::from(dir.trim_matches('"')).join(flavor.1);
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn registry_exe() -> Option<PathBuf> {
    None
}

fn known_exe() -> Option<PathBuf> {
    let env = |v: &str| std::env::var_os(v).map(PathBuf::from);
    let mut dirs = Vec::new();
    if let Some(l) = env("LOCALAPPDATA") {
        dirs.push(l.join("Programs"));
    }
    dirs.extend(env("ProgramFiles"));
    for base in dirs {
        for f in FLAVORS {
            let exe = base.join(f.3).join(f.1);
            if exe.is_file() {
                return Some(exe);
            }
        }
    }
    let scoop = env("USERPROFILE")?
        .join("scoop")
        .join("apps")
        .join("prismlauncher")
        .join("current")
        .join("prismlauncher.exe");
    scoop.is_file().then_some(scoop)
}

// ---- Örnek ----

/// Dünyanın örneğinin klasör adı (Prism'in örnek kimliği).
pub fn instance_id(dir: &str) -> String {
    format!("{PREFIX}{dir}")
}

/// Örneğin oyun klasörü: Prism yenilerde `minecraft`, eskilerde `.minecraft` kullanır.
pub fn game_dir(install: &PrismInstall, dir: &str) -> PathBuf {
    let root = install.instances.join(instance_id(dir));
    if root.join(".minecraft").is_dir() && !root.join("minecraft").is_dir() {
        root.join(".minecraft")
    } else {
        root.join("minecraft")
    }
}

pub struct InstanceSpec<'a> {
    /// Prism'de görünen ad (`<Dünya> · Cubby`).
    pub name: &'a str,
    pub kind: LoaderKind,
    pub mc_version: &'a str,
    pub loader_version: Option<&'a str>,
    /// Açılınca bağlanılacak sunucu.
    pub addr: Option<&'a str>,
    /// Sunucu simgesi (64×64 PNG); yoksa Prism'in hazır simgesi.
    pub icon_png: Option<Vec<u8>>,
}

/// Örneği hazırlar (varsa yalnız bizim ayarlarımızı günceller). Dönen: (oyun klasörü, örnek kimliği).
pub fn prepare(
    install: &PrismInstall,
    dir: &str,
    spec: &InstanceSpec,
) -> AppResult<(PathBuf, String)> {
    let id = instance_id(dir);
    if !crate::util::is_safe_name(&id) {
        return Err(AppError::msg(tx!(
            "Geçersiz örnek adı.",
            "Invalid instance name."
        )));
    }
    let root = install.instances.join(&id);
    let game = game_dir(install, dir);
    std::fs::create_dir_all(&game)?;

    let icon_key = match &spec.icon_png {
        Some(png) => {
            let icons = install.data_dir.join("icons");
            std::fs::create_dir_all(&icons)?;
            write_if_changed(&icons.join(format!("{id}.png")), png)?;
            id.clone()
        }
        None => "grass".to_string(),
    };
    let cfg_path = root.join("instance.cfg");
    let old = std::fs::read_to_string(&cfg_path).unwrap_or_default();
    let mut pairs: Vec<(&str, String)> = vec![
        ("InstanceType", "OneSix".into()),
        ("name", spec.name.to_string()),
        ("iconKey", icon_key),
    ];
    match spec.addr {
        Some(addr) => {
            pairs.push(("JoinServerOnLaunch", "true".into()));
            pairs.push(("JoinServerOnLaunchAddress", addr.to_string()));
        }
        None => pairs.push(("JoinServerOnLaunch", "false".into())),
    }
    if old.is_empty() {
        pairs.insert(0, ("ConfigVersion", "1.2".into()));
    }
    let cfg = ini_set(&old, &pairs);
    if cfg != old {
        write_if_changed(&cfg_path, cfg.as_bytes())?;
    }

    let pack_path = root.join("mmc-pack.json");
    let want = components(spec.kind, spec.mc_version, spec.loader_version);
    let current: Option<Value> = std::fs::read(&pack_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    // Prism kendi eklediklerini (bağımlılıklar, önbellek alanları) yazar; bizimkiler aynıysa dokunma.
    if current.as_ref().map(ours) != Some(want.clone()) {
        let pack = json!({
            "components": want
                .iter()
                .enumerate()
                .map(|(i, (uid, version))| {
                    let mut c = json!({ "uid": uid, "version": version });
                    if i == 0 {
                        c["important"] = json!(true);
                    }
                    c
                })
                .collect::<Vec<_>>(),
            "formatVersion": 1,
        });
        write_if_changed(&pack_path, &serde_json::to_vec_pretty(&pack)?)?;
    }
    Ok((game, id))
}

/// Dünya silindi ya da başka launcher'a geçildi: örnek kalır ama açılınca eski adrese bağlanmaz.
pub fn forget(install: &PrismInstall, dir: &str) {
    let path = install
        .instances
        .join(instance_id(dir))
        .join("instance.cfg");
    if let Ok(old) = std::fs::read_to_string(&path) {
        let new = ini_set(&old, &[("JoinServerOnLaunch", "false".into())]);
        if new != old {
            let _ = std::fs::write(&path, new);
        }
    }
}

/// Örneği Prism'in kendi komutuyla başlatır. Prism açıksa komut çalışan Prism'e iletilir.
pub fn launch(install: &PrismInstall, id: &str) -> bool {
    let Some(exe) = &install.exe else {
        return false;
    };
    std::process::Command::new(exe)
        .args(["--launch", id])
        .current_dir(exe.parent().unwrap_or(Path::new(".")))
        .spawn()
        .is_ok()
}

/// İstenen bileşenler: Minecraft ve mod altyapısı. Altyapının bağımlılıklarını (ör. Fabric'in
/// intermediary'si) Prism kendisi tamamlar; yeni sürümlerde gerekmeyebilir.
pub fn components(kind: LoaderKind, mc: &str, loader: Option<&str>) -> Vec<(String, String)> {
    let mut list = vec![("net.minecraft".to_string(), mc.to_string())];
    let uid = match kind {
        LoaderKind::Fabric => Some("net.fabricmc.fabric-loader"),
        LoaderKind::Quilt => Some("org.quiltmc.quilt-loader"),
        LoaderKind::NeoForge => Some("net.neoforged"),
        LoaderKind::Forge => Some("net.minecraftforge"),
        LoaderKind::Vanilla | LoaderKind::Paper => None,
    };
    if let (Some(uid), Some(v)) = (uid, loader) {
        list.push((uid.to_string(), v.to_string()));
    }
    list
}

/// `mmc-pack.json`'daki (yalnız bağımlılık olarak eklenmemiş) bileşenler.
fn ours(pack: &Value) -> Vec<(String, String)> {
    pack.get("components")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|c| {
                    !c.get("dependencyOnly")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|c| {
                    Some((
                        c.get("uid")?.as_str()?.to_string(),
                        c.get("version")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if std::fs::read(path).ok().as_deref() == Some(bytes) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("cubby-tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

// ---- Küçük INI ----

/// `[General]` bölümündeki (ya da bölümsüz) anahtarın değeri.
fn ini_get(text: &str, key: &str) -> Option<String> {
    let mut general = true;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            general = line.eq_ignore_ascii_case("[General]");
            continue;
        }
        if !general {
            continue;
        }
        if let Some((k, v)) = line.split_once('=')
            && k.trim() == key
        {
            return Some(v.trim().to_string());
        }
    }
    None
}

/// `[General]` bölümünde verilen anahtarları yazar; diğer satırlar (oyuncunun ayarları) olduğu gibi kalır.
fn ini_set(text: &str, pairs: &[(&str, String)]) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    if !lines
        .iter()
        .any(|l| l.trim().eq_ignore_ascii_case("[General]"))
    {
        lines.insert(0, "[General]".into());
    }
    let start = lines
        .iter()
        .position(|l| l.trim().eq_ignore_ascii_case("[General]"))
        .unwrap_or(0);
    let mut end = lines[start + 1..]
        .iter()
        .position(|l| l.trim().starts_with('['))
        .map(|i| start + 1 + i)
        .unwrap_or(lines.len());
    for (key, value) in pairs {
        let found = (start + 1..end).find(|&i| {
            lines[i]
                .split_once('=')
                .is_some_and(|(k, _)| k.trim() == *key)
        });
        match found {
            Some(i) => lines[i] = format!("{key}={value}"),
            None => {
                lines.insert(end, format!("{key}={value}"));
                end += 1;
            }
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cubby-prism-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn fake(dir: &Path) -> PrismInstall {
        PrismInstall {
            exe: None,
            data_dir: dir.to_path_buf(),
            instances: dir.join("instances"),
            name: "Prism Launcher",
        }
    }

    #[test]
    fn ini_keeps_player_settings() {
        let old = "[General]\nConfigVersion=1.2\nMaxMemAlloc=8192\nname=Eski\n";
        let new = ini_set(
            old,
            &[
                ("name", "Yeni".into()),
                ("JoinServerOnLaunch", "true".into()),
            ],
        );
        assert_eq!(ini_get(&new, "MaxMemAlloc").as_deref(), Some("8192"));
        assert_eq!(ini_get(&new, "name").as_deref(), Some("Yeni"));
        assert_eq!(ini_get(&new, "JoinServerOnLaunch").as_deref(), Some("true"));
        // Aynı değerler: değişiklik yok.
        assert_eq!(ini_set(&new, &[("name", "Yeni".into())]), new);
        // Başka bölümdeki aynı adlı anahtar karışmaz.
        let two = "[General]\nname=A\n[Other]\nname=B\n";
        let set = ini_set(two, &[("name", "C".into()), ("x", "1".into())]);
        assert!(
            set.contains("[General]\nname=C\nx=1\n[Other]\nname=B"),
            "{set}"
        );
        assert_eq!(ini_set("", &[("a", "1".into())]), "[General]\na=1\n");
    }

    #[test]
    fn instance_dir_from_config() {
        let d = tmp("cfg");
        assert_eq!(instances_dir(&d, "prismlauncher.cfg"), d.join("instances"));
        std::fs::write(
            d.join("prismlauncher.cfg"),
            "[General]\nInstanceDir=oyunlar\n",
        )
        .unwrap();
        assert_eq!(instances_dir(&d, "prismlauncher.cfg"), d.join("oyunlar"));
        let abs = tmp("abs");
        std::fs::write(
            d.join("prismlauncher.cfg"),
            format!("InstanceDir={}\n", abs.display()),
        )
        .unwrap();
        assert_eq!(instances_dir(&d, "prismlauncher.cfg"), abs);
    }

    #[test]
    fn portable_data_dir() {
        let d = tmp("portable");
        let exe = d.join("prismlauncher.exe");
        std::fs::write(&exe, b"").unwrap();
        std::fs::write(d.join("portable.txt"), b"").unwrap();
        assert_eq!(data_dir_for(&exe, "PrismLauncher"), Some(d.clone()));
        std::fs::create_dir_all(d.join("UserData")).unwrap();
        assert_eq!(
            data_dir_for(&exe, "PrismLauncher"),
            Some(d.join("UserData"))
        );
        let found = find(Some(&exe)).unwrap();
        assert_eq!(found.exe.as_deref(), Some(exe.as_path()));
        assert_eq!(found.instances, d.join("UserData").join("instances"));
        assert_eq!(flavor_of(&d.join("PollyMC.exe")).0, "PollyMC");
    }

    #[test]
    fn components_per_loader() {
        assert_eq!(
            components(LoaderKind::Vanilla, "26.3", Some("x")),
            vec![("net.minecraft".to_string(), "26.3".to_string())]
        );
        let fabric = components(LoaderKind::Fabric, "1.21.1", Some("0.16.5"));
        assert_eq!(
            fabric[1],
            ("net.fabricmc.fabric-loader".into(), "0.16.5".into())
        );
        assert_eq!(
            components(LoaderKind::NeoForge, "1.21.1", Some("21.1.77"))[1].0,
            "net.neoforged"
        );
        assert_eq!(
            components(LoaderKind::Forge, "1.20.1", Some("47.3.0"))[1].0,
            "net.minecraftforge"
        );
        assert_eq!(
            components(LoaderKind::Quilt, "1.21.1", Some("0.27.1"))[1].0,
            "org.quiltmc.quilt-loader"
        );
    }

    #[test]
    fn prepares_and_updates_instance() {
        let d = tmp("inst");
        let p = fake(&d);
        let spec = InstanceSpec {
            name: "Modlu dünya · Cubby",
            kind: LoaderKind::Fabric,
            mc_version: "1.21.1",
            loader_version: Some("0.16.5"),
            addr: Some("127.0.0.1:25600"),
            icon_png: Some(vec![0x89, b'P', b'N', b'G']),
        };
        let (game, id) = prepare(&p, "modlu-dunya-1234", &spec).unwrap();
        assert_eq!(id, "cubby-modlu-dunya-1234");
        assert_eq!(game, d.join("instances").join(&id).join("minecraft"));
        assert!(game.is_dir());
        assert!(d.join("icons").join(format!("{id}.png")).is_file());
        let cfg =
            std::fs::read_to_string(d.join("instances").join(&id).join("instance.cfg")).unwrap();
        assert_eq!(
            ini_get(&cfg, "JoinServerOnLaunchAddress").as_deref(),
            Some("127.0.0.1:25600")
        );
        assert_eq!(ini_get(&cfg, "iconKey").as_deref(), Some(id.as_str()));

        // Prism'in kendi eklediği bağımlılık ve oyuncunun belleği korunur.
        let pack_path = d.join("instances").join(&id).join("mmc-pack.json");
        let mut pack: Value = serde_json::from_slice(&std::fs::read(&pack_path).unwrap()).unwrap();
        pack["components"]
            .as_array_mut()
            .unwrap()
            .insert(1, json!({"uid": "net.fabricmc.intermediary", "version": "1.21.1", "dependencyOnly": true}));
        std::fs::write(&pack_path, serde_json::to_vec(&pack).unwrap()).unwrap();
        let cfg_path = d.join("instances").join(&id).join("instance.cfg");
        std::fs::write(&cfg_path, format!("{cfg}MaxMemAlloc=6144\n")).unwrap();
        prepare(&p, "modlu-dunya-1234", &spec).unwrap();
        let again: Value = serde_json::from_slice(&std::fs::read(&pack_path).unwrap()).unwrap();
        assert_eq!(
            again["components"].as_array().unwrap().len(),
            3,
            "aynıysa dokunulmaz"
        );
        assert!(
            std::fs::read_to_string(&cfg_path)
                .unwrap()
                .contains("MaxMemAlloc=6144")
        );

        // Altyapı sürümü değişince bileşenler yeniden yazılır.
        let newer = InstanceSpec {
            loader_version: Some("0.17.0"),
            icon_png: None,
            ..spec
        };
        prepare(&p, "modlu-dunya-1234", &newer).unwrap();
        let rewritten: Value = serde_json::from_slice(&std::fs::read(&pack_path).unwrap()).unwrap();
        assert_eq!(ours(&rewritten)[1].1, "0.17.0");
        assert_eq!(
            ini_get(&std::fs::read_to_string(&cfg_path).unwrap(), "iconKey").as_deref(),
            Some("grass")
        );

        forget(&p, "modlu-dunya-1234");
        let cfg = std::fs::read_to_string(&cfg_path).unwrap();
        assert_eq!(
            ini_get(&cfg, "JoinServerOnLaunch").as_deref(),
            Some("false")
        );
        assert!(cfg.contains("MaxMemAlloc=6144"));
    }

    #[test]
    fn old_style_game_dir() {
        let d = tmp("old");
        let p = fake(&d);
        std::fs::create_dir_all(d.join("instances").join("cubby-x").join(".minecraft")).unwrap();
        assert_eq!(
            game_dir(&p, "x"),
            d.join("instances").join("cubby-x").join(".minecraft")
        );
    }
}
