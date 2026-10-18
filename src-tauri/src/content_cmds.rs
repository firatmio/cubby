//! Keşfet'in paket komutları: kaynak paketleri, shader'lar ve veri paketleri (Modrinth).
//! Modlar kendi komutlarında (`mods_cmds`); arama/önizleme yardımcıları oradan paylaşılır.
//!
//! `world`: kendi dünyanın kimliği ya da `join:<id>` (arkadaşının dünyası).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::client::{self, Launcher, Wanted};
use crate::commands::AppState;
use crate::content::{self, EXTRAS_DIR, Item, Record};
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::join::{JoinManager, JoinedWorld};
use crate::loaders::LoaderKind;
use crate::modrinth::{ContentKind, Modrinth, Sort, Version, VersionType};
use crate::mods::{self, ModRecord};
use crate::mods_cmds::{
    EVENT_PROGRESS, InfoView, ModIcons, ModImages, ModrinthSource, OPS, PlanView, SearchView,
    hit_view, names, project_info,
};
use crate::paths;
use crate::sessions::META_DIR;

/// Keşfet'in seçili dünyası: kendi dünyan ya da katıldığın.
struct World {
    /// İstemci eşitlemesindeki dünya anahtarı (kendi dünyanda kimlik, katılınanda `join_key`).
    key: String,
    /// `content.json` ve shader ekstralarının klasörü.
    dir: PathBuf,
    name: String,
    loader: LoaderKind,
    mc: String,
    own: Option<Instance>,
}

async fn world(app: &AppHandle, id: &str) -> AppResult<World> {
    if let Some(jid) = id.strip_prefix("join:") {
        paths::validate_id(jid)?;
        let w: JoinedWorld = app.state::<Arc<JoinManager>>().get(jid).await?;
        return Ok(World {
            key: crate::join_cmds::join_key(&w.host, &w.world),
            dir: app.path().app_data_dir()?.join("joined").join(jid),
            name: w.name,
            loader: w.loader,
            mc: w.mc_version,
            own: None,
        });
    }
    let inst = instance::get(app, id)?;
    Ok(World {
        key: inst.id.clone(),
        dir: paths::instance_dir(app, id)?.join(META_DIR),
        name: inst.name.clone(),
        loader: inst.loader,
        mc: inst.mc_version.clone(),
        own: Some(inst),
    })
}

/// Oyuncunun bu dünya için kullandığı oyun klasörü; modluysa mods klasörü ve ortak mı.
struct Game {
    dir: PathBuf,
    mods: Option<(PathBuf, bool)>,
}

fn game(app: &AppHandle, w: &World) -> AppResult<Game> {
    let target = crate::client_cmds::target(app)?;
    let modded = w.loader.is_modded();
    let (dir, mods) = target.dirs(&crate::client_cmds::dir_name(&w.name, &w.key), modded);
    if let crate::client_cmds::Target::Mc {
        mc,
        launcher: Launcher::Official,
    } = &target
        && modded
    {
        client::prepare_game_dir(mc, &dir)?;
    }
    Ok(Game {
        dir,
        mods: modded.then(|| (mods, target.shared())),
    })
}

/// Paketin kurulacağı klasör.
fn target(app: &AppHandle, w: &World, kind: ContentKind) -> AppResult<PathBuf> {
    match kind {
        ContentKind::ResourcePack => Ok(game(app, w)?.dir.join("resourcepacks")),
        ContentKind::Shader => Ok(game(app, w)?.dir.join("shaderpacks")),
        ContentKind::DataPack => {
            let inst = w.own.as_ref().ok_or_else(not_here)?;
            Ok(content::datapacks_dir(&paths::server_dir(app, &inst.id)?))
        }
        ContentKind::Mod | ContentKind::Modpack => Err(not_here()),
    }
}

fn not_here() -> AppError {
    AppError::msg(tx!(
        "Bu içerik bu dünyaya kurulamaz.",
        "This content can't be installed on this world."
    ))
}

