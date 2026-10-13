//! Modrinth mod paketleri (`.mrpack`): index okuma, dosyaların sunucu/oyuncu ayrımı, güvenli yollar
//! ve override klasörlerinin açılması. Ağ ve Tauri burada yok; komutlar `modpack_cmds`'te.
//!
//! Biçim: <https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack>

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::client::{ModEnv, mod_env};
use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;
use crate::modrinth::{Hashes, Side};

pub const INDEX_FILE: &str = "modrinth.index.json";
/// Zip bombasına karşı sınırlar.
const MAX_ENTRIES: usize = 20_000;
const MAX_INDEX: u64 = 16 * 1024 * 1024;
const MAX_ENTRY: u64 = 512 * 1024 * 1024;
const MAX_TOTAL: u64 = 4 * 1024 * 1024 * 1024;
/// Spesifikasyonun izin verdiği indirme adresleri.
const ALLOWED_HOSTS: [&str; 4] = [
    "cdn.modrinth.com",
    "github.com",
    "raw.githubusercontent.com",
    "gitlab.com",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    pub format_version: u32,
    pub game: String,
    pub name: String,
    #[serde(default)]
    pub files: Vec<PackFile>,
    #[serde(default)]
    pub dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Env {
    pub client: Side,
    pub server: Side,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    pub path: String,
    pub hashes: Hashes,
    #[serde(default)]
    pub env: Option<Env>,
    #[serde(default)]
    pub downloads: Vec<String>,
    #[serde(default)]
    pub file_size: u64,
}

impl PackFile {
    /// Dosyanın kendi adı (yolun son parçası).
    pub fn name(&self) -> &str {
        self.path.rsplit('/').next().unwrap_or(&self.path)
    }
}

fn bad_pack() -> AppError {
    AppError::msg(tx!(
        "Mod paketi okunamadı (bozuk ya da desteklenmeyen biçim).",
        "Couldn't read the modpack (broken or unsupported format)."
    ))
}

/// `.mrpack`'ten index'i okur ve biçimini doğrular.
pub fn read_index(mrpack: &Path) -> AppResult<Index> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(mrpack)?).map_err(|_| bad_pack())?;
    let entry = zip.by_name(INDEX_FILE).map_err(|_| bad_pack())?;
    let mut text = String::new();
    entry
        .take(MAX_INDEX)
        .read_to_string(&mut text)
        .map_err(|_| bad_pack())?;
    let index: Index = serde_json::from_str(&text).map_err(|_| bad_pack())?;
    if index.format_version != 1 || index.game != "minecraft" {
        return Err(bad_pack());
    }
    Ok(index)
}

/// Paketin istediği sunucu: altyapı, Minecraft ve altyapı sürümü.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub loader: LoaderKind,
    pub mc: String,
    pub loader_version: Option<String>,
}

fn unsupported(what: &str) -> AppError {
    AppError::msg(tx!(
        "Bu paket {what} istiyor; Cubby henüz desteklemiyor.",
        "This pack needs {what}; Cubby doesn't support it yet."
    ))
}

/// `dependencies` → kurulacak sunucu. Bilinmeyen altyapılar ve desteklenmeyen sürümler hata verir.
pub fn target(deps: &HashMap<String, String>) -> AppResult<Target> {
    let mc = deps.get("minecraft").cloned().ok_or_else(bad_pack)?;
    let mut found: Option<(LoaderKind, String)> = None;
    for (key, value) in deps {
        let kind = match key.as_str() {
            "minecraft" => continue,
            "fabric-loader" => LoaderKind::Fabric,
            "quilt-loader" => LoaderKind::Quilt,
            "neoforge" => LoaderKind::NeoForge,
            "forge" => LoaderKind::Forge,
            other => return Err(unsupported(other)),
        };
        if found.is_some() {
            return Err(bad_pack());
        }
        found = Some((kind, value.clone()));
    }
    let Some((loader, version)) = found else {
        return Ok(Target {
            loader: LoaderKind::Vanilla,
            mc,
            loader_version: None,
        });
    };
    check_supported(loader, &mc)?;
    Ok(Target {
        loader,
        mc,
        loader_version: Some(version),
    })
}

/// Cubby'nin kurabildiği altyapı + Minecraft eşleşmesi mi?
pub fn check_supported(loader: LoaderKind, mc: &str) -> AppResult<()> {
    match loader {
        LoaderKind::Forge if !crate::loaders::forge::mc_supported(mc) => {
            Err(unsupported(&format!("Forge {mc}")))
        }
        // 1.20.1'deki NeoForge, Forge'un eski bir kolu; ayrı bir kurulumu var.
        LoaderKind::NeoForge if mc == "1.20.1" => Err(unsupported(&format!("NeoForge {mc}"))),
        LoaderKind::Paper => Err(unsupported("Paper")),
        _ => Ok(()),
    }
}

