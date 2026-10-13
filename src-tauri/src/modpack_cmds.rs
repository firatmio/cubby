//! Mod paketi komutları: Keşfet önizlemesindeki plan ve paketin yeni dünyaya kurulumu
//! (`create_instance` çağırır). Saf mantık `modpack`'te.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::{StreamExt, TryStreamExt};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::AppState;
use crate::content::{EXTRAS_DIR, Item, PACK_CLIENT_DIR, PackOrigin, PendingItem, Record};
use crate::download::download_file;
use crate::error::{AppError, AppResult};
use crate::hash::{HashAlgo, hash_bytes};
use crate::loaders::LoaderKind;
use crate::modpack::{self, Index, PackFile, Place, Target};
use crate::modrinth::{ClientNeed, ContentKind, Modrinth, Side, Version, VersionType, client_need};
use crate::mods::{self, ModRecord};

/// Aynı anda inen paket dosyası sayısı.
const PARALLEL: usize = 6;
/// Sürüm seçicide gösterilen en fazla sürüm.
const MAX_VERSIONS: usize = 60;

fn cache_dir(app: &AppHandle, name: &str) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()?.join("cache").join(name))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackVersion {
    id: String,
    number: String,
    mc: String,
    loader: LoaderKind,
    unstable: bool,
}

/// Önizlemedeki paket bilgisi: hangi sürüm, nasıl bir sunucu, kaç mod.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackPlan {
    /// Kurulabilir sürümler (yeniden eskiye).
    versions: Vec<PackVersion>,
    version_id: Option<String>,
    version_number: Option<String>,
    unstable: bool,
    mc: Option<String>,
    loader: Option<LoaderKind>,
    loader_version: Option<String>,
    /// Sunucuya kurulacak modlar.
    server_mods: usize,
    /// Yalnız oyuncuda çalışan modlar.
    client_mods: usize,
    /// İndirilecek toplam (bayt).
    size: u64,
    ram_mb: u32,
    /// Kurulamıyorsa neden.
    error: Option<String>,
}

/// Modrinth'te listelenen bir sürüm kurulabilir mi (altyapısı ve Minecraft sürümüne göre)?
fn installable(v: &Version) -> AppResult<PackVersion> {
    mods::primary_file(v, "mrpack").ok_or_else(no_version)?;
    let loader = modpack::loader_of(&v.loaders).ok_or_else(no_version)?;
    let mc = v.game_versions.first().cloned().ok_or_else(no_version)?;
    modpack::check_supported(loader, &mc)?;
    Ok(PackVersion {
        id: v.id.clone(),
        number: v.version_number.clone(),
        mc,
        loader,
        unstable: v.version_type != VersionType::Release,
    })
}

fn no_version() -> AppError {
    AppError::msg(tx!(
        "Bu paketin kurulabilir bir sürümü yok.",
        "This pack has no version that can be installed."
    ))
}

/// Modrinth kimlikleri yalnız güvenli karakterlerden oluşur (önbellek dosya adı olarak kullanılır).
fn safe_id(id: &str) -> AppResult<&str> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(id).ok_or_else(no_version)
}

/// Sürümün `.mrpack`'i (önbellekte yoksa indirilir, sha512 doğrulamalı).
async fn fetch_mrpack(app: &AppHandle, http: &reqwest::Client, v: &Version) -> AppResult<PathBuf> {
    let file = mods::primary_file(v, "mrpack").ok_or_else(no_version)?;
    let path = cache_dir(app, "modpacks")?.join(format!("{}.mrpack", safe_id(&v.id)?));
    if path.is_file() && hash_bytes(HashAlgo::Sha1, &std::fs::read(&path)?) == file.hashes.sha1 {
        return Ok(path);
    }
    download_file(
        http,
        &file.url,
        &path,
        Some((HashAlgo::Sha512, &file.hashes.sha512)),
        |_, _| {},
    )
    .await?;
    Ok(path)
}

fn is_mod(f: &PackFile) -> bool {
    modpack::is_mod_jar(&f.path.replace('\\', "/"))
}