fn check_kind(w: &World, kind: ContentKind) -> AppResult<()> {
    let ok = match kind {
        ContentKind::ResourcePack => true,
        ContentKind::Shader => w.loader.is_modded(),
        ContentKind::DataPack => w.own.is_some(),
        ContentKind::Mod | ContentKind::Modpack => false,
    };
    ok.then_some(()).ok_or_else(not_here)
}

/// Forge'da Iris yok; Oculus (aynı shader'ları çalıştırır) kullanılır.
fn shader_loader(loader: LoaderKind) -> &'static str {
    if loader == LoaderKind::Forge {
        "oculus"
    } else {
        "iris"
    }
}

/// En uygun sürüm (dünyanın Minecraft sürümüne ve türün yükleyicisine göre).
async fn pick(
    api: &Modrinth<'_>,
    w: &World,
    kind: ContentKind,
    project_id: &str,
) -> AppResult<Version> {
    let versions = api
        .project_versions_for(project_id, kind.loaders(w.loader), &w.mc)
        .await?;
    mods::pick_version_ext(&versions, kind.ext())
        .cloned()
        .ok_or_else(|| {
            AppError::msg(tx!(
                "Bu paket dünyanın sürümü için yayınlanmamış.",
                "This pack isn't released for the world's version."
            ))
        })
}

/// Shader yükleyicisi (Iris/Oculus) ve bağımlılıkları; zaten kuruluysa boş.
async fn shader_plan(http: &reqwest::Client, w: &World, record: &Record) -> AppResult<mods::Plan> {
    let installed: HashSet<String> = record
        .client_mods
        .iter()
        .map(|m| m.project_id.clone())
        .collect();
    if !record.client_mods.is_empty() {
        return Ok(mods::Plan::default());
    }
    let src = ModrinthSource {
        api: Modrinth::new(http),
        kind: w.loader,
        mc: &w.mc,
    };
    mods::resolve(&src, shader_loader(w.loader), &installed)
        .await
        .map_err(|_| {
            AppError::msg(tx!(
                "Bu sürüm için shader desteği henüz yok.",
                "There's no shader support for this version yet."
            ))
        })
}

fn progress(app: &AppHandle, id: &str, title: &str) -> impl FnMut(u64, Option<u64>) {
    let (app, id, title) = (app.clone(), id.to_string(), title.to_string());
    move |downloaded, total| {
        let _ = app.emit(
            EVENT_PROGRESS,
            serde_json::json!({ "id": id, "title": title, "downloaded": downloaded, "total": total }),
        );
    }
}

// ---- Arama ve önizleme ----

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn content_search(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    images: State<'_, ModImages>,
    world: String,
    kind: ContentKind,
    query: String,
    category: Option<String>,
    sort: Sort,
    offset: u32,
) -> AppResult<SearchView> {
    // Mod paketleri dünyadan bağımsız (yeni dünya olarak kurulur).
    if kind == ContentKind::Modpack {
        let r = Modrinth::new(&state.http)
            .search_content(
                kind,
                LoaderKind::Vanilla,
                "",
                query.trim(),
                category.as_deref(),
                sort,
                offset,
            )
            .await?;
        return Ok(SearchView {
            total: r.total_hits,
            hits: r
                .hits
                .into_iter()
                .map(|h| hit_view(h, false, &icons, &images))
                .collect(),
        });
    }
    let w = self::world(&app, &world).await?;
    check_kind(&w, kind)?;
    let record = Record::load(&w.dir);
    let installed: HashSet<&str> = record
        .items(kind)
        .iter()
        .map(|i| i.project_id.as_str())
        .collect();
    let r = Modrinth::new(&state.http)
        .search_content(
            kind,
            w.loader,
            &w.mc,
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
            .map(|h| {
                let i = installed.contains(h.project_id.as_str());
                hit_view(h, i, &icons, &images)
            })
            .collect(),
    })
}

