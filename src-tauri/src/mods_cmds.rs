//! Mod/eklenti mağazası komutları (Modrinth). Ağ işleri burada; saf mantık `mods/`'ta.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::loaders::LoaderKind;
use crate::modrinth::{ClientNeed, Modrinth, Sort, Version, VersionType, client_need};
use crate::mods::{self, ModRecord, Source};
use crate::paths;
use crate::sessions::META_DIR;

pub const EVENT_PROGRESS: &str = "mods://progress";
const ICON_MAX: usize = 1024 * 1024;
const BODY_MAX: usize = 6000;

/// Aynı anda tek kurulum/güncelleme (dosya yarışlarını önler).
static OPS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Proje kimliği → ikon adresi (aramadan gelir; `media://modicon/<id>` bunu kullanır).
#[derive(Default)]
pub struct ModIcons(pub Mutex<HashMap<String, String>>);

impl ModIcons {
    fn remember(&self, id: &str, url: Option<&String>) -> Option<String> {
        let url = url?;
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id.to_string(), url.clone());
        Some(format!("modicon/{id}"))
    }
}

struct Ctx {
    inst: Instance,
    meta: PathBuf,
    content: PathBuf,
}

fn ctx(app: &AppHandle, state: &AppState, id: &str) -> AppResult<Ctx> {
    let inst = instance::get(app, id)?;
    let sub = state
        .loaders
        .content_dir(inst.loader)
        .filter(|_| inst.loader != LoaderKind::Vanilla)
        .ok_or_else(|| {
            AppError::msg(tx!(
                "Saf Minecraft dünyalarına mod kurulamaz.",
                "Mods can't be installed on vanilla worlds."
            ))
        })?;
    Ok(Ctx {
        meta: paths::instance_dir(app, id)?.join(META_DIR),
        content: paths::server_dir(app, id)?.join(sub),
        inst,
    })
}

struct ModrinthSource<'a> {
    api: Modrinth<'a>,
    kind: LoaderKind,
    mc: &'a str,
}

impl Source for ModrinthSource<'_> {
    async fn pick_for(&self, project_id: &str) -> AppResult<Option<Version>> {
        let versions = self
            .api
            .project_versions(project_id, self.kind, self.mc)
            .await?;
        Ok(mods::pick_version(&versions).cloned())
    }
    async fn version(&self, version_id: &str) -> AppResult<Version> {
        self.api.version(version_id).await
    }
}