#[tauri::command]
pub async fn modpack_plan(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    version_id: Option<String>,
) -> AppResult<PackPlan> {
    let api = Modrinth::new(&state.http);
    let all = api.all_versions(&project_id).await?;
    let mut first_error = None;
    let versions: Vec<PackVersion> = all
        .iter()
        .filter_map(|v| match installable(v) {
            Ok(p) => Some(p),
            Err(e) => {
                first_error.get_or_insert(e);
                None
            }
        })
        .take(MAX_VERSIONS)
        .collect();
    let mut plan = PackPlan {
        versions,
        ..Default::default()
    };
    // İstenen sürüm, yoksa en yeni kararlı, o da yoksa en yeni.
    let chosen = version_id
        .and_then(|id| plan.versions.iter().find(|v| v.id == id))
        .or_else(|| plan.versions.iter().find(|v| !v.unstable))
        .or_else(|| plan.versions.first())
        .cloned();
    let Some(chosen) = chosen else {
        plan.error = Some(first_error.unwrap_or_else(no_version).to_string());
        return Ok(plan);
    };
    plan.version_id = Some(chosen.id.clone());
    plan.version_number = Some(chosen.number.clone());
    plan.unstable = chosen.unstable;
    plan.mc = Some(chosen.mc.clone());
    plan.loader = Some(chosen.loader);

    let version = all
        .iter()
        .find(|v| v.id == chosen.id)
        .ok_or_else(no_version)?;
    let read = async {
        let path = fetch_mrpack(&app, &state.http, version).await?;
        let index = tauri::async_runtime::spawn_blocking(move || modpack::read_index(&path))
            .await
            .map_err(|e| AppError::msg(e.to_string()))??;
        let target = modpack::target(&index.dependencies)?;
        Ok::<_, AppError>((index, target))
    };
    match read.await {
        Ok((index, target)) => {
            plan.mc = Some(target.mc);
            plan.loader = Some(target.loader);
            plan.loader_version = target.loader_version;
            for f in &index.files {
                match modpack::place(f) {
                    Place::Server if is_mod(f) => plan.server_mods += 1,
                    Place::ClientMod => plan.client_mods += 1,
                    _ => {}
                }
                if modpack::place(f) != Place::Skip {
                    plan.size += f.file_size;
                }
            }
            plan.ram_mb = modpack::recommended_ram(plan.server_mods + plan.client_mods);
        }
        Err(e) => plan.error = Some(e.to_string()),
    }
    Ok(plan)
}

// ---- Kurulum ----

/// Kuruluma hazır paket: `.mrpack`, index ve istediği sunucu.
pub struct Prepared {
    pub mrpack: PathBuf,
    pub index: Index,
    pub target: Target,
    pub version: Version,
}

/// Paketi indirir ve okur; altyapı ve sürüm arayüzden değil buradan alınır.
pub async fn prepare(
    app: &AppHandle,
    http: &reqwest::Client,
    project_id: &str,
    version_id: &str,
) -> AppResult<Prepared> {
    let version = Modrinth::new(http).version(safe_id(version_id)?).await?;
    if version.project_id != project_id {
        return Err(no_version());
    }
    let mrpack = fetch_mrpack(app, http, &version).await?;
    let path = mrpack.clone();
    let index = tauri::async_runtime::spawn_blocking(move || modpack::read_index(&path))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    let target = modpack::target(&index.dependencies)?;
    Ok(Prepared {
        mrpack,
        index,
        target,
        version,
    })
}

/// İndirilecek bir dosya ve yeri.
struct Job<'a> {
    file: &'a PackFile,
    rel: PathBuf,
    place: Place,
    url: &'a str,
}

