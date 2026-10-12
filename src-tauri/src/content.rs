//! Keşfet'in paketleri (kaynak paketi, shader, veri paketi): dünya başına kayıt ve oyunun ayar
//! dosyalarındaki küçük düzenlemeler. Ağ ve Tauri burada yok; komutlar `content_cmds`'te.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::modrinth::ContentKind;
use crate::mods::ModRecord;
use crate::properties::Properties;

const RECORD_FILE: &str = "content.json";
/// Shader için kurulan istemci modlarının (Iris, Sodium…) saklandığı klasör; eşitleme buradan kopyalar.
pub const EXTRAS_DIR: &str = "client-extras";

/// Kurulu bir paket.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub file: String,
    pub sha1: String,
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    /// İndirme adresi (Modrinth CDN): "arkadaşlarıma da zorunlu" kaynak paketi için.
    #[serde(default)]
    pub url: String,
}

/// Dünya başına paket kaydı (`content.json`).
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    pub resourcepacks: Vec<Item>,
    pub shaders: Vec<Item>,
    pub datapacks: Vec<Item>,
    /// Shader için oyuncunun Minecraft'ına kurulan modlar: istemci eşitlemesinin "ekstraları".
    pub client_mods: Vec<ModRecord>,
    pub active_shader: Option<String>,
    /// Sunucunun girenlere zorunlu gönderdiği kaynak paketi (dosya adı).
    pub forced_pack: Option<String>,
}

impl Record {
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join(RECORD_FILE))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join(format!("{RECORD_FILE}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, dir.join(RECORD_FILE))?;
        Ok(())
    }

    pub fn items(&self, kind: ContentKind) -> &[Item] {
        match kind {
            ContentKind::ResourcePack => &self.resourcepacks,
            ContentKind::Shader => &self.shaders,
            ContentKind::DataPack => &self.datapacks,
            ContentKind::Mod => &[],
        }
    }

    pub fn items_mut(&mut self, kind: ContentKind) -> &mut Vec<Item> {
        match kind {
            ContentKind::ResourcePack => &mut self.resourcepacks,
            ContentKind::Shader => &mut self.shaders,
            // Modların kendi kaydı var (`mods::ModRecord`); buraya düşmez.
            ContentKind::DataPack | ContentKind::Mod => &mut self.datapacks,
        }
    }

    /// Kaydı klasörle eşitler: elle silinmiş dosyaların kaydı düşer.
    pub fn prune(&mut self, kind: ContentKind, dir: &Path) {
        self.items_mut(kind).retain(|i| dir.join(&i.file).is_file());
        if kind == ContentKind::Shader
            && self
                .active_shader
                .as_ref()
                .is_some_and(|a| !self.shaders.iter().any(|s| &s.file == a))
        {
            self.active_shader = None;
        }
        if kind == ContentKind::ResourcePack
            && self
                .forced_pack
                .as_ref()
                .is_some_and(|f| !self.resourcepacks.iter().any(|p| &p.file == f))
        {
            self.forced_pack = None;
        }
    }
}

// ---- options.txt: resourcePacks:["vanilla","file/x.zip"] ----

const PACKS_KEY: &str = "resourcePacks:";

fn pack_entry(file: &str) -> String {
    format!("file/{file}")
}

/// `options.txt` metninde kaynak paketini açar (listenin sonuna, yani en üst önceliğe ekler).
/// Satır yoksa eklenir; diğer satırlara dokunulmaz.
pub fn enable_pack(options: &str, file: &str) -> String {
    edit_packs(options, |list| {
        let entry = pack_entry(file);
        list.retain(|p| p != &entry);
        if !list.iter().any(|p| p == "vanilla") {
            list.insert(0, "vanilla".into());
        }
        list.push(entry);
    })
}

/// `options.txt` metninden kaynak paketini çıkarır.
pub fn disable_pack(options: &str, file: &str) -> String {
    edit_packs(options, |list| {
        let entry = pack_entry(file);
        list.retain(|p| p != &entry);
    })
}

