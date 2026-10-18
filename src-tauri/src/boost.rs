//! Hızlandırıcı: sunucuyu oyunun davranışını değiştirmeden hızlandırır.
//!
//! - Java ayarları (G1, Aikar'ın ayarları) her dünyada, her zaman.
//! - Yalnız sunucuda çalışan hızlandırma modları: Lithium (oyun mantığı), C2ME (paralel chunk
//!   üretimi), ScalableLux (ışık), FerriteCore (bellek), ModernFix (açılış ve bellek). Saf dünyalar
//!   bunun için arka planda Fabric ile açılır; kullanıcıya ve arkadaşlara yine "Saf Minecraft"
//!   görünür. Paper'a mod kurulmaz (kendi hızlandırmaları var).
//!
//! Modlar açılıştan hemen önce (`prepare`) kurulur ya da kapalıysa `meta/boost-off`'a kaldırılır;
//! dosyalar yeniden indirilmez. Açıldıktan sonraki ilk açılış çökerse Hızlandırıcıdan şüphelenilir.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::instance::{self, Instance};
use crate::loaders::LoaderKind;
use crate::modrinth::{ClientNeed, Modrinth, Side};
use crate::mods::{self, Source};
use crate::mods_cmds::{ModrinthSource, OPS};
use crate::paths;
use crate::server::StartLog;
use crate::sessions::META_DIR;

pub const EVENT_BOOST: &str = "boost://status";
const BOOST_FILE: &str = "boost.json";
/// Kapalıyken yönetilen modların (ve kayıtlarının) beklediği yer.
const OFF_DIR: &str = "boost-off";
/// Yönetilen modların güncellemesine en çok bu sıklıkla bakılır.
const CHECK_EVERY_MS: u64 = 24 * 60 * 60 * 1000;
const C2ME_CONFIG: &str = "config/c2me.toml";
const C2ME_KEY: &str = "globalExecutorParallelism";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// Oyun mantığı (varlıklar, redstone, yapay zekâ).
    Logic,
    /// Chunk üretimi ve yükleme (çok çekirdekli).
    Chunks,
    /// Işık hesabı.
    Light,
    /// Bellek kullanımı.
    Memory,
    /// Açılış süresi ve bellek.
    Startup,
}

pub struct Candidate {
    /// Modrinth proje kimliği.
    pub id: &'static str,
    pub title: &'static str,
    pub role: Role,
}

/// Hangi yükleyicide hangisinin kurulacağına Modrinth karar verir: bu dünyanın sürümü ve yükleyicisi
/// için yayınlanmamış olan atlanır.
pub const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "gvQqBUqZ",
        title: "Lithium",
        role: Role::Logic,
    },
    Candidate {
        id: "VSNURh3q",
        title: "C2ME",
        role: Role::Chunks,
    },
    Candidate {
        id: "Ps1zyz6x",
        title: "ScalableLux",
        role: Role::Light,
    },
    Candidate {
        id: "uXXizFIs",
        title: "FerriteCore",
        role: Role::Memory,
    },
    Candidate {
        id: "nmDcB62a",
        title: "ModernFix",
        role: Role::Startup,
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Modlu dünya: modlar dünyanın kendi yükleyicisine.
    Mods,
    /// Saf dünya: arka planda Fabric.
    VanillaFabric,
    /// Yalnız Java ayarları (Paper).
    JavaOnly,
}

