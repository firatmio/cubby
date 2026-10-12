//! Oyunu Launcher'sız başlatma: Launcher'ın `versions/<id>/<id>.json` dosyaları okunur, `inheritsFrom`
//! zinciri birleştirilir, eksik dosyalar (istemci jar'ı, kütüphaneler, asset'ler, log ayarı)
//! hash doğrulamalı indirilir ve oyun Quick Play ile doğrudan dünyaya bağlanacak şekilde açılır.
//! Dosyalar oyuncunun `.minecraft`'ıyla paylaşılır (hash'le adreslenir; Launcher'la çakışmaz).

pub mod assets;
pub mod launch;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::error::{AppError, AppResult};

/// Asset nesnelerinin indirildiği adres.
pub const RESOURCES: &str = "https://resources.download.minecraft.net";

/// İndirilecek (ya da var olması gereken) bir dosya.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSpec {
    pub path: PathBuf,
    pub url: String,
    /// `None`: Maven'deki `.sha1`/`.sha256` dosyasıyla doğrulanır.
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

impl FileSpec {
    /// Var ve boyutu tutuyorsa yeniden indirilmez (her açılışta binlerce dosyanın hash'i hesaplanmasın).
    pub fn present(&self) -> bool {
        match (std::fs::metadata(&self.path), self.size) {
            (Ok(m), Some(size)) => m.is_file() && m.len() == size,
            (Ok(m), None) => m.is_file() && m.len() > 0,
            _ => false,
        }
    }
}

/// Bir argüman: düz metin ya da kurallara bağlı bir veya birkaç değer.
#[derive(Debug, Clone, PartialEq)]
pub enum Arg {
    Plain(String),
    Ruled { rules: Value, values: Vec<String> },
}

#[derive(Debug, Clone, Default)]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct Library {
    /// `group:artifact:version[:classifier][@ext]`
    pub name: String,
    pub artifact: Option<FileSpec>,
    /// Eski sürümlerde açılması gereken native jar'ı.
    pub natives: Option<FileSpec>,
}

/// `inheritsFrom` zinciri birleştirilmiş sürüm.
#[derive(Debug, Clone, Default)]
pub struct Merged {
    /// En üstteki sürüm (ör. `mcsm-test-…`).
    pub id: String,
    pub main_class: String,
    pub asset_index: Option<AssetIndexRef>,
    pub java_major: Option<u32>,
    /// Oyunun kendi jar'ı (zincirde `downloads.client` olan sürüm).
    pub client_jar: Option<FileSpec>,
    pub libraries: Vec<Library>,
    pub jvm_args: Vec<Arg>,
    pub game_args: Vec<Arg>,
    /// `-Dlog4j.configurationFile=${path}` ve dosyası.
    pub logging: Option<(String, FileSpec)>,
    pub version_type: String,
}

/// Kuralların değerlendirildiği ortam.
#[derive(Debug, Clone, Copy)]
pub struct Env {
    pub os: &'static str,
    /// 64 bit mi (kurallardaki `arch: x86` 32 biti anlatır).
    pub x64: bool,
}

impl Env {
    pub fn current() -> Self {
        Self {
            os: if cfg!(windows) {
                "windows"
            } else if cfg!(target_os = "macos") {
                "osx"
            } else {
                "linux"
            },
            x64: cfg!(target_pointer_width = "64"),
        }
    }
}

/// Launcher kuralları: kural yoksa izinli; varsa eşleşen son kural karar verir.
/// Hiçbir özellik (`features`) açık değil: Quick Play'i kendi sürümümüz düz argümanla veriyor.
pub fn rules_allow(rules: Option<&Value>, env: Env) -> bool {
    let Some(rules) = rules.and_then(Value::as_array) else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let mut matches = true;
        if let Some(os) = rule.get("os") {
            if let Some(name) = os.get("name").and_then(Value::as_str) {
                matches &= name == env.os;
            }
            if let Some(arch) = os.get("arch").and_then(Value::as_str) {
                matches &= match arch {
                    "x86" => !env.x64,
                    "x86_64" | "amd64" => env.x64,
                    _ => false,
                };
            }
        }
        if let Some(features) = rule.get("features").and_then(Value::as_object) {
            // İstenen özelliklerin hepsi "açık" olmalı; bizde hiçbiri açık değil.
            matches &= features.values().all(|v| v.as_bool() == Some(false));
        }
        if matches {
            allowed = rule.get("action").and_then(Value::as_str) == Some("allow");
        }
    }
    allowed
}

