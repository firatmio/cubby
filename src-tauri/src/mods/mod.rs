//! Mod/eklenti kurulumu: sürüm seçimi, bağımlılık çözümü, kayıt ve dosya işleri.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::{HashAlgo, hash_bytes};
use crate::modrinth::{ClientNeed, DependencyType, Version, VersionFile};

const RECORD_FILE: &str = "mods.json";
const DOWNLOAD_DIR: &str = "downloads";

/// Uygulamanın kurduğu (ya da Modrinth'te tanıdığı) bir dosya. M7b mod eşitlemesi bunu kullanır.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRecord {
    pub file: String,
    pub sha1: String,
    pub project_id: String,
    pub version_id: String,
    /// Başka bir mod istediği için kendiliğinden kuruldu.
    #[serde(default)]
    pub dependency: bool,
    /// Modrinth'ten öğrenilen ad ve oyuncu ihtiyacı (oyuncuya mod gönderirken ağsız kullanılır).
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub need: Option<ClientNeed>,
}

/// Sürümün `ext` uzantılı kurulacak dosyası (modlarda `jar`, paketlerde `zip`): önce `primary`.
pub fn primary_file<'a>(v: &'a Version, ext: &str) -> Option<&'a VersionFile> {
    let suffix = format!(".{ext}");
    let files = || {
        v.files
            .iter()
            .filter(|f| f.filename.to_ascii_lowercase().ends_with(&suffix))
    };
    files().find(|f| f.primary).or_else(|| files().next())
}

/// En kararlı, sonra en yeni sürüm (release > beta > alpha). `.jar` dosyası olmayanlar elenir.
pub fn pick_version(versions: &[Version]) -> Option<&Version> {
    pick_version_ext(versions, "jar")
}

pub fn pick_version_ext<'a>(versions: &'a [Version], ext: &str) -> Option<&'a Version> {
    versions
        .iter()
        .filter(|v| primary_file(v, ext).is_some())
        .min_by(|a, b| {
            a.version_type
                .cmp(&b.version_type)
                .then_with(|| b.date_published.cmp(&a.date_published))
        })
}

/// Sunucu klasörüne yazılacak dosya adı: yalnız güvenli karakterler, `.jar` sonu.
pub fn sanitize_filename(name: &str) -> Option<String> {
    sanitize_filename_ext(name, "jar")
}

/// `sanitize_filename` gibi; uzantı `ext` (paketlerde `zip`).
pub fn sanitize_filename_ext(name: &str, ext: &str) -> Option<String> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
        && !name.starts_with('.')
        && !name.contains("..")
        && name.to_ascii_lowercase().ends_with(&format!(".{ext}"));
    ok.then(|| name.to_string())
}

/// Paket dosyalarının adları serbest ("Faithful 32x - 1.21.zip"): reddetmek yerine güvenli
/// karakterlere çevrilir (boşluk ve diğerleri `_`), uzantı korunur.
pub fn safe_pack_name(name: &str, ext: &str) -> Option<String> {
    let suffix = format!(".{ext}");
    let lower = name.to_ascii_lowercase();
    let stem = lower
        .ends_with(&suffix)
        .then(|| &name[..name.len() - suffix.len()])?;
    let mut out = String::new();
    for c in stem.chars() {
        let c = if c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-') {
            c
        } else {
            '_'
        };
        if !(c == '_' && out.ends_with('_')) {
            out.push(c);
        }
    }
    let stem: String = out.trim_matches('_').chars().take(100).collect();
    (!stem.is_empty()).then(|| format!("{stem}{suffix}"))
}

/// Bağımlılık çözümü için sürüm kaynağı (gerçekte Modrinth, testte sahte).
pub trait Source {
    /// Projenin bu dünyaya uyan en iyi sürümü.
    async fn pick_for(&self, project_id: &str) -> AppResult<Option<Version>>;
    async fn version(&self, version_id: &str) -> AppResult<Version>;
}

#[derive(Debug, Clone)]
pub struct Pick {
    pub version: Version,
    pub dependency: bool,
}

#[derive(Debug, Default)]
pub struct Plan {
    /// Kurulacaklar, önce istenen proje.
    pub install: Vec<Pick>,
    /// Gerekli ama bu sürüm için bulunamayan bağımlılıklar (proje kimliği).
    pub missing: Vec<String>,
    /// Kurulu olup bu modla uyumsuz olan projeler.
    pub conflicts: Vec<String>,
}

