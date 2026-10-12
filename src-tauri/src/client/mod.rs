//! Oyuncunun kendi Minecraft'ı: mod altyapısının (Fabric, Quilt, NeoForge, Forge) istemci sürümü,
//! dünyaya özel Launcher profili ve modların eşitlenmesi.
//! Host (kendi dünyası) ve katılımcı (arkadaşının dünyası) aynı kodu kullanır.
//!
//! - Resmi Launcher: her dünya `launcher_profiles.json`'da kendi profili ve `.minecraft/mcsm/<ad>` oyun klasörüyle.
//! - Yalnız TLauncher: ortak `.minecraft/mods`; bizim koyduklarımız dünya değişince `mods/_disabled`'a alınır.

pub mod launch;
pub mod manifest;

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::{AppError, AppResult};
use crate::hash::{HashAlgo, hash_bytes};
use crate::loaders::{self, LoaderKind};

/// Dünya profillerinin oyun klasörlerinin kökü: `.minecraft/mcsm/<ad>`.
pub const PROFILES_DIR: &str = "mcsm";
const PROFILES_FILE: &str = "launcher_profiles.json";
const RECORD_FILE: &str = ".mcsm.json";
const DISABLED_DIR: &str = "_disabled";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions/loader";
const QUILT_META: &str = "https://meta.quiltmc.org/v3/versions/loader";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Launcher {
    Official,
    TLauncher,
}

/// Resmi Launcher'ın kendine özgü dosyaları varsa resmi; yoksa TLauncher izleri varsa TLauncher.
pub fn detect_launcher(mc: &Path) -> Option<Launcher> {
    let has = |n: &str| mc.join(n).exists();
    let official_marker = has("launcher_settings.json")
        || std::fs::read_dir(mc).ok().is_some_and(|it| {
            it.flatten().any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("launcher_accounts")
            })
        });
    if official_marker {
        return Some(Launcher::Official);
    }
    if has("TlauncherProfiles.json") || has(".tlauncher") || has("tlauncher_profiles.json") {
        return Some(Launcher::TLauncher);
    }
    has(PROFILES_FILE).then_some(Launcher::Official)
}

/// Klasör adı için güvenli kısa ad: "Kardeşlerle survival" → "kardeslerle-survival".
pub fn slug(name: &str) -> String {
    let s: String = name
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'ç' => 'c',
            'ğ' => 'g',
            'ı' | 'i' => 'i',
            'ö' => 'o',
            'ş' => 's',
            'ü' => 'u',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    let s = s
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let mut s: String = s.chars().take(32).collect();
    if s.is_empty() {
        s = "dunya".into();
    }
    s
}

/// Launcher'daki sürüm klasörünün adı (modsuz türlerde `None`).
pub fn version_id(kind: LoaderKind, mc: &str, loader: &str) -> Option<String> {
    Some(match kind {
        LoaderKind::Fabric => format!("fabric-loader-{loader}-{mc}"),
        LoaderKind::Quilt => format!("quilt-loader-{loader}-{mc}"),
        LoaderKind::NeoForge => format!("neoforge-{loader}"),
        LoaderKind::Forge => format!("{mc}-forge-{loader}"),
        LoaderKind::Vanilla | LoaderKind::Paper => return None,
    })
}

fn version_file(mc_dir: &Path, id: &str) -> PathBuf {
    mc_dir.join("versions").join(id).join(format!("{id}.json"))
}

pub fn version_exists(mc_dir: &Path, id: &str) -> bool {
    version_file(mc_dir, id).is_file()
}