/// `group:artifact:version[:classifier][@ext]` → Maven yolu.
pub fn maven_path(name: &str) -> Option<String> {
    let (coords, ext) = match name.split_once('@') {
        Some((c, e)) => (c, e),
        None => (name, "jar"),
    };
    let parts: Vec<&str> = coords.split(':').collect();
    let (group, artifact, version, classifier) = match parts.as_slice() {
        [g, a, v] => (*g, *a, *v, None),
        [g, a, v, c] => (*g, *a, *v, Some(*c)),
        _ => return None,
    };
    let safe = |s: &str| !s.is_empty() && !s.contains("..") && !s.contains(['/', '\\']);
    if ![group, artifact, version, ext].into_iter().all(safe)
        || classifier.is_some_and(|c| !safe(c))
    {
        return None;
    }
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    Some(format!(
        "{}/{artifact}/{version}/{file}",
        group.replace('.', "/")
    ))
}

/// `group:artifact[:classifier]`: aynı kütüphanenin iki sürümü varsa üstteki (mod altyapısı) kazanır.
fn library_key(name: &str) -> String {
    let coords = name.split('@').next().unwrap_or(name);
    let parts: Vec<&str> = coords.split(':').collect();
    match parts.as_slice() {
        [g, a, _, c, ..] => format!("{g}:{a}:{c}"),
        [g, a, ..] => format!("{g}:{a}"),
        _ => coords.to_string(),
    }
}

fn download_spec(d: &Value, path: PathBuf) -> Option<FileSpec> {
    Some(FileSpec {
        path,
        url: d.get("url")?.as_str()?.to_string(),
        sha1: d.get("sha1").and_then(Value::as_str).map(str::to_string),
        size: d.get("size").and_then(Value::as_u64),
    })
}

fn parse_library(lib: &Value, libs_dir: &Path, env: Env) -> Option<Library> {
    if !rules_allow(lib.get("rules"), env) {
        return None;
    }
    let name = lib.get("name")?.as_str()?.to_string();
    let rel = maven_path(&name)?;
    let downloads = lib.get("downloads");
    let artifact = match downloads.and_then(|d| d.get("artifact")) {
        Some(a) => {
            let path = a
                .get("path")
                .and_then(Value::as_str)
                .filter(|p| !p.contains(".."))
                .map(str::to_string)
                .unwrap_or_else(|| rel.clone());
            // Bazı kütüphanelerin adresi boş: dosyayı installer üretmiş (NeoForge/Forge), indirilmez.
            Some(FileSpec {
                path: libs_dir.join(path),
                url: a
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                sha1: a.get("sha1").and_then(Value::as_str).map(str::to_string),
                size: a.get("size").and_then(Value::as_u64),
            })
        }
        // Fabric/Quilt biçimi: yalnız `name` + Maven deposu `url`.
        None if downloads.is_none() => {
            let base = lib
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("https://libraries.minecraft.net/");
            let base = if base.ends_with('/') {
                base.to_string()
            } else {
                format!("{base}/")
            };
            Some(FileSpec {
                path: libs_dir.join(&rel),
                url: format!("{base}{rel}"),
                sha1: lib.get("sha1").and_then(Value::as_str).map(str::to_string),
                size: lib.get("size").and_then(Value::as_u64),
            })
        }
        None => None,
    };
    // Eski sürümler: `natives: {windows: "natives-windows-${arch}"}` ve `classifiers`.
    let natives = lib
        .get("natives")
        .and_then(|n| n.get(env.os))
        .and_then(Value::as_str)
        .map(|c| c.replace("${arch}", if env.x64 { "64" } else { "32" }))
        .and_then(|classifier| {
            let d = downloads?.get("classifiers")?.get(&classifier)?;
            let path = d.get("path")?.as_str()?.to_string();
            download_spec(d, libs_dir.join(path))
        });
    Some(Library {
        name,
        artifact,
        natives,
    })
}