/// `root` ve kurulu olmayan zorunlu bağımlılıkları çözer. Kurulu projeler (`installed`) atlanır.
pub async fn resolve(
    src: &impl Source,
    root: &str,
    installed: &HashSet<String>,
) -> AppResult<Plan> {
    let mut plan = Plan::default();
    let mut seen: HashSet<String> = HashSet::new();
    // (proje kimliği?, sürüm kimliği?, bağımlılık mı)
    let mut queue: VecDeque<(Option<String>, Option<String>, bool)> =
        VecDeque::from([(Some(root.to_string()), None, false)]);

    while let Some((project, version_id, dependency)) = queue.pop_front() {
        if let Some(p) = &project
            && (seen.contains(p) || (dependency && installed.contains(p)))
        {
            continue;
        }
        let version = match (&version_id, &project) {
            (Some(vid), _) => Some(src.version(vid).await?),
            (None, Some(p)) => src.pick_for(p).await?,
            (None, None) => None,
        };
        let Some(version) = version else {
            match project {
                Some(p) if !dependency => {
                    return Err(AppError::msg(tx!(
                        "Bu mod dünyanın sürümü için yayınlanmamış ({p}).",
                        "This mod isn't released for the world's version ({p})."
                    )));
                }
                Some(p) => plan.missing.push(p),
                None => {}
            }
            continue;
        };
        // Sürüm kimliğinden gelince proje kimliği burada belli olur.
        if !seen.insert(version.project_id.clone())
            || (dependency && installed.contains(&version.project_id))
        {
            continue;
        }
        for d in &version.dependencies {
            match d.dependency_type {
                DependencyType::Required => {
                    queue.push_back((d.project_id.clone(), d.version_id.clone(), true))
                }
                DependencyType::Incompatible => {
                    if let Some(p) = &d.project_id
                        && installed.contains(p)
                    {
                        plan.conflicts.push(p.clone());
                    }
                }
                _ => {}
            }
        }
        plan.install.push(Pick {
            version,
            dependency,
        });
    }
    Ok(plan)
}

// ---- Kayıt ----

pub fn load_records(meta: &Path) -> Vec<ModRecord> {
    std::fs::read_to_string(meta.join(RECORD_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_records(meta: &Path, records: &[ModRecord]) -> AppResult<()> {
    std::fs::create_dir_all(meta)?;
    let tmp = meta.join(format!("{RECORD_FILE}.tmp"));
    std::fs::write(&tmp, serde_json::to_string_pretty(records)?)?;
    std::fs::rename(tmp, meta.join(RECORD_FILE))?;
    Ok(())
}

/// Klasördeki `.jar`'lar ve sha1'leri (dosya adına göre sıralı).
pub fn scan(content: &Path) -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir(content) else {
        return Vec::new();
    };
    let mut out: Vec<(String, String)> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.to_ascii_lowercase().ends_with(".jar") {
                return None;
            }
            let bytes = std::fs::read(e.path()).ok()?;
            Some((name, hash_bytes(HashAlgo::Sha1, &bytes)))
        })
        .collect();
    out.sort_by_key(|(name, _)| name.to_ascii_lowercase());
    out
}

/// Kayıtları klasörle eşitler: silinen dosyaların kaydı düşer, adı değişenler güncellenir.
pub fn reconcile(records: Vec<ModRecord>, files: &[(String, String)]) -> Vec<ModRecord> {
    let by_sha: HashMap<&str, &str> = files
        .iter()
        .map(|(f, s)| (s.as_str(), f.as_str()))
        .collect();
    records
        .into_iter()
        .filter_map(|mut r| {
            let file = by_sha.get(r.sha1.as_str())?;
            r.file = file.to_string();
            Some(r)
        })
        .collect()
}