#[tauri::command]
pub async fn content_project(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    images: State<'_, ModImages>,
    world: String,
    kind: ContentKind,
    project_id: String,
) -> AppResult<InfoView> {
    if kind == ContentKind::Modpack {
        return project_info(&state.http, &icons, &images, &project_id, &HashSet::new()).await;
    }
    let w = self::world(&app, &world).await?;
    let installed: HashSet<String> = Record::load(&w.dir)
        .items(kind)
        .iter()
        .map(|i| i.project_id.clone())
        .collect();
    project_info(&state.http, &icons, &images, &project_id, &installed).await
}

#[tauri::command]
pub async fn content_plan(
    app: AppHandle,
    state: State<'_, AppState>,
    world: String,
    kind: ContentKind,
    project_id: String,
) -> AppResult<PlanView> {
    let w = self::world(&app, &world).await?;
    check_kind(&w, kind)?;
    let api = Modrinth::new(&state.http);
    let mut view = PlanView {
        version_number: None,
        unstable: false,
        with: Vec::new(),
        missing: Vec::new(),
        conflicts: Vec::new(),
        error: None,
    };
    match pick(&api, &w, kind, &project_id).await {
        Ok(v) => {
            view.version_number = Some(v.version_number.clone());
            view.unstable = v.version_type != VersionType::Release;
        }
        Err(e) => view.error = Some(e.to_string()),
    }
    if kind == ContentKind::Shader && view.error.is_none() {
        match shader_plan(&state.http, &w, &Record::load(&w.dir)).await {
            Ok(plan) => {
                let ids = plan
                    .install
                    .iter()
                    .map(|p| p.version.project_id.clone())
                    .collect();
                view.with = names(&api, ids).await;
            }
            Err(e) => view.error = Some(e.to_string()),
        }
    }
    Ok(view)
}

// ---- Kurulu olanlar ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackView {
    file: String,
    title: String,
    project_id: Option<String>,
    version_number: Option<String>,
    icon: Option<String>,
    client_need: Option<()>,
    dependency: bool,
    known: bool,
    update: Option<String>,
    /// Etkin shader.
    active: bool,
    /// Sunucunun girenlere zorunlu gönderdiği kaynak paketi.
    forced: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackList {
    items: Vec<PackView>,
    /// Kullanıcıya kısa bilgi (ör. "Minecraft açık; yeniden açınca etkin olur").
    note: Option<String>,
}

async fn pack_list(
    app: &AppHandle,
    state: &AppState,
    icons: &ModIcons,
    w: &World,
    kind: ContentKind,
    check_updates: bool,
    note: Option<String>,
) -> AppResult<PackList> {
    let dir = target(app, w, kind)?;
    let mut record = Record::load(&w.dir);
    let before = record.clone();
    record.prune(kind, &dir);
    if record != before {
        record.save(&w.dir)?;
    }
    let items = record.items(kind);
    let api = Modrinth::new(&state.http);
    let ids: Vec<String> = items.iter().map(|i| i.project_id.clone()).collect();
    let projects = api.projects(&ids).await.unwrap_or_default();
    let latest = if check_updates {
        let shas: Vec<String> = items.iter().map(|i| i.sha1.clone()).collect();
        api.latest_for_loaders(&shas, kind.loaders(w.loader), &w.mc)
            .await
            .unwrap_or_default()
    } else {
        Default::default()
    };
    let vids: Vec<String> = items.iter().map(|i| i.version_id.clone()).collect();
    let versions = api.versions(&vids).await.unwrap_or_default();
    Ok(PackList {
        items: items
            .iter()
            .map(|i| {
                let project = projects.iter().find(|p| p.id == i.project_id);
                PackView {
                    title: project.map_or_else(|| i.title.clone(), |p| p.title.clone()),
                    icon: project.and_then(|p| icons.remember(&p.id, p.icon_url.as_ref())),
                    project_id: Some(i.project_id.clone()),
                    version_number: versions
                        .iter()
                        .find(|v| v.id == i.version_id)
                        .map(|v| v.version_number.clone()),
                    client_need: None,
                    dependency: false,
                    known: true,
                    update: latest
                        .get(&i.sha1)
                        .filter(|v| v.id != i.version_id)
                        .map(|v| v.version_number.clone()),
                    active: record.active_shader.as_deref() == Some(i.file.as_str()),
                    forced: record.forced_pack.as_deref() == Some(i.file.as_str()),
                    file: i.file.clone(),
                }
            })
            .collect(),
        note,
    })
}