// ---- Keşfet ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HitView {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    downloads: u64,
    icon: Option<String>,
    client_need: ClientNeed,
    installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchView {
    hits: Vec<HitView>,
    total: u64,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mods_search(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
    query: String,
    category: Option<String>,
    sort: Sort,
    offset: u32,
) -> AppResult<SearchView> {
    let c = ctx(&app, &state, &id)?;
    let installed: HashSet<String> = mods::load_records(&c.meta)
        .into_iter()
        .map(|r| r.project_id)
        .collect();
    let r = Modrinth::new(&state.http)
        .search(
            c.inst.loader,
            &c.inst.mc_version,
            query.trim(),
            category.as_deref(),
            sort,
            offset,
        )
        .await?;
    Ok(SearchView {
        total: r.total_hits,
        hits: r
            .hits
            .into_iter()
            // Yalnız oyuncuda çalışan modlar sunucuya kurulmaz.
            .filter(|h| client_need(&h.environment, h.client_side) != ClientNeed::ClientOnly)
            .map(|h| HitView {
                icon: icons.remember(&h.project_id, h.icon_url.as_ref()),
                installed: installed.contains(&h.project_id),
                project_id: h.project_id,
                slug: h.slug,
                title: h.title,
                description: h.description,
                downloads: h.downloads,
                client_need: client_need(&h.environment, h.client_side),
            })
            .collect(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Named {
    project_id: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailView {
    project_id: String,
    title: String,
    description: String,
    body: String,
    downloads: u64,
    license: Option<String>,
    url: String,
    icon: Option<String>,
    client_need: ClientNeed,
    installed: bool,
    version_number: Option<String>,
    unstable: bool,
    /// Birlikte kurulacak bağımlılıklar.
    with: Vec<Named>,
    missing: Vec<Named>,
    conflicts: Vec<Named>,
    /// Kurulamıyorsa neden.
    error: Option<String>,
}

async fn names(api: &Modrinth<'_>, ids: Vec<String>) -> Vec<Named> {
    let projects = api.projects(&ids).await.unwrap_or_default();
    ids.into_iter()
        .map(|id| Named {
            title: projects
                .iter()
                .find(|p| p.id == id)
                .map_or_else(|| id.clone(), |p| p.title.clone()),
            project_id: id,
        })
        .collect()
}

#[tauri::command]
pub async fn mods_project(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
    project_id: String,
) -> AppResult<DetailView> {
    let c = ctx(&app, &state, &id)?;
    let api = Modrinth::new(&state.http);
    let p = api.project(&project_id).await?;
    let installed: HashSet<String> = mods::load_records(&c.meta)
        .into_iter()
        .map(|r| r.project_id)
        .collect();
    let src = ModrinthSource {
        api: Modrinth::new(&state.http),
        kind: c.inst.loader,
        mc: &c.inst.mc_version,
    };
    let (plan, error) = match mods::resolve(&src, &p.id, &installed).await {
        Ok(plan) => (Some(plan), None),
        Err(e) => (None, Some(e.to_string())),
    };
    let root = plan.as_ref().and_then(|pl| pl.install.first());
    let deps: Vec<String> = plan
        .as_ref()
        .map(|pl| {
            pl.install
                .iter()
                .skip(1)
                .map(|x| x.version.project_id.clone())
                .collect()
        })
        .unwrap_or_default();

    let mut body = p.body.clone();
    if body.len() > BODY_MAX {
        let cut = (0..=BODY_MAX)
            .rev()
            .find(|i| body.is_char_boundary(*i))
            .unwrap_or(0);
        body.truncate(cut);
        body.push('…');
    }
    Ok(DetailView {
        icon: icons.remember(&p.id, p.icon_url.as_ref()),
        installed: installed.contains(&p.id),
        version_number: root.map(|r| r.version.version_number.clone()),
        unstable: root.is_some_and(|r| r.version.version_type != VersionType::Release),
        with: names(&api, deps).await,
        missing: names(
            &api,
            plan.as_ref()
                .map(|pl| pl.missing.clone())
                .unwrap_or_default(),
        )
        .await,
        conflicts: names(
            &api,
            plan.as_ref()
                .map(|pl| pl.conflicts.clone())
                .unwrap_or_default(),
        )
        .await,
        url: format!("https://modrinth.com/project/{}", p.slug),
        license: p
            .license
            .map(|l| if l.name.is_empty() { l.id } else { l.name }),
        project_id: p.id,
        title: p.title,
        description: p.description,
        body,
        downloads: p.downloads,
        client_need: client_need(&p.environment, p.client_side),
        error,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload<'a> {
    id: &'a str,
    title: &'a str,
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub async fn mods_install(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
    project_id: String,
) -> AppResult<Vec<InstalledView>> {
    let _guard = OPS.lock().await;
    let c = ctx(&app, &state, &id)?;
    let mut records = mods::reconcile(mods::load_records(&c.meta), &mods::scan(&c.content));
    let installed: HashSet<String> = records.iter().map(|r| r.project_id.clone()).collect();
    let src = ModrinthSource {
        api: Modrinth::new(&state.http),
        kind: c.inst.loader,
        mc: &c.inst.mc_version,
    };
    let plan = mods::resolve(&src, &project_id, &installed).await?;
    if !plan.conflicts.is_empty() {
        let list: Vec<String> = names(&src.api, plan.conflicts.clone())
            .await
            .into_iter()
            .map(|n| n.title)
            .collect();
        return Err(AppError::msg(tx!(
            "Bu mod kurulu olan şununla uyumsuz: {}. Önce onu kaldır.",
            "This mod is incompatible with an installed one: {}. Remove that first.",
            list.join(", ")
        )));
    }

    let titles = names(
        &src.api,
        plan.install
            .iter()
            .map(|p| p.version.project_id.clone())
            .collect(),
    )
    .await;
    for (pick, named) in plan.install.iter().zip(&titles) {
        let mut rec = mods::download_into(
            &state.http,
            &c.meta,
            &c.content,
            &pick.version,
            None,
            |downloaded, total| {
                let _ = app.emit(
                    EVENT_PROGRESS,
                    ProgressPayload {
                        id: &id,
                        title: &named.title,
                        downloaded,
                        total,
                    },
                );
            },
        )
        .await?;
        rec.dependency = pick.dependency;
        records.retain(|r| r.file != rec.file && r.project_id != rec.project_id);
        records.push(rec);
        mods::save_records(&c.meta, &records)?;
    }
    crate::client_cmds::spawn_sync(&app, &id);
    installed_view(&app, &state, &icons, &id, false).await
}

// ---- Kurulu ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledView {
    file: String,
    title: String,
    project_id: Option<String>,
    version_number: Option<String>,
    icon: Option<String>,
    client_need: Option<ClientNeed>,
    dependency: bool,
    /// Modrinth'te tanındı mı (değilse elle eklenmiş).
    known: bool,
    /// Daha yeni bir sürüm varsa numarası.
    update: Option<String>,
}

async fn installed_view(
    app: &AppHandle,
    state: &AppState,
    icons: &ModIcons,
    id: &str,
    check_updates: bool,
) -> AppResult<Vec<InstalledView>> {
    let c = ctx(app, state, id)?;
    let api = Modrinth::new(&state.http);
    let files = mods::scan(&c.content);
    let mut records = mods::reconcile(mods::load_records(&c.meta), &files);

    // Kayıtta olmayan dosyaları hash ile tanı.
    let unknown: Vec<String> = files
        .iter()
        .filter(|(_, s)| !records.iter().any(|r| &r.sha1 == s))
        .map(|(_, s)| s.clone())
        .collect();
    if let Ok(found) = api.version_files(&unknown).await {
        for (file, sha1) in &files {
            if let Some(v) = found.get(sha1) {
                records.push(ModRecord {
                    file: file.clone(),
                    sha1: sha1.clone(),
                    project_id: v.project_id.clone(),
                    version_id: v.id.clone(),
                    dependency: false,
                    title: None,
                    need: None,
                });
            }
        }
    }
    let ids: Vec<String> = records
        .iter()
        .map(|r| r.project_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let projects = api.projects(&ids).await.unwrap_or_default();
    // Ad ve oyuncu ihtiyacı kayda yazılır: oyuncuya mod gönderirken ağ gerekmesin.
    for r in records.iter_mut() {
        if let Some(p) = projects.iter().find(|p| p.id == r.project_id) {
            r.title = Some(p.title.clone());
            r.need = Some(client_need(&p.environment, p.client_side));
        }
    }
    let _ = mods::save_records(&c.meta, &records);
    let shas: Vec<String> = records.iter().map(|r| r.sha1.clone()).collect();
    let latest = if check_updates {
        api.latest_for(&shas, c.inst.loader, &c.inst.mc_version)
            .await
            .unwrap_or_default()
    } else {
        HashMap::new()
    };
    let vids: Vec<String> = records.iter().map(|r| r.version_id.clone()).collect();
    let versions = api.versions(&vids).await.unwrap_or_default();

    Ok(files
        .into_iter()
        .map(|(file, sha1)| {
            let rec = records.iter().find(|r| r.sha1 == sha1);
            let project = rec.and_then(|r| projects.iter().find(|p| p.id == r.project_id));
            let update = rec
                .and_then(|r| latest.get(&r.sha1))
                .filter(|v| Some(&v.id) != rec.map(|r| &r.version_id));
            InstalledView {
                title: project.map_or_else(
                    || file.trim_end_matches(".jar").to_string(),
                    |p| p.title.clone(),
                ),
                icon: project.and_then(|p| icons.remember(&p.id, p.icon_url.as_ref())),
                client_need: project.map(|p| client_need(&p.environment, p.client_side)),
                project_id: rec.map(|r| r.project_id.clone()),
                version_number: rec
                    .and_then(|r| versions.iter().find(|v| v.id == r.version_id))
                    .map(|v| v.version_number.clone()),
                dependency: rec.is_some_and(|r| r.dependency),
                known: rec.is_some(),
                update: update.map(|v| v.version_number.clone()),
                file,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn mods_installed(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
) -> AppResult<Vec<InstalledView>> {
    installed_view(&app, &state, &icons, &id, true).await
}

#[tauri::command]
pub async fn mods_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
    file: String,
) -> AppResult<Vec<InstalledView>> {
    let _guard = OPS.lock().await;
    let c = ctx(&app, &state, &id)?;
    let name = mods::sanitize_filename(&file)
        .ok_or_else(|| AppError::msg(tx!("Geçersiz dosya adı.", "Invalid file name.")))?;
    let path = c.content.join(&name);
    if path.exists() {
        trash::delete(&path)
            .map_err(|e| AppError::msg(tx!("Kaldırılamadı: {e}", "Couldn't remove: {e}")))?;
    }
    let records: Vec<ModRecord> = mods::load_records(&c.meta)
        .into_iter()
        .filter(|r| r.file != name)
        .collect();
    mods::save_records(&c.meta, &records)?;
    crate::client_cmds::spawn_sync(&app, &id);
    installed_view(&app, &state, &icons, &id, false).await
}

async fn update_one(
    app: &AppHandle,
    state: &AppState,
    c: &Ctx,
    id: &str,
    file: &str,
) -> AppResult<()> {
    let api = Modrinth::new(&state.http);
    let mut records = mods::load_records(&c.meta);
    let rec = records
        .iter()
        .find(|r| r.file == file)
        .cloned()
        .ok_or_else(|| {
            AppError::msg(tx!(
                "Bu dosya Modrinth'te tanınmadı; elle güncellemen gerekiyor.",
                "Modrinth doesn't recognize this file; you'll need to update it by hand."
            ))
        })?;
    let latest = api
        .latest_for(
            std::slice::from_ref(&rec.sha1),
            c.inst.loader,
            &c.inst.mc_version,
        )
        .await?;
    let Some(v) = latest.get(&rec.sha1).filter(|v| v.id != rec.version_id) else {
        return Ok(());
    };
    let title = api
        .project(&v.project_id)
        .await
        .map(|p| p.title)
        .unwrap_or_else(|_| file.to_string());
    let mut new = mods::download_into(
        &state.http,
        &c.meta,
        &c.content,
        v,
        Some(file),
        |downloaded, total| {
            let _ = app.emit(
                EVENT_PROGRESS,
                ProgressPayload {
                    id,
                    title: &title,
                    downloaded,
                    total,
                },
            );
        },
    )
    .await?;
    new.dependency = rec.dependency;
    records.retain(|r| r.file != file && r.file != new.file);
    records.push(new);
    mods::save_records(&c.meta, &records)
}

#[tauri::command]
pub async fn mods_update(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
    file: String,
) -> AppResult<Vec<InstalledView>> {
    let _guard = OPS.lock().await;
    let c = ctx(&app, &state, &id)?;
    update_one(&app, &state, &c, &id, &file).await?;
    crate::client_cmds::spawn_sync(&app, &id);
    installed_view(&app, &state, &icons, &id, true).await
}

#[tauri::command]
pub async fn mods_update_all(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    id: String,
) -> AppResult<Vec<InstalledView>> {
    let _guard = OPS.lock().await;
    let c = ctx(&app, &state, &id)?;
    let files: Vec<String> = mods::load_records(&c.meta)
        .into_iter()
        .map(|r| r.file)
        .collect();
    for f in files {
        update_one(&app, &state, &c, &id, &f).await?;
    }
    crate::client_cmds::spawn_sync(&app, &id);
    installed_view(&app, &state, &icons, &id, true).await
}

// ---- İkonlar (media://modicon/<id>) ----

fn mime(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => Some("image/webp"),
        _ => None,
    }
}

fn image_response(bytes: Vec<u8>) -> Response<Vec<u8>> {
    match mime(&bytes) {
        Some(m) => Response::builder()
            .header("Content-Type", m)
            .header("Cache-Control", "max-age=86400")
            .body(bytes)
            .unwrap(),
        None => not_found(),
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap()
}

pub fn is_icon_path(path: &str) -> Option<String> {
    let id = path.strip_prefix("/modicon/")?;
    (!id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric()))
        .then(|| id.to_string())
}

/// Önbellekte varsa oradan, yoksa Modrinth CDN'inden indirip önbelleğe yazar.
pub async fn icon_response(app: &AppHandle, project_id: &str) -> Response<Vec<u8>> {
    let Ok(dir) = app
        .path()
        .app_data_dir()
        .map(|d| d.join("cache").join("modicons"))
    else {
        return not_found();
    };
    let file = dir.join(project_id);
    if let Ok(bytes) = std::fs::read(&file) {
        return image_response(bytes);
    }
    let url = app
        .state::<ModIcons>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(project_id)
        .cloned();
    let Some(url) = url.filter(|u| u.starts_with("https://cdn.modrinth.com/")) else {
        return not_found();
    };
    let http = app.state::<AppState>().http.clone();
    let Ok(resp) = http
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
    else {
        return not_found();
    };
    if resp.content_length().is_some_and(|l| l as usize > ICON_MAX) {
        return not_found();
    }
    let Ok(bytes) = resp.bytes().await else {
        return not_found();
    };
    if bytes.len() > ICON_MAX || mime(&bytes).is_none() {
        return not_found();
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&file, &bytes);
    image_response(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_paths_and_mime() {
        assert_eq!(
            is_icon_path("/modicon/P7dR8mSH").as_deref(),
            Some("P7dR8mSH")
        );
        assert!(is_icon_path("/modicon/../x").is_none());
        assert!(is_icon_path("/modicon/").is_none());
        assert_eq!(mime(&[0x89, b'P', b'N', b'G', 0]), Some("image/png"));
        assert_eq!(mime(b"RIFF\0\0\0\0WEBPVP8"), Some("image/webp"));
        assert_eq!(mime(b"<svg"), None);
    }

    /// Canlı: Chunky (Fabric API ister) geçici klasöre kurulur, hash'ler doğrulanır,
    /// dosyalar Modrinth'te tanınır ve güncelleme kontrolü çalışır.
    #[tokio::test]
    #[ignore]
    async fn live_install_with_dependency() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let base = std::env::temp_dir().join(format!("mcsm-modinstall-{}", uuid::Uuid::new_v4()));
        let (meta, content) = (base.join("meta"), base.join("mods"));
        let src = ModrinthSource {
            api: Modrinth::new(&http),
            kind: LoaderKind::Fabric,
            mc: "26.3",
        };
        let plan = mods::resolve(&src, "chunky", &HashSet::new())
            .await
            .unwrap();
        let ids: Vec<_> = plan
            .install
            .iter()
            .map(|p| p.version.project_id.as_str())
            .collect();
        println!("kurulacak: {ids:?}");
        assert!(
            ids.contains(&"P7dR8mSH"),
            "Fabric API bağımlılığı bulunmalı"
        );

        for pick in &plan.install {
            let rec = mods::download_into(&http, &meta, &content, &pick.version, None, |_, _| {})
                .await
                .unwrap();
            println!("kuruldu: {}", rec.file);
        }
        let files = mods::scan(&content);
        assert_eq!(files.len(), plan.install.len());
        let shas: Vec<String> = files.iter().map(|(_, s)| s.clone()).collect();
        let known = src.api.version_files(&shas).await.unwrap();
        assert_eq!(known.len(), files.len());
        let latest = src
            .api
            .latest_for(&shas, LoaderKind::Fabric, "26.3")
            .await
            .unwrap();
        assert_eq!(latest.len(), files.len());
        // Aynı sürümü ikinci kez kurmak indirme yapmadan geçer.
        mods::download_into(
            &http,
            &meta,
            &content,
            &plan.install[0].version,
            None,
            |_, _| panic!("indirmemeli"),
        )
        .await
        .unwrap();
    }
}