fn is_sha1(s: &str) -> bool {
    s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn file_error(f: &PackFile) -> AppError {
    AppError::msg(tx!(
        "Paketteki bir dosya güvenli değil: {}",
        "A file in the pack isn't safe: {}",
        f.path
    ))
}

/// Paketin dosyalarını sunucuya, oyuncu modlarını ekstralara, oyuncu dosyalarını `pack-client`'e
/// koyar; mod kayıtlarını ve `content.json`'u yazar. `on_progress(indirilen, toplam)` bayt.
pub async fn install(
    app: &AppHandle,
    http: &reqwest::Client,
    p: &Prepared,
    server_dir: &Path,
    meta: &Path,
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> AppResult<()> {
    let extras = meta.join(EXTRAS_DIR);
    let client_tree = meta.join(PACK_CLIENT_DIR);

    let mut jobs = Vec::new();
    for f in &p.index.files {
        let place = modpack::place(f);
        if place == Place::Skip {
            continue;
        }
        let rel = modpack::safe_rel_path(&f.path).ok_or_else(|| file_error(f))?;
        if !is_sha1(&f.hashes.sha1) {
            return Err(file_error(f));
        }
        let url = modpack::allowed_url(&f.downloads).ok_or_else(|| file_error(f))?;
        jobs.push(Job {
            file: f,
            rel,
            place,
            url,
        });
    }

    // 1) Önbelleğe indir (yeniden denemede inenler tekrar inmez).
    let cache = cache_dir(app, "modpack-files")?;
    let total: u64 = jobs.iter().map(|j| j.file.file_size).sum();
    let done = AtomicU64::new(0);
    on_progress(0, total);
    // Gelecekler önce toplanır: akışın türü kapanışı taşımasın (Tauri komutu `Send` kalsın).
    let downloads: Vec<_> = jobs
        .iter()
        .map(|j| {
            let (cache, done) = (&cache, &done);
            async move {
                let dest = cache.join(j.file.hashes.sha1.to_ascii_lowercase());
                if dest.is_file()
                    && hash_bytes(HashAlgo::Sha1, &tokio::fs::read(&dest).await?)
                        .eq_ignore_ascii_case(&j.file.hashes.sha1)
                {
                    on_progress(
                        done.fetch_add(j.file.file_size, Ordering::Relaxed) + j.file.file_size,
                        total,
                    );
                    return Ok(());
                }
                let mut last = 0u64;
                download_file(
                    http,
                    j.url,
                    &dest,
                    Some((HashAlgo::Sha512, &j.file.hashes.sha512)),
                    |d, _| {
                        let now = done.fetch_add(d.saturating_sub(last), Ordering::Relaxed)
                            + d.saturating_sub(last);
                        last = d;
                        on_progress(now, total);
                    },
                )
                .await
            }
        })
        .collect();
    futures_util::stream::iter(downloads)
        .buffer_unordered(PARALLEL)
        .try_collect::<Vec<()>>()
        .await?;

    // 2) Yerlerine kopyala.
    let api = Modrinth::new(http);
    let mut server_mods: Vec<ModRecord> = Vec::new();
    let mut pack_client: Vec<ModRecord> = Vec::new();
    let mut pending: Vec<PendingItem> = Vec::new();
    for j in &jobs {
        let from = cache.join(j.file.hashes.sha1.to_ascii_lowercase());
        let name = j.file.name().to_string();
        let ids = modpack::ids_from_url(j.url);
        let record = |file: String| ModRecord {
            file,
            sha1: j.file.hashes.sha1.to_ascii_lowercase(),
            project_id: ids.as_ref().map(|i| i.0.clone()).unwrap_or_default(),
            version_id: ids.as_ref().map(|i| i.1.clone()).unwrap_or_default(),
            dependency: false,
            title: None,
            need: j
                .file
                .env
                .and_then(|e| (e.client == Side::Unsupported).then_some(ClientNeed::None)),
        };
        let dest = match j.place {
            Place::Server => {
                if is_mod(j.file) && ids.is_some() {
                    server_mods.push(record(name.clone()));
                }
                server_dir.join(&j.rel)
            }
            Place::ClientMod => {
                let file = mods::sanitize_filename(&name).ok_or_else(|| file_error(j.file))?;
                pack_client.push(record(file.clone()));
                extras.join(file)
            }
            Place::ClientFile => {
                let kind = match j.rel.components().next().map(|c| c.as_os_str()) {
                    Some(c) if c == "resourcepacks" => Some(ContentKind::ResourcePack),
                    Some(c) if c == "shaderpacks" => Some(ContentKind::Shader),
                    _ => None,
                };
                if let (Some(kind), Some((pid, vid))) = (kind, &ids) {
                    pending.push(PendingItem {
                        kind,
                        item: Item {
                            file: name.clone(),
                            sha1: j.file.hashes.sha1.to_ascii_lowercase(),
                            project_id: pid.clone(),
                            version_id: vid.clone(),
                            title: name.clone(),
                            url: j.url.to_string(),
                        },
                    });
                }
                client_tree.join(&j.rel)
            }
            Place::Skip => continue,
        };
        if let Some(dir) = dest.parent() {
            tokio::fs::create_dir_all(dir).await?;
        }
        tokio::fs::copy(&from, &dest).await?;
    }

    // 3) Override'lar (indirilenlerin üstüne; spesifikasyondaki sıra).
    let (mrpack, server, tree, ex) = (
        p.mrpack.clone(),
        server_dir.to_path_buf(),
        client_tree.clone(),
        extras.clone(),
    );
    let override_mods = tauri::async_runtime::spawn_blocking(move || {
        modpack::extract_overrides(
            &mrpack,
            &modpack::Targets {
                server: &server,
                client: &tree,
                client_mods: &ex,
            },
        )
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))??;
    for file in override_mods {
        if pack_client.iter().any(|m| m.file == file) {
            continue;
        }
        let sha1 = hash_bytes(HashAlgo::Sha1, &tokio::fs::read(extras.join(&file)).await?);
        pack_client.push(ModRecord {
            file,
            sha1,
            project_id: String::new(),
            version_id: String::new(),
            dependency: false,
            title: None,
            need: None,
        });
    }

    // 4) Adlar ve oyuncu ihtiyacı tek istekle (olmazsa kayıt yine yazılır).
    let mut ids: Vec<String> = server_mods
        .iter()
        .chain(&pack_client)
        .map(|m| m.project_id.clone())
        .chain(pending.iter().map(|i| i.item.project_id.clone()))
        .filter(|id| !id.is_empty())
        .collect();
    ids.sort();
    ids.dedup();
    let projects = api.projects(&ids).await.unwrap_or_default();
    for m in server_mods.iter_mut().chain(pack_client.iter_mut()) {
        if let Some(p) = projects.iter().find(|p| p.id == m.project_id) {
            m.title = Some(p.title.clone());
            m.need = Some(client_need(&p.environment, p.client_side));
        }
    }
    for i in &mut pending {
        if let Some(p) = projects.iter().find(|p| p.id == i.item.project_id) {
            i.item.title = p.title.clone();
        }
    }

    mods::save_records(meta, &server_mods)?;
    let mut record = Record::load(meta);
    record.pack_client = pack_client;
    record.pack_pending = pending;
    record.pack_client_applied = false;
    record.modpack = Some(PackOrigin {
        project_id: p.version.project_id.clone(),
        version_id: p.version.id.clone(),
        title: p.index.name.clone(),
        version_number: p.version.version_number.clone(),
    });
    record.save(meta)?;

    // Kurulum bitti: önbellekteki dosyalara gerek yok.
    for j in &jobs {
        let _ = std::fs::remove_file(cache.join(j.file.hashes.sha1.to_ascii_lowercase()));
    }
    Ok(())
}

/// Dünyanın kapağı paketin öne çıkan görseli olur (oyunda ekran görüntüsü alınınca değişir).
/// Görsel yoksa ya da inmezse kapaksız kalır.
pub async fn cover_from_project(
    app: &AppHandle,
    http: &reqwest::Client,
    id: &str,
    project_id: &str,
) -> Option<crate::instance::Instance> {
    let project = Modrinth::new(http).project(project_id).await.ok()?;
    let mut shots = project.gallery.clone();
    shots.sort_by_key(|g| (!g.featured, g.ordering));
    let url = shots
        .first()
        .map(|g| g.url.clone())
        .filter(|u| u.starts_with("https://cdn.modrinth.com/"))?;
    let tmp = std::env::temp_dir().join(format!("cubby-cover-{}", uuid::Uuid::new_v4()));
    download_file(http, &url, &tmp, None, |_, _| {})
        .await
        .ok()?;
    let inst = crate::covers::set_auto_cover(app, id, tmp.clone())
        .await
        .ok();
    let _ = std::fs::remove_file(&tmp);
    inst
}

/// Kendi dünyanda: paketin oyuncu dosyaları oyun klasörüne bir kez kopyalanır ve paketten gelen
/// kaynak paketi/shader'lar kayda geçer. İstemci eşitlemesi çağırır.
pub fn apply_client_files(meta: &Path, game_dir: &Path, shared: bool) -> AppResult<()> {
    let mut record = Record::load(meta);
    if record.modpack.is_none() || record.pack_client_applied {
        return Ok(());
    }
    let tree = meta.join(PACK_CLIENT_DIR);
    if tree.is_dir() {
        modpack::apply_client_tree(&tree, game_dir, shared)?;
    }
    record.apply_pending();
    record.save(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modrinth::{Hashes, VersionFile};

    fn version(loaders: &[&str], mc: &str, file: &str) -> Version {
        Version {
            id: "v1".into(),
            project_id: "p".into(),
            version_number: "1.0".into(),
            version_type: VersionType::Release,
            date_published: String::new(),
            dependencies: Vec::new(),
            files: vec![VersionFile {
                url: format!("https://cdn.modrinth.com/{file}"),
                filename: file.into(),
                primary: true,
                hashes: Hashes {
                    sha1: String::new(),
                    sha512: String::new(),
                },
            }],
            loaders: loaders.iter().map(|l| l.to_string()).collect(),
            game_versions: vec![mc.into()],
        }
    }

    #[test]
    fn lists_only_installable_versions() {
        assert_eq!(
            installable(&version(&["fabric"], "1.21.1", "p.mrpack"))
                .unwrap()
                .loader,
            LoaderKind::Fabric
        );
        assert!(installable(&version(&["forge"], "1.16.5", "p.mrpack")).is_err());
        assert!(installable(&version(&["neoforge"], "1.20.1", "p.mrpack")).is_err());
        assert!(installable(&version(&["fabric"], "1.21.1", "p.zip")).is_err());
        assert!(installable(&version(&["liteloader"], "1.12", "p.mrpack")).is_err());
    }

    #[test]
    fn checks_ids_and_hashes() {
        assert!(safe_id("D35n5vLL").is_ok());
        assert!(safe_id("../x").is_err());
        assert!(safe_id("").is_err());
        assert!(is_sha1("b428e5e64e16a671b7f620accffdf47b64375b92"));
        assert!(!is_sha1("../../b428e5e64e16a671b7f620accffdf47b64375"));
    }

    /// Canlı: küçük bir Fabric paketi indirilir, okunur, dosyaları geçici klasöre kurulur.
    #[tokio::test]
    #[ignore]
    async fn live_modpack_install() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let api = Modrinth::new(&http);
        let r = api
            .search_content(
                ContentKind::Modpack,
                LoaderKind::Vanilla,
                "",
                "",
                None,
                crate::modrinth::Sort::Downloads,
                0,
            )
            .await
            .unwrap();
        assert!(r.total_hits > 1000);
        // Paketlerin çoğu büyük; burada yalnız index ve ilk birkaç dosya denenir.
        let mut checked = 0;
        for hit in r.hits.iter().take(10) {
            let versions = api.all_versions(&hit.project_id).await.unwrap();
            let Some(v) = versions.iter().find(|v| installable(v).is_ok()) else {
                continue;
            };
            let file = mods::primary_file(v, "mrpack").unwrap();
            let d = std::env::temp_dir().join(format!("mcsm-live-pack-{}", uuid::Uuid::new_v4()));
            let pack = d.join("p.mrpack");
            download_file(
                &http,
                &file.url,
                &pack,
                Some((HashAlgo::Sha512, &file.hashes.sha512)),
                |_, _| {},
            )
            .await
            .unwrap();
            let index = modpack::read_index(&pack).unwrap();
            let target = modpack::target(&index.dependencies).unwrap();
            assert_eq!(Some(target.loader), modpack::loader_of(&v.loaders));
            let server = index
                .files
                .iter()
                .filter(|f| modpack::place(f) == Place::Server)
                .count();
            let client = index
                .files
                .iter()
                .filter(|f| modpack::place(f) == Place::ClientMod)
                .count();
            println!("{}: {server} sunucu, {client} oyuncu", hit.title);
            for f in index.files.iter().take(3) {
                let url = modpack::allowed_url(&f.downloads).expect("izinli adres");
                assert!(modpack::safe_rel_path(&f.path).is_some());
                download_file(
                    &http,
                    url,
                    &d.join(&f.hashes.sha1),
                    Some((HashAlgo::Sha512, &f.hashes.sha512)),
                    |_, _| {},
                )
                .await
                .unwrap();
            }
            let tree = d.join("tree");
            modpack::extract_overrides(
                &pack,
                &modpack::Targets {
                    server: &d.join("server"),
                    client: &tree,
                    client_mods: &d.join("extras"),
                },
            )
            .unwrap();
            let _ = std::fs::remove_dir_all(&d);
            checked += 1;
            if checked == 2 {
                break;
            }
        }
        assert!(checked > 0, "kurulabilir paket bulunamadı");
    }
}