/// Modrinth'teki sürüm yükleyicisi → altyapı (paket sürümlerini listelerken).
pub fn loader_of(loaders: &[String]) -> Option<LoaderKind> {
    let has = |l: &str| loaders.iter().any(|x| x == l);
    if has("neoforge") {
        Some(LoaderKind::NeoForge)
    } else if has("forge") {
        Some(LoaderKind::Forge)
    } else if has("quilt") {
        Some(LoaderKind::Quilt)
    } else if has("fabric") {
        Some(LoaderKind::Fabric)
    } else if loaders.is_empty() || has("minecraft") {
        Some(LoaderKind::Vanilla)
    } else {
        None
    }
}

/// Bir dosyanın gideceği yer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// Sunucu klasörüne (modlar ve ayarlar).
    Server,
    /// Yalnız oyuncuda çalışan mod: istemci eşitlemesinin ekstralarına.
    ClientMod,
    /// Oyuncunun oyun klasörüne (kaynak paketi, shader, ayar).
    ClientFile,
    Skip,
}

/// Sunucuya hiç gitmeyen, yalnız oyuncuya ait yollar.
fn client_only_path(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or("");
    matches!(
        first,
        "resourcepacks" | "shaderpacks" | "screenshots" | "saves"
    ) || matches!(
        rel,
        "options.txt" | "optionsof.txt" | "optionsshaders.txt" | "servers.dat"
    )
}

/// `mods/` altında doğrudan bir `.jar` mı?
pub fn is_mod_jar(rel: &str) -> bool {
    rel.strip_prefix("mods/")
        .is_some_and(|f| !f.contains('/') && f.to_ascii_lowercase().ends_with(".jar"))
}

pub fn place(f: &PackFile) -> Place {
    let (client, server) = f.env.map_or((true, true), |e| {
        (e.client != Side::Unsupported, e.server != Side::Unsupported)
    });
    let path = f.path.replace('\\', "/");
    if server && !client_only_path(&path) {
        Place::Server
    } else if !client {
        Place::Skip
    } else if is_mod_jar(&path) {
        Place::ClientMod
    } else {
        Place::ClientFile
    }
}

/// Paketteki göreli bir yol: kök, sürücü harfi, `..` ve boş parçalar reddedilir.
pub fn safe_rel_path(p: &str) -> Option<PathBuf> {
    let p = p.replace('\\', "/");
    if p.is_empty() || p.starts_with('/') || p.contains(':') || p.len() > 512 {
        return None;
    }
    let mut out = PathBuf::new();
    for part in p.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.chars().any(char::is_control) {
            return None;
        }
        out.push(part);
    }
    Some(out)
}

/// İndirme için izinli ilk adres (https ve spesifikasyondaki alan adları).
pub fn allowed_url(urls: &[String]) -> Option<&str> {
    urls.iter().map(String::as_str).find(|u| {
        reqwest::Url::parse(u).is_ok_and(|url| {
            url.scheme() == "https" && url.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h))
        })
    })
}

/// `https://cdn.modrinth.com/data/<proje>/versions/<sürüm>/<dosya>` → (proje, sürüm).
pub fn ids_from_url(url: &str) -> Option<(String, String)> {
    let url = reqwest::Url::parse(url).ok()?;
    if url.host_str() != Some("cdn.modrinth.com") {
        return None;
    }
    let mut parts = url.path_segments()?;
    match (parts.next()?, parts.next()?, parts.next()?, parts.next()?) {
        ("data", pid, "versions", vid) if !pid.is_empty() && !vid.is_empty() => {
            Some((pid.to_string(), vid.to_string()))
        }
        _ => None,
    }
}

/// Mod sayısına göre önerilen en yüksek bellek (MB).
pub fn recommended_ram(mods: usize) -> u32 {
    match mods {
        0..50 => 4096,
        50..150 => 6144,
        _ => 8192,
    }
}

/// Override'ların açılacağı yerler.
pub struct Targets<'a> {
    pub server: &'a Path,
    /// Oyuncunun oyun klasörüne kopyalanacak dosyalar (mods hariç).
    pub client: &'a Path,
    /// Yalnız oyuncuda çalışan modlar.
    pub client_mods: &'a Path,
}