fn edit_packs(options: &str, f: impl FnOnce(&mut Vec<String>)) -> String {
    let mut lines: Vec<String> = options.lines().map(str::to_string).collect();
    let idx = lines.iter().position(|l| l.starts_with(PACKS_KEY));
    let mut list: Vec<String> = idx
        .and_then(|i| serde_json::from_str(&lines[i][PACKS_KEY.len()..]).ok())
        .unwrap_or_else(|| vec!["vanilla".into()]);
    f(&mut list);
    let line = format!(
        "{PACKS_KEY}{}",
        serde_json::to_string(&list).unwrap_or_default()
    );
    match idx {
        Some(i) => lines[i] = line,
        None => lines.push(line),
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

/// Oyun klasöründeki `options.txt`'i düzenler (yoksa oluşturur).
pub fn edit_options(game_dir: &Path, f: impl FnOnce(&str) -> String) -> AppResult<()> {
    let path = game_dir.join("options.txt");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::create_dir_all(game_dir)?;
    std::fs::write(path, f(&text))?;
    Ok(())
}

// ---- Shader seçimi: config/iris.properties (Forge'da oculus.properties) ----

/// Shader yükleyicisinin ayar dosyası.
pub fn shader_config(game_dir: &Path, oculus: bool) -> PathBuf {
    game_dir.join("config").join(if oculus {
        "oculus.properties"
    } else {
        "iris.properties"
    })
}

/// `Some(file)`: o shader açılır; `None`: shader'lar kapanır. Diğer ayarlar korunur.
pub fn set_shader(config: &Path, file: Option<&str>) -> AppResult<()> {
    let mut props = std::fs::read_to_string(config)
        .map(|t| Properties::parse(&t))
        .unwrap_or_default();
    match file {
        Some(f) => {
            props.set("shaderPack", f);
            props.set("enableShaders", "true");
        }
        None => props.set("enableShaders", "false"),
    }
    if let Some(dir) = config.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(config, props.to_text())?;
    Ok(())
}

// ---- Veri paketleri ----

/// Dünyanın veri paketi klasörü: `server.properties`'teki `level-name` (yoksa `world`).
pub fn datapacks_dir(server_dir: &Path) -> PathBuf {
    let level = Properties::load(server_dir)
        .ok()
        .and_then(|p| p.get("level-name").map(str::to_string))
        .map(|l| l.trim().to_string())
        // Yol dışına çıkamasın: yalnız tek bir klasör adı.
        .filter(|l| !l.is_empty() && !l.contains(['/', '\\']) && l != ".." && l != ".")
        .unwrap_or_else(|| "world".into());
    server_dir.join(level).join("datapacks")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cubby-content-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn edits_resource_pack_list() {
        let opts =
            "version:4325\nlang:tr_tr\nresourcePacks:[\"vanilla\",\"file/old.zip\"]\nfov:0.0\n";
        let on = enable_pack(opts, "new.zip");
        assert!(on.contains("resourcePacks:[\"vanilla\",\"file/old.zip\",\"file/new.zip\"]"));
        assert!(on.contains("lang:tr_tr") && on.contains("fov:0.0"));
        // İkinci kez eklemek tekrarlamaz, en üste taşır.
        let again = enable_pack(&on, "old.zip");
        assert!(again.contains("[\"vanilla\",\"file/new.zip\",\"file/old.zip\"]"));
        let off = disable_pack(&again, "new.zip");
        assert!(off.contains("[\"vanilla\",\"file/old.zip\"]"));
        // Satır ya da dosya yoksa oluşturulur.
        assert_eq!(
            enable_pack("", "a.zip"),
            "resourcePacks:[\"vanilla\",\"file/a.zip\"]\n"
        );
        assert!(enable_pack("lang:en_us\n", "a.zip").starts_with("lang:en_us\nresourcePacks:"));
    }

    #[test]
    fn sets_shader() {
        let d = tmp("shader");
        let cfg = shader_config(&d, false);
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&cfg, "#Iris\nmaxShadowRenderDistance=32\nshaderPack=\n").unwrap();
        set_shader(&cfg, Some("BSL_v8.zip")).unwrap();
        let text = std::fs::read_to_string(&cfg).unwrap();
        assert!(text.contains("shaderPack=BSL_v8.zip"));
        assert!(text.contains("enableShaders=true"));
        assert!(text.contains("maxShadowRenderDistance=32"));
        set_shader(&cfg, None).unwrap();
        assert!(
            std::fs::read_to_string(&cfg)
                .unwrap()
                .contains("enableShaders=false")
        );
        // Dosya ve klasör yoksa oluşturulur.
        let fresh = shader_config(&tmp("fresh"), true);
        set_shader(&fresh, Some("x.zip")).unwrap();
        assert!(
            fresh.ends_with("config/oculus.properties")
                || fresh.ends_with("config\\oculus.properties")
        );
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn finds_datapacks_dir() {
        let d = tmp("dp");
        assert_eq!(datapacks_dir(&d), d.join("world").join("datapacks"));
        std::fs::write(d.join("server.properties"), "level-name=Benim dünyam\n").unwrap();
        assert_eq!(datapacks_dir(&d), d.join("Benim dünyam").join("datapacks"));
        std::fs::write(d.join("server.properties"), "level-name=../../etc\n").unwrap();
        assert_eq!(datapacks_dir(&d), d.join("world").join("datapacks"));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn record_survives_old_or_broken_files() {
        let d = tmp("rec");
        assert_eq!(Record::load(&d), Record::default());
        std::fs::write(d.join(RECORD_FILE), "{bozuk").unwrap();
        assert_eq!(Record::load(&d), Record::default());
        std::fs::write(d.join(RECORD_FILE), "{\"shaders\":[]}").unwrap();
        assert_eq!(Record::load(&d), Record::default());
        let mut r = Record::default();
        r.resourcepacks.push(Item {
            file: "a.zip".into(),
            sha1: "x".into(),
            project_id: "p".into(),
            version_id: "v".into(),
            title: "A".into(),
            url: String::new(),
        });
        r.forced_pack = Some("a.zip".into());
        r.save(&d).unwrap();
        assert_eq!(Record::load(&d), r);
        // Dosya klasörde yoksa kaydı ve zorunlu işareti düşer.
        r.prune(ContentKind::ResourcePack, &d);
        assert!(r.resourcepacks.is_empty() && r.forced_pack.is_none());
        let _ = std::fs::remove_dir_all(d);
    }
}