#[tauri::command]
pub async fn content_installed(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    world: String,
    kind: ContentKind,
) -> AppResult<PackList> {
    let w = self::world(&app, &world).await?;
    check_kind(&w, kind)?;
    pack_list(&app, &state, &icons, &w, kind, true, None).await
}

// ---- Kurma, kaldırma, güncelleme ----

/// Oyun açıkken ayar dosyaları değiştirilmez (Minecraft kapanırken kendi ayarlarını yazar).
fn game_closed() -> bool {
    !crate::join::client::minecraft_running()
}

fn running_note() -> String {
    tx!(
        "Minecraft açık: oyunu yeniden açınca ya da Seçenekler'den etkinleştirebilirsin.",
        "Minecraft is running: it'll be active next time you open the game, or turn it on in Options."
    )
}

/// Sunucu açıksa veri paketlerini yeniden yükler (değişiklik hemen geçerli olsun).
async fn reload_datapacks(app: &AppHandle, state: &AppState, w: &World) {
    if let Some(inst) = &w.own {
        let _ = state.servers.send_command(app, &inst.id, "reload").await;
    }
}

/// Kaynak paketi zorunluysa sunucu ayarlarına yazar (ya da temizler).
fn write_forced_pack(app: &AppHandle, w: &World, item: Option<&Item>) -> AppResult<()> {
    let inst = w.own.as_ref().ok_or_else(not_here)?;
    let server_dir = paths::server_dir(app, &inst.id)?;
    let mut props = crate::properties::Properties::load(&server_dir)?;
    match item {
        Some(i) => {
            props.set("resource-pack", i.url.as_str());
            props.set("resource-pack-sha1", i.sha1.as_str());
            props.set("require-resource-pack", "true");
        }
        None => {
            props.set("resource-pack", "");
            props.set("resource-pack-sha1", "");
            props.set("require-resource-pack", "false");
        }
    }
    props.save(&server_dir)
}

/// Shader ekstralarını (Iris, Sodium…) oyuncunun Minecraft'ına eşitler.
/// Kendi dünyanda olağan eşitleme (ekstraları da içerir); katılınan dünyada yalnız ekstralar
/// değişir, arkadaşının modlarına dokunulmaz.
async fn sync_extras(app: &AppHandle, w: &World, dropped: &[String]) -> AppResult<()> {
    if let Some(inst) = &w.own {
        crate::client_cmds::spawn_sync(app, &inst.id);
        return Ok(());
    }
    let Some((mods_dir, shared)) = game(app, w)?.mods else {
        return Ok(());
    };
    let record = Record::load(&w.dir);
    let mut wanted: Vec<Wanted> = client::load_record(&mods_dir)
        .files
        .into_iter()
        .filter(|m| m.world == w.key && !dropped.contains(&m.sha1))
        .map(|m| Wanted {
            file: m.file,
            sha1: m.sha1,
        })
        .collect();
    for m in &record.client_mods {
        if !wanted.iter().any(|x| x.sha1 == m.sha1) {
            wanted.push(Wanted {
                file: m.file.clone(),
                sha1: m.sha1.clone(),
            });
        }
    }
    let extras = w.dir.join(EXTRAS_DIR);
    client::sync(&mods_dir, &w.key, &wanted, shared, move |want, dest| {
        let from = extras.join(&want.file);
        async move {
            std::fs::copy(from, dest)?;
            Ok(())
        }
    })
    .await?;
    Ok(())
}