/// `overrides/`, `server-overrides/` ve `client-overrides/` klasörlerini açar.
/// Sıra: önce `overrides`, sonra tarafa özel olan (aynı dosyayı o ezer).
/// `overrides/mods` içindeki yalnız istemci modları (jar'ın kendi tanımına göre) sunucuya konmaz.
/// Dönen: yalnız oyuncuda çalışan mod dosyalarının adları.
pub fn extract_overrides(mrpack: &Path, to: &Targets) -> AppResult<Vec<String>> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(mrpack)?).map_err(|_| bad_pack())?;
    if zip.len() > MAX_ENTRIES {
        return Err(bad_pack());
    }
    const ORDER: [&str; 3] = ["overrides/", "server-overrides/", "client-overrides/"];
    let mut entries: Vec<(usize, usize, String)> = (0..zip.len())
        .filter_map(|i| {
            let e = zip.by_index_raw(i).ok()?;
            if e.is_dir() {
                return None;
            }
            let name = e.enclosed_name()?.to_string_lossy().replace('\\', "/");
            let rank = ORDER.iter().position(|p| name.starts_with(p))?;
            Some((rank, i, name))
        })
        .collect();
    entries.sort();

    let mut total = 0u64;
    let mut client_mods: Vec<String> = Vec::new();
    for (rank, i, name) in entries {
        let rel = &name[ORDER[rank].len()..];
        let Some(rel_path) = safe_rel_path(rel) else {
            continue;
        };
        let mut entry = zip.by_index(i).map_err(|_| bad_pack())?;
        total += entry.size();
        if entry.size() > MAX_ENTRY || total > MAX_TOTAL {
            return Err(bad_pack());
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take(MAX_ENTRY)
            .read_to_end(&mut bytes)
            .map_err(|_| bad_pack())?;

        let to_server = rank != 2 && !client_only_path(rel);
        let to_client = rank != 1;
        if is_mod_jar(rel) {
            let file = rel_path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            if to_server {
                let dest = to.server.join(&rel_path);
                write(&dest, &bytes)?;
                if mod_env(&dest) == ModEnv::Client {
                    // Yalnız istemci modu: sunucudan alınıp oyuncuya gider.
                    std::fs::remove_file(&dest)?;
                    write(&to.client_mods.join(&file), &bytes)?;
                    client_mods.push(file);
                }
            } else if to_client {
                write(&to.client_mods.join(&file), &bytes)?;
                client_mods.push(file);
            }
            continue;
        }
        if to_server {
            write(&to.server.join(&rel_path), &bytes)?;
        }
        if to_client {
            write(&to.client.join(&rel_path), &bytes)?;
        }
    }
    client_mods.sort();
    client_mods.dedup();
    Ok(client_mods)
}

fn write(dest: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(dest, bytes)?;
    Ok(())
}