/// Fabric/Quilt: Launcher'ın görmesi için `versions/<id>/<id>.json`. Kütüphaneleri ve vanilla'yı
/// Launcher kendisi indirir.
pub async fn ensure_meta_version(
    http: &reqwest::Client,
    mc_dir: &Path,
    kind: LoaderKind,
    mc: &str,
    loader: &str,
) -> AppResult<String> {
    let id = version_id(kind, mc, loader)
        .ok_or_else(|| AppError::msg("Bu dünya türü için istemci sürümü yok."))?;
    let file = version_file(mc_dir, &id);
    if file.is_file() {
        return Ok(id);
    }
    let meta = match kind {
        LoaderKind::Quilt => QUILT_META,
        _ => FABRIC_META,
    };
    let name = kind.label();
    let url = format!("{meta}/{mc}/{loader}/profile/json");
    let profile: Value = http
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::msg(format!("{name} istemci profili alınamadı: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::msg(format!("{name} istemci profili okunamadı: {e}")))?;
    if profile.get("id").and_then(Value::as_str) != Some(id.as_str()) {
        return Err(AppError::msg(format!(
            "{name} istemci profili beklenmedik bir sürüm döndürdü."
        )));
    }
    std::fs::create_dir_all(file.parent().unwrap_or(mc_dir))?;
    write_atomic(&file, &serde_json::to_vec_pretty(&profile)?)?;
    Ok(id)
}

// ---- Doğrudan dünyaya bağlanan sürüm (Quick Play) ----

/// Minecraft 1.20 (23w14a) ve sonrası `--quickPlayMultiplayer` ile doğrudan sunucuya bağlanır.
pub fn quickplay_supported(mc: &str) -> bool {
    let base = mc.split(['-', ' ']).next().unwrap_or("");
    let mut parts = base.split('.').map(|p| p.parse::<u32>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(1), Some(minor)) => minor >= 20,
        (Some(major), _) if major >= 26 => true,
        _ => {
            // Eski haftalık snapshot'lar: "23w14a"
            let (year, week) = base.split_once('w').unwrap_or(("", ""));
            match (
                year.parse::<u32>(),
                week.get(..2).and_then(|w| w.parse::<u32>().ok()),
            ) {
                (Ok(y), Some(w)) => y * 100 + w >= 2314,
                _ => false,
            }
        }
    }
}

/// Dünyanın Launcher sürümünün adı: `mcsm-<klasör adı>`.
pub fn quickplay_id(dir: &str) -> String {
    format!("mcsm-{dir}")
}

/// Asıl sürümü (`base`) devralan ve oyunu `addr`'e doğrudan bağlayan küçük sürüm JSON'u.
/// Kütüphaneler ve oyun dosyası asıl sürümden gelir; içerik aynıysa dosyaya dokunulmaz.
pub fn ensure_quickplay_version(
    mc_dir: &Path,
    id: &str,
    base: &str,
    addr: &str,
) -> AppResult<String> {
    if !crate::util::is_safe_name(id) {
        return Err(AppError::msg("Geçersiz sürüm adı."));
    }
    let file = version_file(mc_dir, id);
    let old: Option<Value> = std::fs::read(&file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let same = old.as_ref().is_some_and(|v| {
        v.get("inheritsFrom").and_then(Value::as_str) == Some(base)
            && v.pointer("/arguments/game/1").and_then(Value::as_str) == Some(addr)
    });
    if !same {
        let now = crate::util::iso_utc(crate::util::now_ms());
        let json = json!({
            "id": id,
            "inheritsFrom": base,
            "type": "release",
            "time": now,
            "releaseTime": now,
            "arguments": { "game": ["--quickPlayMultiplayer", addr], "jvm": [] },
            "libraries": [],
        });
        std::fs::create_dir_all(file.parent().unwrap_or(mc_dir))?;
        write_atomic(&file, &serde_json::to_vec_pretty(&json)?)?;
    }
    Ok(id.to_string())
}

/// Yalnız bizim yazdığımız (`mcsm-`) sürüm klasörünü kaldırır.
pub fn remove_version(mc_dir: &Path, id: &str) {
    if id.starts_with("mcsm-") && crate::util::is_safe_name(id) {
        let _ = std::fs::remove_dir_all(mc_dir.join("versions").join(id));
    }
}

fn profile_keys(mc_dir: &Path) -> HashSet<String> {
    std::fs::read(mc_dir.join(PROFILES_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| {
            v.get("profiles")
                .and_then(Value::as_object)
                .map(|m| m.keys().cloned().collect())
        })
        .unwrap_or_default()
}

/// NeoForge/Forge: resmi installer'ı istemci kipinde çalıştırır (kütüphaneler + `versions/<id>`).
/// Installer'ın kendi eklediği "forge"/"NeoForge" profili geri alınır; dünya profili ayrıca yazılır.
#[allow(clippy::too_many_arguments)]
pub async fn install_forge_client(
    http: &reqwest::Client,
    mc_dir: &Path,
    kind: LoaderKind,
    mc: &str,
    loader: &str,
    java: &Path,
    work: &Path,
    on_line: &mut (impl FnMut(String) + Send),
) -> AppResult<String> {
    let id = version_id(kind, mc, loader)
        .ok_or_else(|| AppError::msg("Bu dünya türü için istemci sürümü yok."))?;
    if version_exists(mc_dir, &id) {
        return Ok(id);
    }
    let flag = match kind {
        LoaderKind::NeoForge => "--install-client",
        _ => "--installClient",
    };
    let url = loaders::installer_url(kind, mc, loader)
        .ok_or_else(|| AppError::msg("Bu dünya türü installer kullanmıyor."))?;
    std::fs::create_dir_all(work)?;
    let jar = work.join("mcsm-installer.jar");
    loaders::download_maven(http, &url, &jar, |_, _| {}).await?;
    let result = async {
        let real = loaders::installer_version_id(&jar)?;
        if real != id {
            return Err(AppError::msg(format!(
                "Installer beklenmedik bir sürüm kuruyor ({real})."
            )));
        }
        // Forge installer'ı bu dosya olmadan çalışmıyor (TLauncher'da olmayabilir).
        if !mc_dir.join(PROFILES_FILE).is_file() {
            edit_profiles(mc_dir, |_| {})?;
        }
        let before = profile_keys(mc_dir);
        let run = loaders::run_installer(
            java,
            &jar,
            &[flag.into(), mc_dir.as_os_str().to_owned()],
            work,
            on_line,
        )
        .await;
        let added: Vec<String> = profile_keys(mc_dir).difference(&before).cloned().collect();
        if !added.is_empty() {
            edit_profiles(mc_dir, |root| {
                for k in &added {
                    remove_profile(root, k);
                }
            })?;
        }
        run
    }
    .await;
    loaders::installer_cleanup(work, &jar).await;
    let _ = std::fs::remove_dir(work);
    result?;
    if !version_exists(mc_dir, &id) {
        return Err(AppError::msg(format!(
            "{} istemci kurulumu tamamlanamadı.",
            kind.label()
        )));
    }
    Ok(id)
}

pub struct ProfileSpec<'a> {
    pub key: &'a str,
    pub name: &'a str,
    pub version_id: &'a str,
    /// `None`: oyuncunun normal `.minecraft`'ı (modsuz dünyalar).
    pub game_dir: Option<&'a Path>,
    pub icon: &'a str,
    pub now: &'a str,
}

/// Profili ekler/günceller; dosyadaki diğer her şey olduğu gibi kalır. `lastUsed` şimdi olur ki Launcher seçili açsın.
pub fn upsert_profile(root: &mut Value, spec: &ProfileSpec) {
    if !root.is_object() {
        *root = json!({});
    }
    let profiles = root
        .as_object_mut()
        .expect("nesne")
        .entry("profiles")
        .or_insert_with(|| json!({}));
    if !profiles.is_object() {
        *profiles = json!({});
    }
    let map = profiles.as_object_mut().expect("nesne");
    let created = map
        .get(spec.key)
        .and_then(|p| p.get("created"))
        .cloned()
        .unwrap_or_else(|| json!(spec.now));
    let mut profile = map
        .get(spec.key)
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    let p = profile.as_object_mut().expect("nesne");
    p.insert("created".into(), created);
    p.insert("name".into(), json!(spec.name));
    p.insert("type".into(), json!("custom"));
    p.insert("lastVersionId".into(), json!(spec.version_id));
    match spec.game_dir {
        Some(dir) => p.insert("gameDir".into(), json!(dir.to_string_lossy())),
        None => p.remove("gameDir"),
    };
    p.insert("icon".into(), json!(spec.icon));
    p.insert("lastUsed".into(), json!(spec.now));
    map.insert(spec.key.to_string(), profile);
}

pub fn remove_profile(root: &mut Value, key: &str) -> bool {
    root.get_mut("profiles")
        .and_then(Value::as_object_mut)
        .is_some_and(|m| m.remove(key).is_some())
}

/// `launcher_profiles.json`'ı okur, değiştirir, yedekleyip yazar.
pub fn edit_profiles(mc_dir: &Path, f: impl FnOnce(&mut Value)) -> AppResult<()> {
    let path = mc_dir.join(PROFILES_FILE);
    let mut root: Value = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| AppError::msg(format!("launcher_profiles.json okunamadı: {e}")))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({ "profiles": {} }),
        Err(e) => return Err(e.into()),
    };
    f(&mut root);
    if path.exists() {
        std::fs::copy(&path, mc_dir.join(format!("{PROFILES_FILE}.mcsm-bak")))?;
    }
    write_atomic(&path, &serde_json::to_vec_pretty(&root)?)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = path.with_extension("mcsm-tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

/// Profil klasörü yeni oluşturuluyorsa ana klasördeki oyun ayarları (tuşlar, dil, grafik) kopyalanır.
pub fn prepare_game_dir(mc_dir: &Path, game_dir: &Path) -> AppResult<()> {
    if !game_dir.exists() {
        std::fs::create_dir_all(game_dir)?;
        let options = mc_dir.join("options.txt");
        if options.is_file() {
            std::fs::copy(options, game_dir.join("options.txt"))?;
        }
    }
    std::fs::create_dir_all(game_dir.join("mods"))?;
    Ok(())
}

// ---- fabric.mod.json / quilt.mod.json ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModEnv {
    Both,
    Client,
    Server,
}

/// Jar'ın kendi tanımındaki ortam: `fabric.mod.json` `environment` ya da `quilt.mod.json`
/// `minecraft.environment`. NeoForge/Forge'da böyle bir alan yok; bulunamazsa "her ikisi".
pub fn mod_env(jar: &Path) -> ModEnv {
    let read = || -> Option<String> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(jar).ok()?).ok()?;
        let mut json = |name: &str| -> Option<Value> {
            let entry = zip.by_name(name).ok()?;
            let mut text = String::new();
            entry.take(1024 * 1024).read_to_string(&mut text).ok()?;
            serde_json::from_str(&text).ok()
        };
        if let Some(v) = json("fabric.mod.json") {
            return v
                .get("environment")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        json("quilt.mod.json")?
            .pointer("/minecraft/environment")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    match read().as_deref() {
        Some("server" | "dedicated_server") => ModEnv::Server,
        Some("client") => ModEnv::Client,
        _ => ModEnv::Both,
    }
}

// ---- Mod eşitleme ----

/// Hedef `mods` klasöründe bizim koyduğumuz bir dosya.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Managed {
    pub file: String,
    pub sha1: String,
    /// Hangi dünya için (TLauncher'da ortak klasörde ayırt etmek için).
    pub world: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub files: Vec<Managed>,
}