/// İstemci eşitlemesine eklenecek ekstralar ve kopyalanacakları klasör (kendi ya da katılınan dünya):
/// shader modları ve mod paketinin yalnız oyuncuda çalışan modları.
pub fn extras_for(dir: &Path) -> (Vec<Wanted>, PathBuf) {
    let record = Record::load(dir);
    let mut wanted: Vec<Wanted> = Vec::new();
    for m in record.client_mods.into_iter().chain(record.pack_client) {
        if !wanted.iter().any(|w| w.sha1 == m.sha1) {
            wanted.push(Wanted {
                file: m.file,
                sha1: m.sha1,
            });
        }
    }
    (wanted, dir.join(EXTRAS_DIR))
}

/// Katılınan dünyanın paket klasörü (ekstralar için `join_cmds` kullanır).
pub fn joined_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("joined").join(id))
}

#[tauri::command]
pub async fn content_install(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    world: String,
    kind: ContentKind,
    project_id: String,
) -> AppResult<PackList> {
    let _guard = OPS.lock().await;
    let w = self::world(&app, &world).await?;
    check_kind(&w, kind)?;
    let api = Modrinth::new(&state.http);
    let version = pick(&api, &w, kind, &project_id).await?;
    let title = names(&api, vec![version.project_id.clone()])
        .await
        .into_iter()
        .next()
        .map(|n| n.title)
        .unwrap_or_default();
    let mut record = Record::load(&w.dir);

    // Shader: önce yükleyicisi (Iris/Oculus + bağımlılıkları), oyuncunun Minecraft'ına gidecek ekstralar.
    let mut extras_changed = false;
    if kind == ContentKind::Shader {
        let plan = shader_plan(&state.http, &w, &record).await?;
        let titles = names(
            &api,
            plan.install
                .iter()
                .map(|p| p.version.project_id.clone())
                .collect(),
        )
        .await;
        for (p, named) in plan.install.iter().zip(&titles) {
            let mut rec: ModRecord = mods::download_into(
                &state.http,
                &w.dir,
                &w.dir.join(EXTRAS_DIR),
                &p.version,
                None,
                progress(&app, &world, &named.title),
            )
            .await?;
            rec.dependency = p.dependency;
            rec.title = Some(named.title.clone());
            record
                .client_mods
                .retain(|m| m.project_id != rec.project_id);
            record.client_mods.push(rec);
            extras_changed = true;
        }
    }

    let dir = target(&app, &w, kind)?;
    let old = record
        .items(kind)
        .iter()
        .find(|i| i.project_id == version.project_id)
        .map(|i| i.file.clone());
    let rec = mods::download_into_ext(
        &state.http,
        &w.dir,
        &dir,
        &version,
        kind.ext(),
        old.as_deref(),
        progress(&app, &world, &title),
    )
    .await?;
    let url = mods::primary_file(&version, kind.ext())
        .map(|f| f.url.clone())
        .unwrap_or_default();
    let item = Item {
        file: rec.file.clone(),
        sha1: rec.sha1.clone(),
        project_id: rec.project_id.clone(),
        version_id: rec.version_id.clone(),
        title,
        url,
    };
    record
        .items_mut(kind)
        .retain(|i| i.project_id != item.project_id);
    record.items_mut(kind).push(item.clone());

    let mut note = None;
    match kind {
        ContentKind::ResourcePack => {
            if game_closed() {
                let game_dir = game(&app, &w)?.dir;
                content::edit_options(&game_dir, |t| {
                    let t = old
                        .as_deref()
                        .map_or(t.to_string(), |o| content::disable_pack(t, o));
                    content::enable_pack(&t, &item.file)
                })?;
            } else {
                note = Some(running_note());
            }
            // Zorunlu paket güncellendiyse sunucuya yeni adres yazılır.
            if old.is_some() && record.forced_pack == old {
                record.forced_pack = Some(item.file.clone());
                write_forced_pack(&app, &w, Some(&item))?;
            }
        }
        ContentKind::Shader => {
            record.active_shader = Some(item.file.clone());
            if game_closed() {
                let cfg =
                    content::shader_config(&game(&app, &w)?.dir, w.loader == LoaderKind::Forge);
                content::set_shader(&cfg, Some(&item.file))?;
            } else {
                note = Some(running_note());
            }
        }
        ContentKind::DataPack => reload_datapacks(&app, &state, &w).await,
        ContentKind::Mod | ContentKind::Modpack => {}
    }
    record.save(&w.dir)?;
    if extras_changed {
        sync_extras(&app, &w, &[]).await?;
    }
    pack_list(&app, &state, &icons, &w, kind, false, note).await
}