/// Paketin oyuncu dosyalarını (`pack-client` ağacı) oyun klasörüne kopyalar; var olan dosyalara
/// dokunmaz (oyuncunun kendi ayarları ezilmesin). `shared`: ortak `.minecraft` (TLauncher) —
/// orada yalnız kaynak paketleri ve shader'lar kopyalanır, ayarlar başka dünyaları bozmasın.
pub fn apply_client_tree(tree: &Path, game_dir: &Path, shared: bool) -> AppResult<usize> {
    fn walk(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let Ok(t) = e.file_type() else { continue };
            if t.is_dir() {
                walk(&e.path(), base, out);
            } else if t.is_file()
                && let Ok(rel) = e.path().strip_prefix(base)
            {
                out.push(rel.to_path_buf());
            }
        }
    }
    let mut files = Vec::new();
    walk(tree, tree, &mut files);
    let mut copied = 0;
    for rel in files {
        let first = rel
            .components()
            .next()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .unwrap_or_default();
        if shared && first != "resourcepacks" && first != "shaderpacks" {
            continue;
        }
        let dest = game_dir.join(&rel);
        if dest.exists() {
            continue;
        }
        if let Some(dir) = dest.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::copy(tree.join(&rel), &dest)?;
        copied += 1;
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn deps(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn targets_from_dependencies() {
        let t = target(&deps(&[
            ("minecraft", "1.21.1"),
            ("fabric-loader", "0.19.5"),
        ]))
        .unwrap();
        assert_eq!(t.loader, LoaderKind::Fabric);
        assert_eq!(t.mc, "1.21.1");
        assert_eq!(t.loader_version.as_deref(), Some("0.19.5"));
        assert_eq!(
            target(&deps(&[("minecraft", "1.20.1"), ("quilt-loader", "0.26")]))
                .unwrap()
                .loader,
            LoaderKind::Quilt
        );
        assert_eq!(
            target(&deps(&[("minecraft", "1.21.1"), ("neoforge", "21.1.77")]))
                .unwrap()
                .loader,
            LoaderKind::NeoForge
        );
        assert_eq!(
            target(&deps(&[("minecraft", "1.20.1"), ("forge", "47.2.0")]))
                .unwrap()
                .loader,
            LoaderKind::Forge
        );
        assert_eq!(
            target(&deps(&[("minecraft", "1.21.4")])).unwrap().loader,
            LoaderKind::Vanilla
        );
        // Eski Forge, 1.20.1 NeoForge, bilinmeyen altyapı, Minecraft'sız paket.
        assert!(target(&deps(&[("minecraft", "1.16.5"), ("forge", "36.2.39")])).is_err());
        assert!(target(&deps(&[("minecraft", "1.20.1"), ("neoforge", "47.1.106")])).is_err());
        assert!(target(&deps(&[("minecraft", "1.21.1"), ("liteloader", "1")])).is_err());
        assert!(target(&deps(&[("fabric-loader", "0.16")])).is_err());
        assert!(
            target(&deps(&[
                ("minecraft", "1.21.1"),
                ("fabric-loader", "0.16"),
                ("forge", "1")
            ]))
            .is_err()
        );
    }

    fn file(path: &str, client: Side, server: Side) -> PackFile {
        PackFile {
            path: path.into(),
            hashes: Hashes {
                sha1: String::new(),
                sha512: String::new(),
            },
            env: Some(Env { client, server }),
            downloads: Vec::new(),
            file_size: 0,
        }
    }

    #[test]
    fn places_files_by_env() {
        use Side::*;
        assert_eq!(
            place(&file("mods/a.jar", Required, Required)),
            Place::Server
        );
        assert_eq!(
            place(&file("mods/a.jar", Unsupported, Required)),
            Place::Server
        );
        assert_eq!(
            place(&file("mods/a.jar", Required, Unsupported)),
            Place::ClientMod
        );
        assert_eq!(
            place(&file("mods/a.jar", Optional, Unsupported)),
            Place::ClientMod
        );
        assert_eq!(
            place(&file("mods/a.jar", Unsupported, Unsupported)),
            Place::Skip
        );
        assert_eq!(
            place(&file("resourcepacks/x.zip", Required, Required)),
            Place::ClientFile
        );
        assert_eq!(
            place(&file("shaderpacks/x.zip", Required, Unsupported)),
            Place::ClientFile
        );
        assert_eq!(
            place(&file("config/x.toml", Required, Optional)),
            Place::Server
        );
        assert_eq!(
            place(&file("config/x.toml", Required, Unsupported)),
            Place::ClientFile
        );
        // env yoksa iki taraf da.
        let mut f = file("mods/a.jar", Required, Required);
        f.env = None;
        assert_eq!(place(&f), Place::Server);
    }

    #[test]
    fn rejects_unsafe_paths() {
        assert_eq!(
            safe_rel_path("mods/a.jar"),
            Some(PathBuf::from("mods").join("a.jar"))
        );
        assert!(safe_rel_path("config\\x.toml").is_some());
        for bad in [
            "",
            "../x",
            "mods/../../x",
            "/etc/passwd",
            "C:\\Windows\\x",
            "C:/x",
            "mods//a.jar",
            "./a",
            "a/\u{0}b",
        ] {
            assert!(safe_rel_path(bad).is_none(), "{bad:?} reddedilmeli");
        }
    }

    #[test]
    fn checks_download_hosts_and_ids() {
        let ok = "https://cdn.modrinth.com/data/DMu0oBKf/versions/U9eZqQPe/a.jar".to_string();
        assert_eq!(allowed_url(std::slice::from_ref(&ok)), Some(ok.as_str()));
        assert_eq!(
            allowed_url(&[
                "http://cdn.modrinth.com/x".into(),
                "https://evil.example/x".into(),
                "https://github.com/a/b/releases/x.jar".into()
            ]),
            Some("https://github.com/a/b/releases/x.jar")
        );
        assert_eq!(
            allowed_url(&["https://cdn.modrinth.com.evil.io/x".into()]),
            None
        );
        assert_eq!(
            ids_from_url(&ok),
            Some(("DMu0oBKf".to_string(), "U9eZqQPe".to_string()))
        );
        assert_eq!(ids_from_url("https://github.com/data/a/versions/b/x"), None);
        assert_eq!(ids_from_url("https://cdn.modrinth.com/other/a/b/c"), None);
    }

    #[test]
    fn recommends_ram_by_mod_count() {
        assert_eq!(recommended_ram(10), 4096);
        assert_eq!(recommended_ram(77), 6144);
        assert_eq!(recommended_ram(300), 8192);
    }

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mcsm-pack-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn jar(env: &str) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut zw = zip::ZipWriter::new(&mut buf);
        zw.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(format!(r#"{{"environment":"{env}"}}"#).as_bytes())
            .unwrap();
        zw.finish().unwrap();
        buf.into_inner()
    }

    #[test]
    fn reads_index_and_extracts_overrides() {
        let d = temp();
        let pack = d.join("p.mrpack");
        {
            let mut zw = zip::ZipWriter::new(std::fs::File::create(&pack).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            let mut add = |name: &str, bytes: &[u8]| {
                zw.start_file(name, opts).unwrap();
                zw.write_all(bytes).unwrap();
            };
            add(
                INDEX_FILE,
                br#"{"formatVersion":1,"game":"minecraft","name":"P","versionId":"1.0",
                    "files":[],"dependencies":{"minecraft":"1.21.1","fabric-loader":"0.19.5"}}"#,
            );
            add("overrides/config/a.toml", b"overrides");
            add("server-overrides/config/a.toml", b"server");
            add("client-overrides/config/a.toml", b"client");
            add("overrides/options.txt", b"opts");
            add("overrides/resourcepacks/r.zip", b"rp");
            add("overrides/mods/both.jar", &jar("*"));
            add("overrides/mods/client.jar", &jar("client"));
            add("client-overrides/mods/menu.jar", &jar("*"));
            add("overrides/../evil.txt", b"x");
            zw.finish().unwrap();
        }
        let index = read_index(&pack).unwrap();
        assert_eq!(index.name, "P");
        assert_eq!(
            target(&index.dependencies).unwrap().loader,
            LoaderKind::Fabric
        );

        let (server, client, mods) = (d.join("server"), d.join("client"), d.join("extras"));
        let got = extract_overrides(
            &pack,
            &Targets {
                server: &server,
                client: &client,
                client_mods: &mods,
            },
        )
        .unwrap();
        let read = |p: PathBuf| std::fs::read_to_string(p).unwrap();
        assert_eq!(read(server.join("config/a.toml")), "server");
        assert_eq!(read(client.join("config/a.toml")), "client");
        assert!(!server.join("options.txt").exists());
        assert!(!server.join("resourcepacks").exists());
        assert_eq!(read(client.join("options.txt")), "opts");
        assert!(client.join("resourcepacks/r.zip").is_file());
        assert!(server.join("mods/both.jar").is_file());
        assert!(!server.join("mods/client.jar").exists());
        assert!(!client.join("mods").exists());
        assert_eq!(got, vec!["client.jar".to_string(), "menu.jar".to_string()]);
        assert!(mods.join("client.jar").is_file() && mods.join("menu.jar").is_file());
        assert!(!d.join("evil.txt").exists());

        // Oyun klasörüne: var olan dosyaya dokunulmaz; ortak klasörde yalnız paketler.
        let game = d.join("game");
        std::fs::create_dir_all(game.join("config")).unwrap();
        std::fs::write(game.join("config/a.toml"), "mine").unwrap();
        assert_eq!(apply_client_tree(&client, &game, false).unwrap(), 2);
        assert_eq!(read(game.join("config/a.toml")), "mine");
        assert_eq!(read(game.join("options.txt")), "opts");
        let shared = d.join("shared");
        assert_eq!(apply_client_tree(&client, &shared, true).unwrap(), 1);
        assert!(shared.join("resourcepacks/r.zip").is_file());
        assert!(!shared.join("options.txt").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_other_games_and_formats() {
        let d = temp();
        let pack = d.join("p.mrpack");
        {
            let mut zw = zip::ZipWriter::new(std::fs::File::create(&pack).unwrap());
            zw.start_file(INDEX_FILE, zip::write::SimpleFileOptions::default())
                .unwrap();
            zw.write_all(br#"{"formatVersion":2,"game":"minecraft","name":"P"}"#)
                .unwrap();
            zw.finish().unwrap();
        }
        assert!(read_index(&pack).is_err());
        std::fs::write(&pack, b"not a zip").unwrap();
        assert!(read_index(&pack).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