fn parse_args(list: Option<&Value>) -> Vec<Arg> {
    list.and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|a| match a {
                    Value::String(s) => Some(Arg::Plain(s.clone())),
                    Value::Object(o) => {
                        let values = match o.get("value")? {
                            Value::String(s) => vec![s.clone()],
                            Value::Array(v) => v
                                .iter()
                                .filter_map(|x| x.as_str().map(str::to_string))
                                .collect(),
                            _ => return None,
                        };
                        Some(Arg::Ruled {
                            rules: o.get("rules").cloned().unwrap_or(Value::Null),
                            values,
                        })
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Sürüm JSON'ları alttan üste (vanilla → mod altyapısı → bizim sarmalayıcı) verilir.
pub fn merge(chain: &[Value], mc_dir: &Path, env: Env) -> AppResult<Merged> {
    let top = chain
        .last()
        .ok_or_else(|| AppError::msg("Sürüm bilgisi boş."))?;
    let libs_dir = mc_dir.join("libraries");
    let mut m = Merged {
        id: top
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        ..Default::default()
    };
    // Kütüphaneler: üstteki önce (aynı kütüphanenin mod altyapısının istediği sürümü kalsın).
    let mut seen = HashSet::new();
    for v in chain.iter().rev() {
        for lib in v
            .get("libraries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(l) = parse_library(lib, &libs_dir, env)
                && seen.insert(library_key(&l.name))
            {
                m.libraries.push(l);
            }
        }
    }
    for v in chain {
        if let Some(main) = v.get("mainClass").and_then(Value::as_str) {
            m.main_class = main.to_string();
        }
        if let Some(t) = v.get("type").and_then(Value::as_str) {
            m.version_type = t.to_string();
        }
        if let Some(a) = v.get("assetIndex") {
            m.asset_index = Some(AssetIndexRef {
                id: a
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                sha1: a
                    .get("sha1")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                size: a.get("size").and_then(Value::as_u64),
                url: a
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
            });
        }
        if let Some(j) = v
            .pointer("/javaVersion/majorVersion")
            .and_then(Value::as_u64)
        {
            m.java_major = Some(j as u32);
        }
        if let Some(client) = v.pointer("/downloads/client") {
            let id = v.get("id").and_then(Value::as_str).unwrap_or_default();
            if crate::util::is_safe_name(id) {
                m.client_jar = download_spec(
                    client,
                    mc_dir.join("versions").join(id).join(format!("{id}.jar")),
                );
            }
        }
        if let Some(log) = v.pointer("/logging/client")
            && let (Some(arg), Some(file)) =
                (log.get("argument").and_then(Value::as_str), log.get("file"))
            && let Some(id) = file
                .get("id")
                .and_then(Value::as_str)
                .filter(|i| crate::util::is_safe_name(i))
        {
            let path = mc_dir.join("assets").join("log_configs").join(id);
            if let Some(spec) = download_spec(file, path) {
                m.logging = Some((arg.to_string(), spec));
            }
        }
        m.jvm_args.extend(parse_args(v.pointer("/arguments/jvm")));
        m.game_args.extend(parse_args(v.pointer("/arguments/game")));
    }
    if m.main_class.is_empty() {
        return Err(AppError::msg("Sürümün başlangıç sınıfı yok."));
    }
    if m.asset_index.is_none() {
        return Err(AppError::msg("Sürümün asset bilgisi yok."));
    }
    Ok(m)
}

/// `versions/<id>/<id>.json`'dan başlayıp `inheritsFrom` ile aşağı iner; alttan üste döner.
/// Eksik vanilla JSON'u `fetch_vanilla` ile (Mojang, sha1 doğrulamalı) alınır.
pub async fn load_chain<F, Fut>(
    mc_dir: &Path,
    id: &str,
    mut fetch_vanilla: F,
) -> AppResult<Vec<Value>>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = AppResult<Vec<u8>>>,
{
    let mut chain = Vec::new();
    let mut next = Some(id.to_string());
    while let Some(id) = next.take() {
        if chain.len() > 8 || !crate::util::is_safe_name(&id) {
            return Err(AppError::msg("Sürüm zinciri bozuk."));
        }
        let file = mc_dir.join("versions").join(&id).join(format!("{id}.json"));
        let bytes = match std::fs::read(&file) {
            Ok(b) => b,
            Err(_) => {
                let b = fetch_vanilla(id.clone()).await?;
                std::fs::create_dir_all(file.parent().unwrap_or(mc_dir))?;
                std::fs::write(&file, &b)?;
                b
            }
        };
        let v: Value = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::msg(format!("{id} sürüm dosyası okunamadı: {e}")))?;
        next = v
            .get("inheritsFrom")
            .and_then(Value::as_str)
            .map(str::to_string);
        chain.push(v);
    }
    chain.reverse();
    Ok(chain)
}

/// Eksik dosyalar: istemci jar'ı, kütüphaneler (+ native'ler), log ayarı. Asset'ler ayrıca.
pub fn missing_files(m: &Merged) -> Vec<FileSpec> {
    let mut out = Vec::new();
    let mut push = |f: &FileSpec| {
        if !f.url.is_empty() && !f.present() {
            out.push(f.clone());
        }
    };
    if let Some(jar) = &m.client_jar {
        push(jar);
    }
    for lib in &m.libraries {
        if let Some(a) = &lib.artifact {
            push(a);
        }
        if let Some(n) = &lib.natives {
            push(n);
        }
    }
    if let Some((_, f)) = &m.logging {
        push(f);
    }
    out
}

/// Classpath: kütüphaneler + oyunun jar'ı. Adresi olmayan (installer'ın ürettiği) dosyalar var olmalı.
pub fn classpath(m: &Merged) -> AppResult<Vec<PathBuf>> {
    let mut cp = Vec::new();
    for lib in &m.libraries {
        if let Some(a) = &lib.artifact {
            if a.url.is_empty() && !a.path.is_file() {
                return Err(AppError::msg(format!(
                    "{} eksik; mod altyapısını yeniden kurmak gerekiyor.",
                    lib.name
                )));
            }
            cp.push(a.path.clone());
        }
    }
    if let Some(jar) = &m.client_jar {
        cp.push(jar.path.clone());
    }
    Ok(cp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const WIN: Env = Env {
        os: "windows",
        x64: true,
    };

    #[test]
    fn evaluates_rules() {
        assert!(rules_allow(None, WIN));
        let only_osx = json!([{"action": "allow", "os": {"name": "osx"}}]);
        assert!(!rules_allow(Some(&only_osx), WIN));
        let not_osx = json!([{"action": "allow"}, {"action": "disallow", "os": {"name": "osx"}}]);
        assert!(rules_allow(Some(&not_osx), WIN));
        let x86 = json!([{"action": "allow", "os": {"arch": "x86"}}]);
        assert!(!rules_allow(Some(&x86), WIN));
        let quick = json!([{"action": "allow", "features": {"is_quick_play_multiplayer": true}}]);
        assert!(!rules_allow(Some(&quick), WIN));
    }

    #[test]
    fn builds_maven_paths() {
        assert_eq!(
            maven_path("net.fabricmc:fabric-loader:0.19.5").as_deref(),
            Some("net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar")
        );
        assert_eq!(
            maven_path("org.lwjgl:lwjgl:3.3.3:natives-windows").as_deref(),
            Some("org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar")
        );
        assert_eq!(
            maven_path("de.oceanlabs.mcp:mcp_config:1.20@zip").as_deref(),
            Some("de/oceanlabs/mcp/mcp_config/1.20/mcp_config-1.20.zip")
        );
        assert_eq!(maven_path("a:../b:1"), None);
        assert_eq!(maven_path("a:b"), None);
    }

    fn vanilla() -> Value {
        json!({
            "id": "26.3",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "30", "sha1": "aa", "size": 10, "url": "https://x/30.json"},
            "javaVersion": {"majorVersion": 25},
            "downloads": {"client": {"url": "https://x/client.jar", "sha1": "cc", "size": 100}},
            "logging": {"client": {"argument": "-Dlog4j.configurationFile=${path}",
                "file": {"id": "client-1.21.2.xml", "sha1": "dd", "size": 5, "url": "https://x/log.xml"}}},
            "libraries": [
                {"name": "org.ow2.asm:asm:9.6",
                 "downloads": {"artifact": {"path": "org/ow2/asm/asm/9.6/asm-9.6.jar", "url": "https://x/asm96.jar", "sha1": "a1", "size": 1}}},
                {"name": "org.lwjgl:lwjgl:3.3.3:natives-macos",
                 "downloads": {"artifact": {"path": "p", "url": "u", "sha1": "s", "size": 1}},
                 "rules": [{"action": "allow", "os": {"name": "osx"}}]}
            ],
            "arguments": {
                "game": ["--username", "${auth_player_name}",
                    {"rules": [{"action": "allow", "features": {"is_demo_user": true}}], "value": "--demo"}],
                "jvm": ["-cp", "${classpath}"]
            }
        })
    }

    #[test]
    fn merges_fabric_on_vanilla() {
        let fabric = json!({
            "id": "fabric-loader-0.19.5-26.3",
            "inheritsFrom": "26.3",
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "arguments": {"game": [], "jvm": ["-DFabricMcEmu= net.minecraft.client.main.Main "]},
            "libraries": [
                {"name": "org.ow2.asm:asm:9.10.1", "url": "https://maven.fabricmc.net/", "sha1": "f1", "size": 2},
                {"name": "net.fabricmc:fabric-loader:0.19.5", "url": "https://maven.fabricmc.net"}
            ]
        });
        let wrapper = json!({
            "id": "mcsm-test-1", "inheritsFrom": "fabric-loader-0.19.5-26.3",
            "arguments": {"game": ["--quickPlayMultiplayer", "localhost:25565"], "jvm": []},
            "libraries": []
        });
        let mc = PathBuf::from("/mc");
        let m = merge(&[vanilla(), fabric, wrapper], &mc, WIN).unwrap();
        assert_eq!(m.id, "mcsm-test-1");
        assert_eq!(
            m.main_class,
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert_eq!(m.java_major, Some(25));
        assert_eq!(m.asset_index.as_ref().unwrap().id, "30");
        // Fabric'in asm'si vanilla'nınkini ezer; macOS native'i elenir.
        let names: Vec<&str> = m.libraries.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "org.ow2.asm:asm:9.10.1",
                "net.fabricmc:fabric-loader:0.19.5"
            ]
        );
        assert_eq!(
            m.libraries[1].artifact.as_ref().unwrap().url,
            "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar"
        );
        assert_eq!(m.libraries[1].artifact.as_ref().unwrap().sha1, None);
        assert!(
            m.client_jar
                .as_ref()
                .unwrap()
                .path
                .ends_with("versions/26.3/26.3.jar")
        );
        // Argümanlar alttan üste.
        assert_eq!(m.game_args.first(), Some(&Arg::Plain("--username".into())));
        assert_eq!(
            m.game_args.last(),
            Some(&Arg::Plain("localhost:25565".into()))
        );
        assert_eq!(m.jvm_args.len(), 3);
        assert!(m.logging.is_some());
    }

    #[test]
    fn loads_chain_from_disk() {
        let mc = std::env::temp_dir().join(format!("mcsm-chain-{}", uuid::Uuid::new_v4()));
        let put = |id: &str, v: Value| {
            let d = mc.join("versions").join(id);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join(format!("{id}.json")), v.to_string()).unwrap();
        };
        put("mcsm-x", json!({"id": "mcsm-x", "inheritsFrom": "26.3"}));
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let chain = rt
            .block_on(load_chain(&mc, "mcsm-x", |id| async move {
                assert_eq!(id, "26.3");
                Ok(vanilla().to_string().into_bytes())
            }))
            .unwrap();
        assert_eq!(chain.len(), 2);
        assert_eq!(chain[0]["id"], json!("26.3"));
        // İndirilen vanilla JSON'u diske de yazıldı.
        assert!(mc.join("versions/26.3/26.3.json").is_file());
        let _ = std::fs::remove_dir_all(&mc);
    }
}