#[tauri::command]
pub async fn content_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    world: String,
    kind: ContentKind,
    file: String,
) -> AppResult<PackList> {
    let _guard = OPS.lock().await;
    let w = self::world(&app, &world).await?;
    check_kind(&w, kind)?;
    let mut record = Record::load(&w.dir);
    // Yalnız kayıttaki dosyalar silinir (yol dışına çıkılamaz).
    if !record.items(kind).iter().any(|i| i.file == file) {
        return Err(AppError::msg(tx!(
            "Geçersiz dosya adı.",
            "Invalid file name."
        )));
    }
    let dir = target(&app, &w, kind)?;
    let path = dir.join(&file);
    if path.exists() {
        trash::delete(&path)
            .map_err(|e| AppError::msg(tx!("Kaldırılamadı: {e}", "Couldn't remove: {e}")))?;
    }
    record.items_mut(kind).retain(|i| i.file != file);

    let mut dropped = Vec::new();
    match kind {
        ContentKind::ResourcePack => {
            if game_closed() {
                content::edit_options(&game(&app, &w)?.dir, |t| content::disable_pack(t, &file))?;
            }
            if record.forced_pack.as_deref() == Some(file.as_str()) {
                record.forced_pack = None;
                write_forced_pack(&app, &w, None)?;
            }
        }
        ContentKind::Shader => {
            if record.active_shader.as_deref() == Some(file.as_str()) {
                // Başka shader kaldıysa en son kurulan etkin olur; yoksa shader'lar kapanır.
                record.active_shader = record.shaders.last().map(|s| s.file.clone());
                if game_closed() {
                    let cfg =
                        content::shader_config(&game(&app, &w)?.dir, w.loader == LoaderKind::Forge);
                    content::set_shader(&cfg, record.active_shader.as_deref())?;
                }
            }
            // Son shader gidince Iris/Sodium da oyuncunun Minecraft'ından kalkar.
            if record.shaders.is_empty() {
                dropped = record.client_mods.drain(..).map(|m| m.sha1).collect();
            }
        }
        ContentKind::DataPack => reload_datapacks(&app, &state, &w).await,
        ContentKind::Mod | ContentKind::Modpack => {}
    }
    record.save(&w.dir)?;
    if !dropped.is_empty() {
        sync_extras(&app, &w, &dropped).await?;
    }
    pack_list(&app, &state, &icons, &w, kind, false, None).await
}

#[tauri::command]
pub async fn content_update(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    world: String,
    kind: ContentKind,
    file: String,
) -> AppResult<PackList> {
    let w = self::world(&app, &world).await?;
    let project = Record::load(&w.dir)
        .items(kind)
        .iter()
        .find(|i| i.file == file)
        .map(|i| i.project_id.clone())
        .ok_or_else(|| AppError::msg(tx!("Geçersiz dosya adı.", "Invalid file name.")))?;
    // Kurulum eski dosyanın yerine yenisini koyar, etkinliği ve zorunluluğu taşır.
    content_install(app, state, icons, world, kind, project).await
}