/// Sürümün dosyasını indirir (sha512 doğrulamalı), önce `meta/downloads`'a, sonra yerine taşır.
/// `replace` verilirse eski dosya Geri Dönüşüm Kutusu'na gider.
pub async fn download_into(
    http: &reqwest::Client,
    meta: &Path,
    content: &Path,
    version: &Version,
    replace: Option<&str>,
    on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<ModRecord> {
    download_into_ext(http, meta, content, version, "jar", replace, on_progress).await
}

/// `download_into` gibi; dosya uzantısı `ext` (paketlerde `zip`).
pub async fn download_into_ext(
    http: &reqwest::Client,
    meta: &Path,
    content: &Path,
    version: &Version,
    ext: &str,
    replace: Option<&str>,
    on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<ModRecord> {
    let file = primary_file(version, ext).ok_or_else(|| {
        AppError::msg(tx!(
            "Bu sürümde kurulabilir bir dosya yok.",
            "This version has no installable file."
        ))
    })?;
    let name = if ext == "jar" {
        sanitize_filename_ext(&file.filename, ext)
    } else {
        safe_pack_name(&file.filename, ext)
    }
    .ok_or_else(|| {
        AppError::msg(tx!(
            "Güvenli olmayan dosya adı: {}",
            "Unsafe file name: {}",
            file.filename
        ))
    })?;
    let target = content.join(&name);
    if replace.is_none_or(|old| old != name) && target.exists() {
        let existing = hash_bytes(HashAlgo::Sha1, &std::fs::read(&target)?);
        if existing == file.hashes.sha1 {
            return Ok(record(&name, version, file));
        }
        return Err(AppError::msg(tx!(
            "Klasörde aynı adlı başka bir dosya var: {name}",
            "Another file with the same name is in the folder: {name}"
        )));
    }

    let staging: PathBuf = meta.join(DOWNLOAD_DIR).join(&name);
    download_file(
        http,
        &file.url,
        &staging,
        Some((HashAlgo::Sha512, &file.hashes.sha512)),
        on_progress,
    )
    .await?;
    std::fs::create_dir_all(content)?;
    if let Some(old) = replace {
        let old_path = content.join(old);
        if old_path.exists() {
            trash::delete(&old_path).map_err(|e| {
                AppError::msg(tx!(
                    "Eski sürüm kaldırılamadı: {e}",
                    "Couldn't remove the old version: {e}"
                ))
            })?;
        }
    }
    std::fs::rename(&staging, &target)?;
    Ok(record(&name, version, file))
}

fn record(name: &str, v: &Version, f: &VersionFile) -> ModRecord {
    ModRecord {
        file: name.to_string(),
        sha1: f.hashes.sha1.clone(),
        project_id: v.project_id.clone(),
        version_id: v.id.clone(),
        dependency: false,
        title: None,
        need: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modrinth::{Dependency, Hashes, VersionType};

    fn file(name: &str, primary: bool) -> VersionFile {
        VersionFile {
            url: format!("https://cdn.example/{name}"),
            filename: name.into(),
            primary,
            hashes: Hashes {
                sha1: "a".into(),
                sha512: "b".into(),
            },
        }
    }

    fn ver(
        project: &str,
        id: &str,
        t: VersionType,
        date: &str,
        deps: Vec<(&str, DependencyType)>,
    ) -> Version {
        Version {
            id: id.into(),
            project_id: project.into(),
            version_number: id.into(),
            version_type: t,
            date_published: date.into(),
            dependencies: deps
                .into_iter()
                .map(|(p, d)| Dependency {
                    version_id: None,
                    project_id: Some(p.into()),
                    dependency_type: d,
                })
                .collect(),
            files: vec![file(&format!("{project}-{id}.jar"), true)],
            loaders: Vec::new(),
            game_versions: Vec::new(),
        }
    }

    #[test]
    fn picks_stable_then_newest() {
        let vs = vec![
            ver("p", "beta-new", VersionType::Beta, "2026-10-05", vec![]),
            ver("p", "rel-old", VersionType::Release, "2026-01-01", vec![]),
            ver("p", "rel-new", VersionType::Release, "2026-09-01", vec![]),
        ];
        assert_eq!(pick_version(&vs).unwrap().id, "rel-new");
        let only_beta = vec![ver("p", "b", VersionType::Beta, "2026-01-01", vec![])];
        assert_eq!(pick_version(&only_beta).unwrap().id, "b");

        let mut zip_only = ver("p", "z", VersionType::Release, "2026-10-09", vec![]);
        zip_only.files = vec![file("pack.zip", true)];
        assert!(pick_version(&[zip_only.clone()]).is_none());
        zip_only.files.push(file("real.jar", false));
        assert_eq!(primary_file(&zip_only, "jar").unwrap().filename, "real.jar");
        assert_eq!(primary_file(&zip_only, "zip").unwrap().filename, "pack.zip");
    }

    #[test]
    fn pack_names_are_made_safe() {
        assert_eq!(
            safe_pack_name("Faithful 32x - 1.21.zip", "zip").as_deref(),
            Some("Faithful_32x_-_1_21.zip")
        );
        assert_eq!(
            safe_pack_name("§6Fresh Animations v1.9.ZIP", "zip").as_deref(),
            Some("6Fresh_Animations_v1_9.zip")
        );
        assert_eq!(
            safe_pack_name("../../evil.zip", "zip").as_deref(),
            Some("evil.zip")
        );
        assert_eq!(safe_pack_name("not-a-zip.jar", "zip"), None);
        assert_eq!(safe_pack_name("....zip", "zip"), None);
    }

    #[test]
    fn filenames_are_sanitised() {
        assert_eq!(
            sanitize_filename("fabric-api-0.162.0+26.3.jar").as_deref(),
            Some("fabric-api-0.162.0+26.3.jar")
        );
        for bad in [
            "../x.jar",
            "a/b.jar",
            "a\\b.jar",
            "x.exe",
            ".hidden.jar",
            "",
            "mod name.jar",
            "a..b.jar",
        ] {
            assert!(sanitize_filename(bad).is_none(), "{bad}");
        }
    }

    struct Fake(HashMap<String, Version>);

    impl Source for Fake {
        async fn pick_for(&self, project_id: &str) -> AppResult<Option<Version>> {
            Ok(self.0.get(project_id).cloned())
        }
        async fn version(&self, version_id: &str) -> AppResult<Version> {
            self.0
                .values()
                .find(|v| v.id == version_id)
                .cloned()
                .ok_or_else(|| AppError::msg("yok"))
        }
    }

    fn fake(vs: Vec<Version>) -> Fake {
        Fake(vs.into_iter().map(|v| (v.project_id.clone(), v)).collect())
    }

    #[tokio::test]
    async fn resolves_chain_skips_installed_and_cycles() {
        use DependencyType::*;
        let src = fake(vec![
            ver(
                "a",
                "a1",
                VersionType::Release,
                "1",
                vec![("api", Required), ("opt", Optional)],
            ),
            ver(
                "api",
                "api1",
                VersionType::Release,
                "1",
                vec![("lib", Required)],
            ),
            ver(
                "lib",
                "lib1",
                VersionType::Release,
                "1",
                vec![("api", Required)],
            ), // döngü
            ver("opt", "opt1", VersionType::Release, "1", vec![]),
        ]);
        let plan = resolve(&src, "a", &HashSet::new()).await.unwrap();
        let ids: Vec<_> = plan
            .install
            .iter()
            .map(|p| p.version.project_id.as_str())
            .collect();
        assert_eq!(ids, vec!["a", "api", "lib"]);
        assert!(!plan.install[0].dependency && plan.install[1].dependency);

        let plan = resolve(&src, "a", &HashSet::from(["api".to_string()]))
            .await
            .unwrap();
        assert_eq!(plan.install.len(), 1);
    }

    #[tokio::test]
    async fn reports_missing_and_conflicts() {
        use DependencyType::*;
        let src = fake(vec![ver(
            "a",
            "a1",
            VersionType::Release,
            "1",
            vec![("gone", Required), ("bad", Incompatible)],
        )]);
        let plan = resolve(&src, "a", &HashSet::from(["bad".to_string()]))
            .await
            .unwrap();
        assert_eq!(plan.missing, vec!["gone"]);
        assert_eq!(plan.conflicts, vec!["bad"]);
        assert!(resolve(&src, "nope", &HashSet::new()).await.is_err());
    }

    #[test]
    fn records_roundtrip_and_reconcile() {
        let dir = std::env::temp_dir().join(format!("mcsm-mods-{}", uuid::Uuid::new_v4()));
        let r = ModRecord {
            file: "a.jar".into(),
            sha1: "s1".into(),
            project_id: "p".into(),
            version_id: "v".into(),
            dependency: true,
            title: None,
            need: None,
        };
        save_records(&dir, std::slice::from_ref(&r)).unwrap();
        assert_eq!(load_records(&dir), vec![r.clone()]);

        // Dosya yeniden adlandırıldı: kayıt yeni adı alır; silinen dosyanın kaydı düşer.
        let gone = ModRecord {
            sha1: "s2".into(),
            ..r.clone()
        };
        let out = reconcile(vec![r, gone], &[("renamed.jar".into(), "s1".into())]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].file, "renamed.jar");
    }
}