pub fn load_record(mods: &Path) -> Record {
    std::fs::read_to_string(mods.join(RECORD_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_record(mods: &Path, r: &Record) -> AppResult<()> {
    std::fs::create_dir_all(mods)?;
    write_atomic(&mods.join(RECORD_FILE), &serde_json::to_vec_pretty(r)?)
}

/// İstenen bir dosya: ad + sha1 (indirme/kopyalama kaynağı ayrıca verilir).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wanted {
    pub file: String,
    pub sha1: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Ops {
    /// `mods/` → `_disabled/` (başka dünyaların modları; yalnız ortak klasörde).
    pub disable: Vec<String>,
    /// `_disabled/` → `mods/` (bu dünyaya dönülünce).
    pub enable: Vec<String>,
    /// Artık istenmeyen, bizim koyduğumuz dosyalar (Geri Dönüşüm Kutusu'na).
    pub remove: Vec<String>,
    pub add: Vec<Wanted>,
    /// Aynı adlı ama farklı içerikli kullanıcı dosyası olduğu için eklenemeyenler.
    pub blocked: Vec<String>,
}

/// `present`: `mods/` içindeki dosyalar (ad → sha1); `disabled`: `_disabled/` içindekiler.
pub fn plan(
    record: &Record,
    present: &HashMap<String, String>,
    disabled: &HashMap<String, String>,
    world: &str,
    wanted: &[Wanted],
    shared: bool,
) -> Ops {
    let mut ops = Ops::default();
    let wanted_sha: HashSet<&str> = wanted.iter().map(|w| w.sha1.as_str()).collect();
    let present_sha: HashSet<&str> = present.values().map(String::as_str).collect();

    for m in &record.files {
        let in_mods = present.get(&m.file) == Some(&m.sha1);
        let in_disabled = disabled.get(&m.file) == Some(&m.sha1);
        if m.world == world {
            if !wanted_sha.contains(m.sha1.as_str()) {
                if in_mods || in_disabled {
                    ops.remove.push(m.file.clone());
                }
            } else if in_disabled && !in_mods && !present_sha.contains(m.sha1.as_str()) {
                ops.enable.push(m.file.clone());
            }
        } else if shared && in_mods && !wanted_sha.contains(m.sha1.as_str()) {
            ops.disable.push(m.file.clone());
        }
    }

    let enabled: HashSet<&str> = ops.enable.iter().map(String::as_str).collect();
    for w in wanted {
        let have = present_sha.contains(w.sha1.as_str())
            || record
                .files
                .iter()
                .any(|m| m.sha1 == w.sha1 && enabled.contains(m.file.as_str()));
        if have {
            continue;
        }
        match present.get(&w.file) {
            Some(other) if other != &w.sha1 && !record.files.iter().any(|m| m.file == w.file) => {
                ops.blocked.push(w.file.clone());
            }
            _ => ops.add.push(w.clone()),
        }
    }
    ops
}

fn scan_dir(dir: &Path) -> HashMap<String, String> {
    crate::mods::scan(dir).into_iter().collect()
}

/// Eşitlemenin sonucu: kaç dosya eklendi/kaldırıldı, hangileri eklenemedi.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub added: usize,
    pub removed: usize,
    pub blocked: Vec<String>,
}

/// `mods` klasörünü `wanted`'a getirir. Eksik dosyalar `fetch(wanted, hedef_yol)` ile yazılır
/// (kopyalama, Modrinth ya da arkadaşın bilgisayarı); `fetch` dosyayı doğrulamaktan sorumludur.
pub async fn sync<F, Fut>(
    mods: &Path,
    world: &str,
    wanted: &[Wanted],
    shared: bool,
    mut fetch: F,
) -> AppResult<SyncResult>
where
    F: FnMut(Wanted, PathBuf) -> Fut,
    Fut: std::future::Future<Output = AppResult<()>>,
{
    std::fs::create_dir_all(mods)?;
    let disabled_dir = mods.join(DISABLED_DIR);
    let mut record = load_record(mods);
    let ops = plan(
        &record,
        &scan_dir(mods),
        &scan_dir(&disabled_dir),
        world,
        wanted,
        shared,
    );

    for f in &ops.disable {
        std::fs::create_dir_all(&disabled_dir)?;
        std::fs::rename(mods.join(f), disabled_dir.join(f))?;
    }
    for f in &ops.enable {
        std::fs::rename(disabled_dir.join(f), mods.join(f))?;
    }
    for f in &ops.remove {
        for p in [mods.join(f), disabled_dir.join(f)] {
            if p.exists() {
                trash::delete(&p).map_err(|e| AppError::msg(format!("{f} kaldırılamadı: {e}")))?;
            }
        }
        record.files.retain(|m| !(m.world == world && &m.file == f));
    }
    let staging = mods.join(".mcsm-downloads");
    for w in &ops.add {
        let name = crate::mods::sanitize_filename(&w.file)
            .ok_or_else(|| AppError::msg(format!("Güvenli olmayan dosya adı: {}", w.file)))?;
        std::fs::create_dir_all(&staging)?;
        let tmp = staging.join(&name);
        fetch(w.clone(), tmp.clone()).await?;
        let got = hash_bytes(HashAlgo::Sha1, &std::fs::read(&tmp)?);
        if got != w.sha1 {
            let _ = std::fs::remove_file(&tmp);
            return Err(AppError::msg(format!(
                "{name} doğrulanamadı (hash tutmadı)."
            )));
        }
        std::fs::rename(&tmp, mods.join(&name))?;
        record.files.retain(|m| m.file != name);
        record.files.push(Managed {
            file: name,
            sha1: w.sha1.clone(),
            world: world.to_string(),
        });
    }
    let _ = std::fs::remove_dir(&staging);
    save_record(mods, &record)?;
    Ok(SyncResult {
        added: ops.add.len(),
        removed: ops.remove.len(),
        blocked: ops.blocked,
    })
}

/// Hedef oyun klasörü ve `mods`'u (Launcher türüne göre).
pub fn targets(mc_dir: &Path, launcher: Launcher, dir_name: &str) -> (PathBuf, PathBuf) {
    match launcher {
        Launcher::Official => {
            let game = mc_dir.join(PROFILES_DIR).join(dir_name);
            let mods = game.join("mods");
            (game, mods)
        }
        Launcher::TLauncher => (mc_dir.to_path_buf(), mc_dir.join("mods")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mcsm-client-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn detects_launchers() {
        let d = tmp("detect");
        assert_eq!(detect_launcher(&d), None);
        std::fs::write(d.join("TlauncherProfiles.json"), "{}").unwrap();
        assert_eq!(detect_launcher(&d), Some(Launcher::TLauncher));
        std::fs::write(d.join("launcher_accounts_microsoft_store.json"), "{}").unwrap();
        assert_eq!(detect_launcher(&d), Some(Launcher::Official));
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Kardeşlerle survival!"), "kardeslerle-survival");
        assert_eq!(slug("🎮"), "dunya");
        assert!(slug(&"a".repeat(80)).len() <= 32);
    }

    #[test]
    fn profile_merge_keeps_unknown_fields() {
        let mut root = json!({
            "profiles": { "abc": { "name": "", "type": "latest-release" } },
            "settings": { "keepLauncherOpen": true },
            "version": 3
        });
        let dir = PathBuf::from(r"C:\mc\mcsm\test");
        let spec = ProfileSpec {
            key: "mcsm-1",
            name: "Test · Cubby",
            version_id: "fabric-loader-0.19.5-26.3",
            game_dir: Some(&dir),
            icon: "Furnace",
            now: "2026-10-10T10:00:00.000Z",
        };
        upsert_profile(&mut root, &spec);
        assert_eq!(root["settings"]["keepLauncherOpen"], json!(true));
        assert_eq!(root["profiles"]["abc"]["type"], json!("latest-release"));
        let p = &root["profiles"]["mcsm-1"];
        assert_eq!(p["lastVersionId"], json!("fabric-loader-0.19.5-26.3"));
        assert_eq!(p["type"], json!("custom"));

        // Güncelleme: oluşturma tarihi korunur, son kullanım değişir.
        let later = ProfileSpec {
            now: "2026-10-11T10:00:00.000Z",
            ..spec
        };
        upsert_profile(&mut root, &later);
        assert_eq!(
            root["profiles"]["mcsm-1"]["created"],
            json!("2026-10-10T10:00:00.000Z")
        );
        assert_eq!(
            root["profiles"]["mcsm-1"]["lastUsed"],
            json!("2026-10-11T10:00:00.000Z")
        );
        assert!(remove_profile(&mut root, "mcsm-1"));
        assert!(root["profiles"].get("mcsm-1").is_none());
    }

    #[test]
    fn plain_profile_has_no_game_dir() {
        let mut root = json!({ "profiles": { "mcsm-2": { "gameDir": "eski" } } });
        upsert_profile(
            &mut root,
            &ProfileSpec {
                key: "mcsm-2",
                name: "Ada · Cubby",
                version_id: "mcsm-ada-12345678",
                game_dir: None,
                icon: "Grass",
                now: "2026-10-12T10:00:00.000Z",
            },
        );
        assert!(root["profiles"]["mcsm-2"].get("gameDir").is_none());
    }

    #[test]
    fn quickplay_versions() {
        assert!(!quickplay_supported("1.19.4"));
        assert!(quickplay_supported("1.20"));
        assert!(quickplay_supported("1.21.11"));
        assert!(quickplay_supported("26.3"));
        assert!(quickplay_supported("26.1-snapshot-4"));
        assert!(quickplay_supported("23w14a"));
        assert!(!quickplay_supported("23w13a"));
        assert!(!quickplay_supported("b1.7.3"));

        let mc = tmp("qp");
        let id = quickplay_id("test-3a08f417");
        ensure_quickplay_version(&mc, &id, "fabric-loader-0.19.5-26.3", "localhost:25565").unwrap();
        let v: Value =
            serde_json::from_slice(&std::fs::read(version_file(&mc, &id)).unwrap()).unwrap();
        assert_eq!(v["id"], json!("mcsm-test-3a08f417"));
        assert_eq!(v["inheritsFrom"], json!("fabric-loader-0.19.5-26.3"));
        assert_eq!(
            v["arguments"]["game"],
            json!(["--quickPlayMultiplayer", "localhost:25565"])
        );
        // Port değişince güncellenir.
        ensure_quickplay_version(&mc, &id, "fabric-loader-0.19.5-26.3", "localhost:25570").unwrap();
        let v: Value =
            serde_json::from_slice(&std::fs::read(version_file(&mc, &id)).unwrap()).unwrap();
        assert_eq!(v["arguments"]["game"][1], json!("localhost:25570"));

        assert!(ensure_quickplay_version(&mc, "../x", "26.3", "a:1").is_err());
        remove_version(&mc, "26.3");
        remove_version(&mc, &id);
        assert!(!mc.join("versions").join(&id).exists());
    }

    fn w(file: &str, sha: &str) -> Wanted {
        Wanted {
            file: file.into(),
            sha1: sha.into(),
        }
    }
    fn m(file: &str, sha: &str, world: &str) -> Managed {
        Managed {
            file: file.into(),
            sha1: sha.into(),
            world: world.into(),
        }
    }
    fn map(items: &[(&str, &str)]) -> HashMap<String, String> {
        items
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
    }

    #[test]
    fn plan_profile_mode() {
        let record = Record {
            files: vec![m("old.jar", "o", "W"), m("keep.jar", "k", "W")],
        };
        let present = map(&[
            ("old.jar", "o"),
            ("keep.jar", "k"),
            ("user.jar", "u"),
            ("clash.jar", "x"),
        ]);
        let ops = plan(
            &record,
            &present,
            &HashMap::new(),
            "W",
            &[
                w("keep.jar", "k"),
                w("new.jar", "n"),
                w("clash.jar", "c"),
                w("user-copy.jar", "u"),
            ],
            false,
        );
        assert_eq!(ops.remove, vec!["old.jar"]);
        assert_eq!(ops.add, vec![w("new.jar", "n")]);
        assert_eq!(ops.blocked, vec!["clash.jar"]);
        assert!(ops.disable.is_empty() && ops.enable.is_empty());
    }

    #[test]
    fn plan_shared_mode_swaps_worlds() {
        // A dünyasının modu açık, B'ye geçiliyor; B'nin modu daha önce kapatılmıştı.
        let record = Record {
            files: vec![
                m("a.jar", "a", "A"),
                m("b.jar", "b", "B"),
                m("api.jar", "p", "A"),
            ],
        };
        let present = map(&[("a.jar", "a"), ("api.jar", "p"), ("mine.jar", "u")]);
        let disabled = map(&[("b.jar", "b")]);
        let ops = plan(
            &record,
            &present,
            &disabled,
            "B",
            &[w("b.jar", "b"), w("api.jar", "p")],
            true,
        );
        assert_eq!(ops.disable, vec!["a.jar"]); // ortak bağımlılık (api) açık kalır
        assert_eq!(ops.enable, vec!["b.jar"]);
        assert!(ops.add.is_empty() && ops.remove.is_empty());
    }

    #[tokio::test]
    async fn sync_copies_verifies_and_records() {
        let src = tmp("src");
        let mods = tmp("mods");
        std::fs::write(src.join("x.jar"), b"jar-x").unwrap();
        let sha = hash_bytes(HashAlgo::Sha1, b"jar-x");
        let wanted = vec![w("x.jar", &sha)];
        let r = sync(&mods, "W", &wanted, false, |w, dest| {
            let src = src.clone();
            async move {
                std::fs::copy(src.join(&w.file), dest)?;
                Ok(())
            }
        })
        .await
        .unwrap();
        assert_eq!(r.added, 1);
        assert!(mods.join("x.jar").is_file());
        assert_eq!(load_record(&mods).files.len(), 1);

        // Yanlış içerik reddedilir.
        let bad = vec![w("y.jar", "0000")];
        let err = sync(&mods, "W", &bad, false, |_, dest| async move {
            std::fs::write(dest, b"baska")?;
            Ok(())
        })
        .await;
        assert!(err.is_err());
        assert!(!mods.join("y.jar").exists());
    }

    #[test]
    fn reads_mod_environment() {
        let d = tmp("fmj");
        let make_as = |name: &str, entry: &str, json: &str| {
            let p = d.join(name);
            let mut zw = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
            zw.start_file(entry, zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut zw, json.as_bytes()).unwrap();
            zw.finish().unwrap();
            p
        };
        let make = |name: &str, json: &str| make_as(name, "fabric.mod.json", json);
        assert_eq!(
            mod_env(&make_as(
                "q.jar",
                "quilt.mod.json",
                r#"{"quilt_loader":{},"minecraft":{"environment":"dedicated_server"}}"#
            )),
            ModEnv::Server
        );
        assert_eq!(
            mod_env(&make_as(
                "n.jar",
                "META-INF/neoforge.mods.toml",
                "modLoader=\"javafml\""
            )),
            ModEnv::Both
        );
        assert_eq!(
            mod_env(&make("s.jar", r#"{"environment":"server"}"#)),
            ModEnv::Server
        );
        assert_eq!(
            mod_env(&make("c.jar", r#"{"environment":"client"}"#)),
            ModEnv::Client
        );
        assert_eq!(mod_env(&make("b.jar", r#"{"id":"x"}"#)), ModEnv::Both);
        assert_eq!(mod_env(&d.join("yok.jar")), ModEnv::Both);
    }

    #[tokio::test]
    #[ignore]
    async fn live_fabric_profile_json() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let mc = tmp("mc");
        let id = ensure_meta_version(&http, &mc, LoaderKind::Fabric, "26.3", "0.19.5")
            .await
            .unwrap();
        assert_eq!(id, "fabric-loader-0.19.5-26.3");
        assert!(version_exists(&mc, &id));
        let id = ensure_meta_version(&http, &mc, LoaderKind::Quilt, "26.3", "0.30.1")
            .await
            .unwrap();
        assert_eq!(id, "quilt-loader-0.30.1-26.3");
        assert!(version_exists(&mc, &id));
    }

    /// Geçici bir `.minecraft`'a NeoForge istemcisi; installer'ın kendi profili geri alınmalı.
    #[tokio::test]
    #[ignore = "ağ erişimi ve Java gerekir"]
    async fn live_neoforge_client() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let mc = tmp("mc-neo");
        edit_profiles(&mc, |root| {
            upsert_profile(
                root,
                &ProfileSpec {
                    key: "mine",
                    name: "Benim",
                    version_id: "26.3",
                    game_dir: Some(&mc),
                    icon: "Grass",
                    now: "2026-10-12T00:00:00.000Z",
                },
            )
        })
        .unwrap();
        let java = crate::java::test_java(25).await;
        let id = install_forge_client(
            &http,
            &mc,
            LoaderKind::NeoForge,
            "26.3",
            "26.3.0.76",
            &java,
            &mc.join("work"),
            &mut |l| println!("  {l}"),
        )
        .await
        .unwrap();
        assert_eq!(id, "neoforge-26.3.0.76");
        assert!(version_exists(&mc, &id));
        assert_eq!(profile_keys(&mc), HashSet::from(["mine".to_string()]));
        assert!(!mc.join("work").exists());
    }
}