#[tauri::command]
pub async fn content_activate_shader(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    world: String,
    file: String,
) -> AppResult<PackList> {
    let w = self::world(&app, &world).await?;
    check_kind(&w, ContentKind::Shader)?;
    let mut record = Record::load(&w.dir);
    if !record.shaders.iter().any(|s| s.file == file) {
        return Err(AppError::msg(tx!(
            "Geçersiz dosya adı.",
            "Invalid file name."
        )));
    }
    record.active_shader = Some(file.clone());
    record.save(&w.dir)?;
    let note = if game_closed() {
        let cfg = content::shader_config(&game(&app, &w)?.dir, w.loader == LoaderKind::Forge);
        content::set_shader(&cfg, Some(&file))?;
        None
    } else {
        Some(running_note())
    };
    pack_list(&app, &state, &icons, &w, ContentKind::Shader, false, note).await
}

#[tauri::command]
pub async fn content_force_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    icons: State<'_, ModIcons>,
    world: String,
    file: Option<String>,
) -> AppResult<PackList> {
    let w = self::world(&app, &world).await?;
    if w.own.is_none() {
        return Err(not_here());
    }
    let mut record = Record::load(&w.dir);
    let item = match &file {
        Some(f) => Some(
            record
                .resourcepacks
                .iter()
                .find(|i| &i.file == f)
                .cloned()
                .ok_or_else(|| AppError::msg(tx!("Geçersiz dosya adı.", "Invalid file name.")))?,
        ),
        None => None,
    };
    write_forced_pack(&app, &w, item.as_ref())?;
    record.forced_pack = file;
    record.save(&w.dir)?;
    let note = Some(tx!(
        "Dünya yeniden açılınca geçerli olur.",
        "Takes effect when the world restarts."
    ));
    pack_list(
        &app,
        &state,
        &icons,
        &w,
        ContentKind::ResourcePack,
        false,
        note,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_shader_loader() {
        assert_eq!(shader_loader(LoaderKind::Fabric), "iris");
        assert_eq!(shader_loader(LoaderKind::NeoForge), "iris");
        assert_eq!(shader_loader(LoaderKind::Quilt), "iris");
        assert_eq!(shader_loader(LoaderKind::Forge), "oculus");
    }

    /// Canlı: bir kaynak paketi, bir veri paketi ve Iris'in çözümü (Sodium ile).
    #[tokio::test]
    #[ignore]
    async fn live_content_versions() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let api = Modrinth::new(&http);
        let w = World {
            key: "test".into(),
            dir: std::env::temp_dir(),
            name: "test".into(),
            loader: LoaderKind::Fabric,
            mc: "1.21.4".into(),
            own: None,
        };
        let rp = pick(&api, &w, ContentKind::ResourcePack, "fresh-animations")
            .await
            .unwrap();
        assert!(mods::primary_file(&rp, "zip").is_some());
        let dp = pick(&api, &w, ContentKind::DataPack, "terralith")
            .await
            .unwrap();
        assert!(mods::primary_file(&dp, "zip").is_some());
        let plan = shader_plan(&http, &w, &Record::default()).await.unwrap();
        let ids: Vec<_> = plan
            .install
            .iter()
            .map(|p| p.version.project_id.as_str())
            .collect();
        assert!(
            ids.contains(&"AANobbMI"),
            "Sodium bağımlılığı bulunmalı: {ids:?}"
        );
        let forge = World {
            loader: LoaderKind::Forge,
            mc: "1.20.1".into(),
            ..w
        };
        let plan = shader_plan(&http, &forge, &Record::default())
            .await
            .unwrap();
        assert!(plan.install.len() >= 2, "Oculus + Embeddium");
    }
}