pub fn mode(loader: LoaderKind) -> Mode {
    match loader {
        LoaderKind::Paper => Mode::JavaOnly,
        LoaderKind::Vanilla => Mode::VanillaFabric,
        _ => Mode::Mods,
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Boost {
    pub enabled: bool,
    /// Açıldıktan sonra sunucu bir kez sorunsuz açıldı.
    pub verified: bool,
    /// Doğrulanmadan çöktü: arayüz "kapatıp dene" önerir.
    pub suspect: bool,
    /// Saf dünyaya arka planda kurulan Fabric sürümü.
    pub fabric: Option<String>,
    /// Bu dünyanın sürümü/yükleyicisi için yayınlanmamış adaylar (proje kimliği).
    pub unavailable: Vec<String>,
    /// Son mod kontrolü (ms).
    pub checked_at: u64,
    /// Son hazırlıktaki hata (ör. ağ yok); sunucu onsuz açıldı.
    pub last_error: Option<String>,
    /// Son açılışta Hızlandırıcı uygulandı mı; açık dünyada değişince "yeniden başlat".
    pub applied: Option<bool>,
}

pub fn load(meta: &Path) -> Boost {
    std::fs::read_to_string(meta.join(BOOST_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(meta: &Path, b: &Boost) {
    let write = || -> AppResult<()> {
        std::fs::create_dir_all(meta)?;
        let tmp = meta.join(format!("{BOOST_FILE}.tmp"));
        std::fs::write(&tmp, serde_json::to_string_pretty(b)?)?;
        std::fs::rename(tmp, meta.join(BOOST_FILE))?;
        Ok(())
    };
    if let Err(e) = write() {
        eprintln!("Hızlandırıcı kaydı yazılamadı: {e}");
    }
}

/// Yeni dünya: mod paketinden kurulmadıysa Hızlandırıcı açık başlar.
pub fn init_new(meta: &Path, enabled: bool) {
    save(
        meta,
        &Boost {
            enabled,
            ..Boost::default()
        },
    );
}

/// Sunucunun gerçekte açıldığı yükleyici: saf dünya + Hızlandırıcı → Fabric.
pub fn runtime(loader: LoaderKind, b: &Boost) -> (LoaderKind, Option<String>) {
    match (&b.fabric, loader, b.enabled) {
        (Some(v), LoaderKind::Vanilla, true) => (LoaderKind::Fabric, Some(v.clone())),
        _ => (loader, None),
    }
}

/// Aikar'ın G1 ayarları: kısa duraklamalar, genç nesil geniş. `AlwaysPreTouch` yok ve `-Xms` olduğu
/// gibi kalır: host aynı bilgisayarda oynuyor, bellek boşuna kilitlenmesin. Java 27'de kaldırılan ya da
/// kullanımdan kalkanlar o sürümden itibaren eklenmez; bilinmeyen bir bayrak JVM'i durdurmasın diye de
/// `IgnoreUnrecognizedVMOptions` en başta.
pub fn jvm_flags(max_mb: u32, java_major: u32) -> Vec<String> {
    let big = max_mb >= 12 * 1024;
    let (new, max_new, region, reserve, ihop) = if big {
        (40, 50, "16M", 15, 20)
    } else {
        (30, 40, "8M", 20, 15)
    };
    let mut f = vec![
        "-XX:+IgnoreUnrecognizedVMOptions".to_string(),
        "-XX:+UseG1GC".into(),
        "-XX:MaxGCPauseMillis=200".into(),
        "-XX:+UnlockExperimentalVMOptions".into(),
        "-XX:+DisableExplicitGC".into(),
        format!("-XX:G1NewSizePercent={new}"),
        format!("-XX:G1MaxNewSizePercent={max_new}"),
        format!("-XX:G1HeapRegionSize={region}"),
        format!("-XX:G1ReservePercent={reserve}"),
        "-XX:G1HeapWastePercent=5".into(),
        "-XX:G1MixedGCCountTarget=4".into(),
        "-XX:G1MixedGCLiveThresholdPercent=90".into(),
        "-XX:G1RSetUpdatingPauseTimePercent=5".into(),
        "-XX:SurvivorRatio=32".into(),
        "-XX:+PerfDisableSharedMem".into(),
        "-XX:MaxTenuringThreshold=1".into(),
    ];
    if java_major < 27 {
        f.insert(2, "-XX:+ParallelRefProcEnabled".into());
        f.push(format!("-XX:InitiatingHeapOccupancyPercent={ihop}"));
    }
    f
}

/// C2ME'nin kullanacağı iş parçacığı: çekirdeklerin yarısı (en az 2, en çok 8). Host aynı bilgisayarda
/// oyunu da oynuyor; C2ME'nin varsayılanı neredeyse bütün çekirdekleri alır.
pub fn c2me_threads(cores: usize) -> usize {
    (cores / 2).clamp(2, 8)
}

/// `c2me.toml`'da yalnız iş parçacığı satırı değişir; dosyanın kalanı (ve C2ME'nin sürüm alanı)
/// olduğu gibi kalır. Satır yoksa ya da zaten doğruysa `None`.
pub fn set_c2me_threads(text: &str, threads: usize) -> Option<String> {
    let want = format!("{C2ME_KEY} = {threads}");
    let mut changed = false;
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            let t = line.trim_start();
            let key = t.split('=').next().unwrap_or("").trim();
            if key == C2ME_KEY && !changed {
                changed = true;
                let indent = &line[..line.len() - t.len()];
                format!("{indent}{want}")
            } else {
                line.to_string()
            }
        })
        .collect();
    let out = lines.join("\n") + if text.ends_with('\n') { "\n" } else { "" };
    (changed && out != text).then_some(out)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn meta_dir(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    Ok(paths::instance_dir(app, id)?.join(META_DIR))
}

/// Yönetilen modları (dosya + kayıt) `meta/boost-off`'a kaldırır.
fn stash(meta: &Path, content: &Path) -> AppResult<()> {
    let records = mods::reconcile(mods::load_records(meta), &mods::scan(content));
    let (managed, keep): (Vec<_>, Vec<_>) = records.into_iter().partition(|r| r.managed);
    if managed.is_empty() {
        return Ok(());
    }
    let off = meta.join(OFF_DIR);
    std::fs::create_dir_all(&off)?;
    let mut parked = mods::load_records(&off);
    for r in managed {
        let from = content.join(&r.file);
        if from.exists() {
            std::fs::rename(&from, off.join(&r.file))?;
        }
        parked.retain(|p| p.file != r.file);
        parked.push(r);
    }
    mods::save_records(&off, &parked)?;
    mods::save_records(meta, &keep)
}

/// `stash`'in tersi: kaldırılan modlar geri gelir.
fn unstash(meta: &Path, content: &Path) -> AppResult<()> {
    let off = meta.join(OFF_DIR);
    let parked = mods::load_records(&off);
    if parked.is_empty() {
        return Ok(());
    }
    std::fs::create_dir_all(content)?;
    let mut records = mods::reconcile(mods::load_records(meta), &mods::scan(content));
    for r in parked {
        let from = off.join(&r.file);
        let to = content.join(&r.file);
        if from.exists() && !to.exists() {
            std::fs::rename(&from, &to)?;
        }
        if to.exists() && !records.iter().any(|x| x.project_id == r.project_id) {
            records.push(r);
        }
    }
    mods::save_records(meta, &records)?;
    mods::save_records(&off, &[])
}

/// Bir sunucu modunun kurulum sonucu.
pub(crate) enum Outcome {
    Installed,
    Already,
    /// Bu dünyanın sürümü/yükleyicisi için yayınlanmamış.
    Unavailable,
    /// Kurulu bir modla uyumsuz.
    Conflict,
}

/// Sunucuya mod kurar (Hızlandırıcı ve Chunky). `loader`: sunucunun gerçekte açıldığı yükleyici
/// (`runtime`); saf dünyada Fabric. `managed`: Hızlandırıcı'nın (bağımlılıkları dahil).
/// `OPS` kilidini çağıran tutar.
pub(crate) async fn install_server_mod(
    app: &AppHandle,
    inst: &Instance,
    loader: LoaderKind,
    project: &str,
    managed: bool,
) -> AppResult<Outcome> {
    let state = app.state::<AppState>();
    let meta = meta_dir(app, &inst.id)?;
    let sub = state.loaders.content_dir(loader).ok_or_else(|| {
        AppError::msg(tx!(
            "Bu dünyaya mod kurulamaz.",
            "Mods can't be installed on this world."
        ))
    })?;
    let content = paths::server_dir(app, &inst.id)?.join(sub);
    let mut records = mods::reconcile(mods::load_records(&meta), &mods::scan(&content));
    let installed: HashSet<String> = records.iter().map(|r| r.project_id.clone()).collect();
    if installed.contains(project) {
        return Ok(Outcome::Already);
    }
    let src = ModrinthSource {
        api: Modrinth::new(&state.http),
        kind: loader,
        mc: &inst.mc_version,
    };
    if src.pick_for(project).await?.is_none() {
        return Ok(Outcome::Unavailable);
    }
    let plan = mods::resolve(&src, project, &installed).await?;
    if !plan.conflicts.is_empty() {
        return Ok(Outcome::Conflict);
    }
    for pick in &plan.install {
        let mut rec =
            mods::download_into(&state.http, &meta, &content, &pick.version, None, |_, _| {})
                .await?;
        rec.dependency = pick.dependency;
        rec.managed = managed;
        if managed {
            rec.need = Some(ClientNeed::None);
        }
        records.retain(|r| r.file != rec.file && r.project_id != rec.project_id);
        records.push(rec);
        mods::save_records(&meta, &records)?;
    }
    Ok(Outcome::Installed)
}

/// Saf dünyada Fabric kurulu değilse (ya da başlatıcısı silinmişse) kurar. Bu Minecraft sürümü için
/// Fabric yoksa `fabric` boş kalır.
async fn ensure_fabric(app: &AppHandle, inst: &Instance, b: &mut Boost) -> AppResult<()> {
    let server_dir = paths::server_dir(app, &inst.id)?;
    let launcher = server_dir.join("fabric-server-launch.jar");
    if b.fabric.is_some() && launcher.exists() {
        return Ok(());
    }
    let state = app.state::<AppState>();
    b.fabric = state
        .loaders
        .install_fabric_over_vanilla(&inst.mc_version, &server_dir, &mut |_| {})
        .await?;
    Ok(())
}

/// Chunky gibi yönetilmeyen bir sunucu modu için yükleyiciyi hazırlar: saf dünyada Hızlandırıcı
/// açıksa arka plandaki Fabric. Saf dünyada kapalıysa `None`.
pub(crate) async fn server_loader(
    app: &AppHandle,
    inst: &Instance,
) -> AppResult<Option<LoaderKind>> {
    match mode(inst.loader) {
        Mode::VanillaFabric => {
            let meta = meta_dir(app, &inst.id)?;
            let mut b = load(&meta);
            if !b.enabled {
                return Ok(None);
            }
            ensure_fabric(app, inst, &mut b).await?;
            save(&meta, &b);
            Ok(b.fabric.is_some().then_some(LoaderKind::Fabric))
        }
        _ => Ok(Some(inst.loader)),
    }
}

/// Hızlandırıcı açıkken: Fabric (saf dünyada), eksik modlar, günde bir güncelleme, C2ME ayarı.
async fn apply(app: &AppHandle, inst: &Instance, b: &mut Boost, log: &StartLog) -> AppResult<()> {
    let state = app.state::<AppState>();
    let meta = meta_dir(app, &inst.id)?;
    let server_dir = paths::server_dir(app, &inst.id)?;

    if mode(inst.loader) == Mode::VanillaFabric {
        if b.fabric.is_none() {
            log.line(tx!(
                "Hızlandırıcı: arka planda Fabric kuruluyor…",
                "Booster: installing Fabric in the background…"
            ));
        }
        ensure_fabric(app, inst, b).await?;
        if b.fabric.is_none() {
            // Bu Minecraft sürümü için Fabric yok: yalnız Java ayarları.
            b.unavailable = CANDIDATES.iter().map(|c| c.id.to_string()).collect();
            return Ok(());
        }
    }
    let (loader, _) = runtime(inst.loader, b);
    let Some(sub) = state.loaders.content_dir(loader) else {
        return Ok(());
    };
    let content = server_dir.join(sub);
    unstash(&meta, &content)?;

    let now = now_ms();
    let due = now.saturating_sub(b.checked_at) >= CHECK_EVERY_MS;
    let records = mods::load_records(&meta);
    let have: HashSet<&str> = records.iter().map(|r| r.project_id.as_str()).collect();
    let missing: Vec<&Candidate> = CANDIDATES
        .iter()
        .filter(|c| !have.contains(c.id) && (due || !b.unavailable.iter().any(|u| u == c.id)))
        .collect();

    if !missing.is_empty() {
        let api = Modrinth::new(&state.http);
        let ids: Vec<String> = missing.iter().map(|c| c.id.to_string()).collect();
        // Oyuncuda da kurulu olması gereken bir mod arkadaşları dışarıda bırakır: hiç kurulmaz.
        let client_required: HashSet<String> = api
            .projects(&ids)
            .await?
            .into_iter()
            .filter(|p| p.client_side == Side::Required)
            .map(|p| p.id)
            .collect();
        let mut unavailable: Vec<String> = b
            .unavailable
            .iter()
            .filter(|u| !missing.iter().any(|c| c.id == u.as_str()))
            .cloned()
            .collect();
        for c in missing {
            if client_required.contains(c.id) {
                unavailable.push(c.id.to_string());
                continue;
            }
            log.line(tx!(
                "Hızlandırıcı: {} kuruluyor…",
                "Booster: installing {}…",
                c.title
            ));
            match install_server_mod(app, inst, loader, c.id, true).await? {
                Outcome::Installed | Outcome::Already => {}
                Outcome::Unavailable | Outcome::Conflict => unavailable.push(c.id.to_string()),
            }
        }
        b.unavailable = unavailable;
    }

    if due {
        update_managed(app, inst, loader, &meta, &content).await?;
        b.checked_at = now;
    }

    let c2me_on = mods::load_records(&meta)
        .iter()
        .any(|r| r.project_id == CANDIDATES[1].id);
    if c2me_on {
        configure_c2me(&server_dir);
    }
    Ok(())
}

/// Yönetilen modların daha yeni uyumlu sürümü varsa değiştirir.
async fn update_managed(
    app: &AppHandle,
    inst: &Instance,
    loader: LoaderKind,
    meta: &Path,
    content: &Path,
) -> AppResult<()> {
    let state = app.state::<AppState>();
    let mut records = mods::reconcile(mods::load_records(meta), &mods::scan(content));
    let shas: Vec<String> = records
        .iter()
        .filter(|r| r.managed)
        .map(|r| r.sha1.clone())
        .collect();
    if shas.is_empty() {
        return Ok(());
    }
    let latest = Modrinth::new(&state.http)
        .latest_for(&shas, loader, &inst.mc_version)
        .await?;
    for old in records.clone().into_iter().filter(|r| r.managed) {
        let Some(v) = latest.get(&old.sha1).filter(|v| v.id != old.version_id) else {
            continue;
        };
        let mut new =
            mods::download_into(&state.http, meta, content, v, Some(&old.file), |_, _| {}).await?;
        new.dependency = old.dependency;
        new.managed = true;
        new.need = Some(ClientNeed::None);
        records.retain(|r| r.file != old.file && r.file != new.file);
        records.push(new);
        mods::save_records(meta, &records)?;
    }
    Ok(())
}

/// C2ME'nin iş parçacığı sayısı. Dosya C2ME'nin ilk açılışında oluşur (sürüm alanı uymazsa C2ME
/// dosyayı sıfırlar, bu yüzden biz yazmayız, yalnız satırı değiştiririz).
fn configure_c2me(server_dir: &Path) {
    let path = server_dir.join(C2ME_CONFIG);
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let cores = std::thread::available_parallelism().map_or(4, |n| n.get());
    if let Some(next) = set_c2me_threads(&text, c2me_threads(cores))
        && let Err(e) = std::fs::write(&path, next)
    {
        eprintln!("C2ME ayarı yazılamadı: {e}");
    }
}

/// Açılıştan hemen önce: Hızlandırıcı'yı uygular ya da kaldırır, sunucunun açılış argümanlarını
/// döner (`-jar …`). Hata açılışı durdurmaz: konsola yazılır, sunucu onsuz (ya da önceki haliyle) açılır.
pub async fn prepare(app: &AppHandle, inst: &Instance, log: &StartLog) -> AppResult<Vec<String>> {
    let _guard = OPS.lock().await;
    let state = app.state::<AppState>();
    let meta = meta_dir(app, &inst.id)?;
    let mut b = load(&meta);
    let active = b.enabled && mode(inst.loader) != Mode::JavaOnly;
    let result = if active {
        apply(app, inst, &mut b, log).await
    } else {
        let (loader, _) = runtime(inst.loader, &b);
        let sub = state.loaders.content_dir(if loader == LoaderKind::Vanilla {
            LoaderKind::Fabric
        } else {
            loader
        });
        match sub {
            Some(sub) => stash(&meta, &paths::server_dir(app, &inst.id)?.join(sub)),
            None => Ok(()),
        }
    };
    match result {
        Ok(()) => b.last_error = None,
        Err(e) => {
            log.line(tx!(
                "Hızlandırıcı hazırlanamadı, kurulu olanlarla açılıyor: {e}",
                "Couldn't prepare the Booster; starting with what's installed: {e}"
            ));
            b.last_error = Some(e.to_string());
        }
    }
    b.applied = Some(active);
    save(&meta, &b);
    emit(app, &inst.id);
    let (loader, version) = runtime(inst.loader, &b);
    Ok(state.loaders.launch_args(
        loader,
        &inst.mc_version,
        version.as_deref().or(inst.loader_version.as_deref()),
    ))
}

// ---- Durum ve komutlar ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostMod {
    title: &'static str,
    role: Role,
    active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostView {
    enabled: bool,
    mode: Mode,
    /// Bu dünyada kullanılabilen adaylar; `active`: kurulu ve son açılışta yüklendi.
    mods: Vec<BoostMod>,
    /// Bu sürüm/yükleyici için olmayanların adları.
    unavailable: Vec<&'static str>,
    verified: bool,
    suspect: bool,
    /// Açık dünyada ayar son açılıştan beri değişti.
    pending_restart: bool,
    /// C2ME'nin kullandığı iş parçacığı.
    threads: usize,
    last_error: Option<String>,
}

pub fn view(app: &AppHandle, id: &str) -> AppResult<BoostView> {
    let inst = instance::get(app, id)?;
    let meta = meta_dir(app, id)?;
    let b = load(&meta);
    let m = mode(inst.loader);
    let installed: HashSet<String> = mods::load_records(&meta)
        .into_iter()
        .map(|r| r.project_id)
        .collect();
    let running = app
        .state::<AppState>()
        .servers
        .snapshot(id)
        .status
        .is_active();
    let applied = b.applied == Some(true);
    let mods = if m == Mode::JavaOnly {
        Vec::new()
    } else {
        CANDIDATES
            .iter()
            .filter(|c| !b.unavailable.iter().any(|u| u == c.id))
            .map(|c| BoostMod {
                title: c.title,
                role: c.role,
                active: b.enabled && applied && installed.contains(c.id),
            })
            .collect()
    };
    let unavailable = CANDIDATES
        .iter()
        .filter(|c| m != Mode::JavaOnly && b.unavailable.iter().any(|u| u == c.id))
        .map(|c| c.title)
        .collect();
    let cores = std::thread::available_parallelism().map_or(4, |n| n.get());
    Ok(BoostView {
        enabled: b.enabled,
        mode: m,
        mods,
        unavailable,
        verified: b.verified,
        suspect: b.suspect,
        pending_restart: running
            && m != Mode::JavaOnly
            && b.applied.is_some_and(|a| a != b.enabled),
        threads: c2me_threads(cores),
        last_error: b.last_error,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BoostPayload<'a> {
    id: &'a str,
    boost: &'a BoostView,
}

fn emit(app: &AppHandle, id: &str) {
    if let Ok(v) = view(app, id) {
        let _ = app.emit(EVENT_BOOST, BoostPayload { id, boost: &v });
    }
}

fn update(app: &AppHandle, id: &str, f: impl FnOnce(&mut Boost)) -> AppResult<()> {
    let meta = meta_dir(app, id)?;
    let mut b = load(&meta);
    let before = b.clone();
    f(&mut b);
    if b != before {
        save(&meta, &b);
        emit(app, id);
    }
    Ok(())
}

#[tauri::command]
pub fn boost_status(app: AppHandle, id: String) -> AppResult<BoostView> {
    view(&app, &id)
}

/// Açıp kapatır; bir sonraki açılışta geçerli olur.
#[tauri::command]
pub fn boost_set(app: AppHandle, id: String, enabled: bool) -> AppResult<BoostView> {
    instance::get(&app, &id)?;
    update(&app, &id, |b| {
        if b.enabled != enabled {
            b.enabled = enabled;
            b.verified = false;
            b.suspect = false;
        }
    })?;
    view(&app, &id)
}

#[derive(Deserialize)]
struct StatusPayload {
    id: String,
    status: String,
}

/// Açılış sonucu: ilk sorunsuz açılış Hızlandırıcıyı doğrular, doğrulanmadan çökmesi şüphe doğurur.
pub fn install(app: &AppHandle) {
    let handle = app.clone();
    app.listen_any(crate::server::EVENT_STATUS, move |event| {
        let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload()) else {
            return;
        };
        let result = match p.status.as_str() {
            "running" => update(&handle, &p.id, |b| {
                if b.applied == Some(true) {
                    b.verified = true;
                    b.suspect = false;
                }
            }),
            "crashed" => update(&handle, &p.id, |b| {
                if b.applied == Some(true) && !b.verified {
                    b.suspect = true;
                }
            }),
            _ => Ok(()),
        };
        if let Err(e) = result {
            eprintln!("Hızlandırıcı durumu güncellenemedi: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jvm_flags_by_memory_and_java() {
        let small = jvm_flags(4096, 21);
        assert_eq!(small[0], "-XX:+IgnoreUnrecognizedVMOptions");
        assert!(small.contains(&"-XX:G1HeapRegionSize=8M".to_string()));
        assert!(small.contains(&"-XX:+ParallelRefProcEnabled".to_string()));
        assert!(small.contains(&"-XX:InitiatingHeapOccupancyPercent=15".to_string()));

        let big = jvm_flags(16384, 21);
        assert!(big.contains(&"-XX:G1HeapRegionSize=16M".to_string()));
        assert!(big.contains(&"-XX:G1NewSizePercent=40".to_string()));

        // Java 27'de kaldırılan/kullanımdan kalkan bayraklar yok.
        let new_java = jvm_flags(4096, 27);
        assert!(!new_java.iter().any(|f| f.contains("ParallelRefProc")));
        assert!(
            !new_java
                .iter()
                .any(|f| f.contains("InitiatingHeapOccupancy"))
        );
        assert!(!new_java.iter().any(|f| f.contains("AlwaysPreTouch")));
    }

    #[test]
    fn c2me_uses_half_the_cores() {
        assert_eq!(c2me_threads(1), 2);
        assert_eq!(c2me_threads(4), 2);
        assert_eq!(c2me_threads(12), 6);
        assert_eq!(c2me_threads(32), 8);
    }

    #[test]
    fn edits_only_the_thread_line() {
        let text = "version = 3\n\n[general]\n  globalExecutorParallelism = \"default\" # comment\n  other = 1\n";
        let out = set_c2me_threads(text, 6).unwrap();
        assert_eq!(
            out,
            "version = 3\n\n[general]\n  globalExecutorParallelism = 6\n  other = 1\n"
        );
        assert_eq!(set_c2me_threads(&out, 6), None);
        assert_eq!(set_c2me_threads("version = 3\n", 6), None);
    }

    #[test]
    fn runtime_table() {
        let on = Boost {
            enabled: true,
            fabric: Some("0.19.5".into()),
            ..Boost::default()
        };
        let off = Boost {
            enabled: false,
            ..on.clone()
        };
        assert_eq!(
            runtime(LoaderKind::Vanilla, &on),
            (LoaderKind::Fabric, Some("0.19.5".into()))
        );
        assert_eq!(
            runtime(LoaderKind::Vanilla, &off),
            (LoaderKind::Vanilla, None)
        );
        // Fabric henüz kurulmadıysa saf açılır.
        let pending = Boost {
            fabric: None,
            ..on.clone()
        };
        assert_eq!(
            runtime(LoaderKind::Vanilla, &pending),
            (LoaderKind::Vanilla, None)
        );
        assert_eq!(
            runtime(LoaderKind::NeoForge, &on),
            (LoaderKind::NeoForge, None)
        );
        assert_eq!(mode(LoaderKind::Paper), Mode::JavaOnly);
        assert_eq!(mode(LoaderKind::Quilt), Mode::Mods);
    }

    #[test]
    fn missing_or_old_file_reads_as_off() {
        let dir = std::env::temp_dir().join(format!("cubby-boost-{}", now_ms()));
        assert_eq!(load(&dir), Boost::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(BOOST_FILE), r#"{"enabled":true}"#).unwrap();
        let b = load(&dir);
        assert!(b.enabled && !b.verified && b.fabric.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stash_and_unstash_move_only_managed_mods() {
        let root = std::env::temp_dir().join(format!("cubby-stash-{}", now_ms()));
        let (meta, content) = (root.join("meta"), root.join("mods"));
        std::fs::create_dir_all(&content).unwrap();
        std::fs::write(content.join("lithium.jar"), b"PK-lithium").unwrap();
        std::fs::write(content.join("own.jar"), b"PK-own").unwrap();
        let files = mods::scan(&content);
        let sha = |f: &str| files.iter().find(|(n, _)| n == f).unwrap().1.clone();
        let rec = |file: &str, managed: bool| mods::ModRecord {
            file: file.into(),
            sha1: sha(file),
            project_id: file.into(),
            version_id: "v".into(),
            dependency: false,
            title: None,
            need: None,
            managed,
        };
        mods::save_records(&meta, &[rec("lithium.jar", true), rec("own.jar", false)]).unwrap();

        stash(&meta, &content).unwrap();
        assert!(!content.join("lithium.jar").exists());
        assert!(content.join("own.jar").exists());
        assert_eq!(mods::load_records(&meta).len(), 1);

        unstash(&meta, &content).unwrap();
        assert!(content.join("lithium.jar").exists());
        let back = mods::load_records(&meta);
        assert!(back.iter().any(|r| r.file == "lithium.jar" && r.managed));
        assert!(mods::load_records(&meta.join(OFF_DIR)).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    const CHUNKY_ID: &str = "fALzjamp";

    /// Sunucuyu açar, istenirse Chunky ile hazırlar, kapatır:
    /// (açılış sn, hazırlama sn, "Can't keep up" sayısı).
    async fn bench_run(
        java: &str,
        server: &Path,
        flags: &[String],
        radius: u32,
        props: &str,
        pregen: bool,
    ) -> (f64, f64, usize) {
        use std::time::{Duration, Instant};
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let _ = std::fs::remove_dir_all(server.join("world"));
        let _ = std::fs::remove_dir_all(server.join("config/chunky"));
        std::fs::write(server.join("server.properties"), props).unwrap();
        let mut child = tokio::process::Command::new(java)
            .args(["-Xms1G", "-Xmx4G"])
            .args(flags)
            .args(["-jar", "fabric-server-launch.jar", "nogui"])
            .current_dir(server)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

        // `pat` gelene kadar okur; yoldaki "Can't keep up" satırlarını sayar.
        async fn wait_for(
            lines: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
            pat: &str,
            limit: u64,
        ) -> usize {
            let mut behind = 0;
            let found = tokio::time::timeout(Duration::from_secs(limit), async {
                while let Ok(Some(l)) = lines.next_line().await {
                    if l.contains("Can't keep up") {
                        behind += 1;
                    }
                    if l.contains("Exception") || l.contains("/ERROR]") {
                        println!("    | {l}");
                    }
                    if l.contains(pat) {
                        return true;
                    }
                }
                false
            })
            .await
            .unwrap_or(false);
            assert!(found, "\"{pat}\" gelmedi");
            behind
        }

        let start = Instant::now();
        wait_for(&mut lines, "Done (", 600).await;
        let boot = start.elapsed().as_secs_f64();
        let (mut gen_secs, mut behind) = (0.0, 0);
        if pregen {
            let t = Instant::now();
            let cmds =
                format!("chunky spawn\nchunky radius {radius}\nchunky start\nchunky confirm\n");
            stdin.write_all(cmds.as_bytes()).await.unwrap();
            behind = wait_for(&mut lines, "Task finished", 3600).await;
            gen_secs = t.elapsed().as_secs_f64();
        }
        stdin.write_all(b"stop\n").await.unwrap();
        let _ = tokio::time::timeout(Duration::from_secs(120), child.wait()).await;
        (boot, gen_secs, behind)
    }

    /// Kurulu değilse modu (ve bağımlılıklarını) Fabric için kurar.
    async fn bench_install(
        src: &ModrinthSource<'_>,
        http: &reqwest::Client,
        meta: &Path,
        content: &Path,
        project: &str,
    ) {
        let installed: HashSet<String> = mods::load_records(meta)
            .into_iter()
            .map(|r| r.project_id)
            .collect();
        if src.pick_for(project).await.unwrap().is_none() {
            println!("  {project}: bu sürüm için yok");
            return;
        }
        let plan = mods::resolve(src, project, &installed).await.unwrap();
        let mut records = mods::load_records(meta);
        for pick in &plan.install {
            let rec = mods::download_into(http, meta, content, &pick.version, None, |_, _| {})
                .await
                .unwrap();
            println!("  + {}", rec.file);
            records.push(rec);
        }
        mods::save_records(meta, &records).unwrap();
    }

    /// Gerçek ölçüm: saf dünya → arka planda Fabric, sonra aynı tohumla iki taze dünyada Chunky ile
    /// önceden hazırlama: önce Hızlandırıcısız, sonra Java ayarları + Hızlandırıcı modlarıyla.
    /// `cargo test --release live_boost_bench -- --ignored --nocapture`
    /// Ayarlar: `CUBBY_BENCH_MC` (26.3), `CUBBY_BENCH_RADIUS` (500), `CUBBY_BENCH_JAVA` (java).
    #[tokio::test]
    #[ignore = "ağ, Java ve birkaç dakika gerekir"]
    async fn live_boost_bench() {
        use crate::loaders::{InstallRequest, Loaders};

        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        let mc = env("CUBBY_BENCH_MC", "26.3");
        let radius: u32 = env("CUBBY_BENCH_RADIUS", "500").parse().unwrap();
        let java = env("CUBBY_BENCH_JAVA", "java");
        let major = crate::java::probe(java.clone()).await.expect("java").major;
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let loaders = Loaders::new(http.clone());
        let root = crate::util::live_test_dir("boost-bench");
        let _ = std::fs::remove_dir_all(&root);
        let (server, meta) = (root.join("server"), root.join("meta"));
        let content = server.join("mods");

        // 1) Saf dünya, sonra Hızlandırıcı'nın yolu: aynı klasöre arka planda Fabric.
        loaders
            .install(
                LoaderKind::Vanilla,
                &InstallRequest {
                    mc_version: &mc,
                    loader_version: None,
                    java: None,
                },
                &server,
                &mut |_| {},
            )
            .await
            .unwrap();
        let fabric = loaders
            .install_fabric_over_vanilla(&mc, &server, &mut |_| {})
            .await
            .unwrap()
            .expect("bu sürüm için Fabric yok");
        assert!(server.join("fabric-server-launch.jar").exists());
        println!("Minecraft {mc}, Fabric {fabric}, Java {major}");
        std::fs::write(server.join("eula.txt"), "eula=true\n").unwrap();
        let props = "online-mode=false\nlevel-seed=cubby\nview-distance=8\nsimulation-distance=6\nserver-port=25599\nspawn-protection=0\n";

        let src = ModrinthSource {
            api: Modrinth::new(&http),
            kind: LoaderKind::Fabric,
            mc: &mc,
        };

        // 2) Hızlandırıcısız: yalnız Chunky (ve bağımlılığı).
        bench_install(&src, &http, &meta, &content, CHUNKY_ID).await;
        let base = bench_run(&java, &server, &[], radius, props, true).await;
        println!(
            "Hızlandırıcısız: açılış {:.1} sn, {radius} blok hazırlama {:.1} sn, Can't keep up: {}",
            base.0, base.1, base.2
        );

        // 3) Hızlandırıcı: modlar + Java ayarları. C2ME ayar dosyasını ilk açılışta yazar; sonra
        // iş parçacığı satırı değiştirilir.
        for c in CANDIDATES {
            bench_install(&src, &http, &meta, &content, c.id).await;
        }
        let flags = jvm_flags(4096, major);
        bench_run(&java, &server, &flags, radius, props, false).await;
        let key_line = |text: &str| {
            text.lines()
                .find(|l| l.contains(C2ME_KEY))
                .unwrap_or("(satır yok)")
                .to_string()
        };
        let path = server.join(C2ME_CONFIG);
        println!(
            "c2me.toml önce: {}",
            key_line(&std::fs::read_to_string(&path).unwrap_or_default())
        );
        configure_c2me(&server);
        println!(
            "c2me.toml sonra: {}",
            key_line(&std::fs::read_to_string(&path).unwrap_or_default())
        );
        let boosted = bench_run(&java, &server, &flags, radius, props, true).await;
        println!(
            "Hızlandırıcı:     açılış {:.1} sn, {radius} blok hazırlama {:.1} sn, Can't keep up: {}",
            boosted.0, boosted.1, boosted.2
        );
        println!("Hazırlama {:.2} kat hızlı", base.1 / boosted.1);
    }
}
