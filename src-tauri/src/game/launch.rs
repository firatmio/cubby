//! Oyunun komut satırı: JVM ayarları, sürüm argümanları (yer tutucular doldurulur), başlangıç sınıfı.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use super::{Arg, Env, Merged, rules_allow};
use crate::error::AppResult;

/// Oyunu başlatan kişi ve yerler.
pub struct LaunchSpec<'a> {
    pub mc_dir: &'a Path,
    pub game_dir: &'a Path,
    pub natives_dir: &'a Path,
    pub classpath: &'a [PathBuf],
    pub player: &'a str,
    pub uuid: &'a str,
    pub xuid: &'a str,
    pub token: &'a str,
    pub max_ram_mb: u32,
}

fn sep() -> &'static str {
    if cfg!(windows) { ";" } else { ":" }
}

/// `${anahtar}` yer tutucularını doldurur; bilinmeyenler olduğu gibi kalır.
pub fn fill(s: &str, vars: &HashMap<&str, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                match vars.get(key) {
                    Some(v) => out.push_str(v),
                    None => out.push_str(&rest[start..start + 3 + end]),
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn expand(args: &[Arg], vars: &HashMap<&str, String>, env: Env) -> Vec<String> {
    args.iter()
        .flat_map(|a| match a {
            Arg::Plain(s) => vec![fill(s, vars)],
            Arg::Ruled { rules, values } if rules_allow(Some(rules), env) => {
                values.iter().map(|v| fill(v, vars)).collect()
            }
            Arg::Ruled { .. } => Vec::new(),
        })
        .collect()
}

/// Java'ya verilecek argümanlar (Java'nın kendisi hariç).
pub fn command_args(m: &Merged, spec: &LaunchSpec, env: Env) -> Vec<String> {
    let cp: Vec<String> = spec
        .classpath
        .iter()
        .map(|p| p.display().to_string())
        .collect();
    let path = |p: &Path| p.display().to_string();
    let vars: HashMap<&str, String> = HashMap::from([
        ("auth_player_name", spec.player.to_string()),
        ("auth_uuid", spec.uuid.replace('-', "")),
        ("auth_access_token", spec.token.to_string()),
        ("auth_session", spec.token.to_string()),
        ("auth_xuid", spec.xuid.to_string()),
        ("clientid", String::new()),
        ("user_type", "msa".to_string()),
        ("user_properties", "{}".to_string()),
        ("version_name", m.id.clone()),
        ("version_type", m.version_type.clone()),
        ("game_directory", path(spec.game_dir)),
        ("assets_root", path(&spec.mc_dir.join("assets"))),
        (
            "assets_index_name",
            m.asset_index
                .as_ref()
                .map(|a| a.id.clone())
                .unwrap_or_default(),
        ),
        ("natives_directory", path(spec.natives_dir)),
        ("library_directory", path(&spec.mc_dir.join("libraries"))),
        ("classpath_separator", sep().to_string()),
        ("classpath", cp.join(sep())),
        ("launcher_name", "mc-server-launcher".to_string()),
        ("launcher_version", env!("CARGO_PKG_VERSION").to_string()),
    ]);
    let mut args = vec![
        format!("-Xmx{}M", spec.max_ram_mb),
        format!("-Xms{}M", (spec.max_ram_mb / 4).max(512)),
    ];
    args.extend(expand(&m.jvm_args, &vars, env));
    if let Some((arg, file)) = &m.logging {
        let vars = HashMap::from([("path", path(&file.path))]);
        args.push(fill(arg, &vars));
    }
    args.push(m.main_class.clone());
    args.extend(expand(&m.game_args, &vars, env));
    args
}

/// Log'a ve hata mesajlarına yazarken oturum anahtarı gizlenir.
pub fn masked(args: &[String], token: &str) -> String {
    let joined = args.join(" ");
    if token.is_empty() {
        joined
    } else {
        joined.replace(token, "***")
    }
}

/// Eski sürümlerin native jar'larını açar (`META-INF` hariç); yeni sürümler gerek duymaz.
pub fn extract_natives(m: &Merged, natives_dir: &Path) -> AppResult<()> {
    let _ = std::fs::remove_dir_all(natives_dir);
    std::fs::create_dir_all(natives_dir)?;
    for lib in &m.libraries {
        let Some(n) = &lib.natives else { continue };
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&n.path)?)
            .map_err(|e| crate::error::AppError::msg(format!("{} açılamadı: {e}", lib.name)))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|e| crate::error::AppError::msg(e.to_string()))?;
            let Some(name) = entry.enclosed_name() else {
                continue;
            };
            if entry.is_dir() || name.starts_with("META-INF") {
                continue;
            }
            let dest = natives_dir.join(name);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf)?;
            std::fs::write(dest, buf)?;
        }
    }
    Ok(())
}

/// Windows'ta konsol penceresi açmayan `javaw.exe` (yanında varsa).
pub fn windowless_java(java: &Path) -> PathBuf {
    if cfg!(windows) {
        let w = java.with_file_name("javaw.exe");
        if w.is_file() {
            return w;
        }
    }
    java.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::AssetIndexRef;

    #[test]
    fn fills_placeholders() {
        let vars = HashMap::from([("a", "1".to_string()), ("b", "x y".to_string())]);
        assert_eq!(fill("${a}-${b}", &vars), "1-x y");
        assert_eq!(fill("${yok}", &vars), "${yok}");
        assert_eq!(fill("son ${a", &vars), "son ${a");
        assert_eq!(fill("düz", &vars), "düz");
    }

    #[test]
    fn builds_command_and_masks_token() {
        let m = Merged {
            id: "mcsm-test".into(),
            main_class: "net.minecraft.client.main.Main".into(),
            asset_index: Some(AssetIndexRef {
                id: "30".into(),
                ..Default::default()
            }),
            jvm_args: vec![Arg::Plain("-cp".into()), Arg::Plain("${classpath}".into())],
            game_args: vec![
                Arg::Plain("--accessToken".into()),
                Arg::Plain("${auth_access_token}".into()),
                Arg::Plain("--assetIndex".into()),
                Arg::Plain("${assets_index_name}".into()),
                Arg::Ruled {
                    rules: serde_json::json!([{"action": "allow", "features": {"is_demo_user": true}}]),
                    values: vec!["--demo".into()],
                },
                Arg::Plain("--quickPlayMultiplayer".into()),
                Arg::Plain("localhost:25565".into()),
            ],
            ..Default::default()
        };
        let cp = vec![PathBuf::from("a.jar"), PathBuf::from("b.jar")];
        let spec = LaunchSpec {
            mc_dir: Path::new("/mc"),
            game_dir: Path::new("/mc/mcsm/test"),
            natives_dir: Path::new("/mc/bin/x"),
            classpath: &cp,
            player: "firatmio",
            uuid: "1234-5678",
            xuid: "99",
            token: "GIZLI.TOKEN",
            max_ram_mb: 4096,
        };
        let env = Env {
            os: "windows",
            x64: true,
        };
        let args = command_args(&m, &spec, env);
        assert_eq!(args[0], "-Xmx4096M");
        assert!(args.contains(&format!("a.jar{}b.jar", sep())));
        assert!(args.contains(&"net.minecraft.client.main.Main".to_string()));
        assert!(args.contains(&"GIZLI.TOKEN".to_string()));
        assert!(!args.contains(&"--demo".to_string()));
        assert_eq!(args.last().unwrap(), "localhost:25565");
        let log = masked(&args, "GIZLI.TOKEN");
        assert!(!log.contains("GIZLI"));
        assert!(log.contains("--accessToken ***"));
    }
}
