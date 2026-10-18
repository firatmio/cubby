//! Performans: dünyanın önceden hazırlanması (Chunky) ve "sunucu zorlanıyor" izlemesi.
//!
//! Chunky (Modrinth `fALzjamp`, Fabric/Quilt/NeoForge/Forge/Paper) yalnız sunucuda çalışır; komutlar
//! konsola gönderilir, ilerleme sunucu günlüğünden okunur. Oyuncu girince kendiliğinden duraklar, son
//! oyuncu çıkınca devam eder. Zorlanma, Minecraft'ın kendi "Can't keep up!" uyarısından anlaşılır.

use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;
use crate::sessions::META_DIR;
use crate::{instance, mods, paths};

/// Chunky'nin Modrinth kimliği.
pub const CHUNKY: &str = "fALzjamp";
pub const EVENT_PREGEN: &str = "server://pregen";
pub const EVENT_HEALTH: &str = "server://health";
const PREGEN_FILE: &str = "pregen.json";
/// İzin verilen yarıçaplar (blok).
pub const RADII: [u32; 3] = [1000, 2000, 4000];

// ---- Günlük satırları (saf) ----

/// Chunky'nin konsol mesajları (dili İngilizce; sayılar Java'nın diline göre `.`/`,` olabilir).
#[derive(Debug, Clone, PartialEq)]
pub enum ChunkyLine {
    Started,
    Progress {
        chunks: u64,
        percent: f32,
        eta_secs: Option<u64>,
    },
    Done,
    Paused,
    Continued,
    /// Sunucu kapanırken görev durdu (kaldığı yerden devam edebilir).
    Stopped,
    Cancelled,
}

fn number(s: &str) -> Option<f32> {
    s.trim().replace(',', ".").parse().ok()
}

fn digits(s: &str) -> Option<u64> {
    let d: String = s.chars().filter(char::is_ascii_digit).collect();
    d.parse().ok()
}

/// `h:m:s` → saniye.
fn hms(s: &str) -> Option<u64> {
    let mut parts = s
        .trim()
        .trim_end_matches(',')
        .split(':')
        .map(|p| p.trim().parse::<u64>().ok());
    let (h, m, sec) = (parts.next()??, parts.next()??, parts.next()??);
    Some(h * 3600 + m * 60 + sec)
}

pub fn parse_chunky(line: &str) -> Option<ChunkyLine> {
    if let Some(i) = line.find("Task running for ") {
        let rest = &line[i..];
        let processed = rest.split_once("Processed: ")?.1;
        let (chunks, after) = processed.split_once(" chunks (")?;
        let (percent, after) = after.split_once("%)")?;
        let eta = after
            .split_once("ETA: ")
            .and_then(|(_, e)| hms(e.split(" Rate").next().unwrap_or(e).trim_end_matches(',')));
        return Some(ChunkyLine::Progress {
            chunks: digits(chunks)?,
            percent: number(percent)?,
            eta_secs: eta,
        });
    }
    if line.contains("Task finished for ") {
        Some(ChunkyLine::Done)
    } else if line.contains("Task paused for ") {
        Some(ChunkyLine::Paused)
    } else if line.contains("Task continuing for ") {
        Some(ChunkyLine::Continued)
    } else if line.contains("Task stopped for ") {
        Some(ChunkyLine::Stopped)
    } else if line.contains("Task cancelled for ") {
        Some(ChunkyLine::Cancelled)
    } else if line.contains("Task started in ") {
        Some(ChunkyLine::Started)
    } else {
        None
    }
}

/// `Can't keep up! Is the server overloaded? Running 2005ms or 40 ticks behind` → 2005.
pub fn parse_behind(msg: &str) -> Option<u64> {
    let rest = msg.split_once("Can't keep up!")?.1;
    let ms = rest.split_once("Running ")?.1.split_once("ms")?.0;
    digits(ms)
}

// ---- Zorlanma (saf, zaman ms) ----

const WARMUP_MS: u64 = 60_000;
const WINDOW_MS: u64 = 5 * 60_000;
const CALM_MS: u64 = 10 * 60_000;

#[derive(Debug, Default, Clone)]
pub struct Health {
    running_since: Option<u64>,
    hits: VecDeque<u64>,
    pub behind_ms: u64,
    pub overloaded: bool,
}

impl Health {
    pub fn on_running(&mut self, now: u64) {
        *self = Self {
            running_since: Some(now),
            ..Self::default()
        };
    }

    /// Bir uyarı geldi; durum değiştiyse `true`.
    pub fn on_behind(&mut self, now: u64, ms: u64) -> bool {
        // Açılışta dünya yüklenirken bu uyarı normal.
        if self
            .running_since
            .is_none_or(|t| now.saturating_sub(t) < WARMUP_MS)
        {
            return false;
        }
        self.hits.retain(|&t| now.saturating_sub(t) < WINDOW_MS);
        self.hits.push_back(now);
        self.behind_ms = ms;
        if !self.overloaded && self.hits.len() >= 2 {
            self.overloaded = true;
            return true;
        }
        false
    }

    /// Uzun süre uyarı gelmediyse normale döner; değiştiyse `true`.
    pub fn tick(&mut self, now: u64) -> bool {
        let last = self.hits.back().copied().unwrap_or(0);
        if self.overloaded && now.saturating_sub(last) >= CALM_MS {
            self.overloaded = false;
            self.hits.clear();
            return true;
        }
        false
    }
}

// ---- Önceden hazırlama durumu ----

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PregenState {
    #[default]
    Idle,
    /// Chunky kuruldu, dünya (yeniden) açılınca başlayacak.
    Pending,
    Running,
    Paused,
    Done,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Pregen {
    pub state: PregenState,
    pub radius: u32,
    pub chunks: u64,
    pub percent: f32,
    pub eta_secs: Option<u64>,
    /// Biri oyuna girdiği için Cubby duraklattı (son oyuncu çıkınca devam eder).
    pub auto_paused: bool,
    pub done_at: Option<u64>,
}

impl Pregen {
    /// Günlük satırına göre durum.
    pub fn apply(&mut self, line: &ChunkyLine, now: u64) {
        match line {
            ChunkyLine::Started | ChunkyLine::Continued => self.state = PregenState::Running,
            ChunkyLine::Progress {
                chunks,
                percent,
                eta_secs,
            } => {
                if self.state != PregenState::Paused {
                    self.state = PregenState::Running;
                }
                self.chunks = *chunks;
                self.percent = *percent;
                self.eta_secs = *eta_secs;
            }
            ChunkyLine::Done => {
                self.state = PregenState::Done;
                self.percent = 100.0;
                self.eta_secs = None;
                self.auto_paused = false;
                self.done_at = Some(now);
            }
            ChunkyLine::Paused => {
                if self.state != PregenState::Done {
                    self.state = PregenState::Paused;
                }
            }
            // Sunucu kapanıyor: görev kayıtlı, açılınca devam edilir; durum "çalışıyor" kalır.
            ChunkyLine::Stopped => {}
            ChunkyLine::Cancelled => *self = Self::default(),
        }
    }
}

fn load_pregen(meta: &Path) -> Pregen {
    std::fs::read_to_string(meta.join(PREGEN_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_pregen(meta: &Path, p: &Pregen) {
    if let Ok(json) = serde_json::to_vec_pretty(p) {
        let _ = std::fs::write(meta.join(PREGEN_FILE), json);
    }
}

// ---- Uygulama durumu ----

#[derive(Default)]
pub struct Perf {
    health: Mutex<HashMap<String, Health>>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn meta(app: &AppHandle, id: &str) -> AppResult<std::path::PathBuf> {
    Ok(paths::instance_dir(app, id)?.join(META_DIR))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HealthPayload<'a> {
    id: &'a str,
    overloaded: bool,
    behind_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PregenPayload<'a> {
    id: &'a str,
    pregen: &'a Pregen,
}

fn emit_pregen(app: &AppHandle, id: &str, p: &Pregen) {
    let _ = app.emit(EVENT_PREGEN, PregenPayload { id, pregen: p });
}

fn emit_health(app: &AppHandle, id: &str, h: &Health) {
    let _ = app.emit(
        EVENT_HEALTH,
        HealthPayload {
            id,
            overloaded: h.overloaded,
            behind_ms: h.behind_ms,
        },
    );
}

/// Kaydı günceller, saklar ve arayüze bildirir.
fn update_pregen(app: &AppHandle, id: &str, f: impl FnOnce(&mut Pregen)) -> Option<Pregen> {
    let meta = meta(app, id).ok()?;
    let mut p = load_pregen(&meta);
    let before = p.clone();
    f(&mut p);
    if p != before {
        save_pregen(&meta, &p);
        emit_pregen(app, id, &p);
    }
    Some(p)
}

/// Sunucu günlüğünden Chunky satırı geldi.
pub fn on_chunky(app: &AppHandle, id: &str, line: &ChunkyLine) {
    let now = now_ms();
    update_pregen(app, id, |p| p.apply(line, now));
}

/// "Can't keep up!" geldi.
pub fn on_behind(app: &AppHandle, id: &str, ms: u64) {
    let perf = app.state::<Perf>();
    let mut map = perf.health.lock().unwrap_or_else(|e| e.into_inner());
    let h = map.entry(id.to_string()).or_default();
    if h.on_behind(now_ms(), ms) {
        emit_health(app, id, h);
    }
}

async fn send(app: &AppHandle, id: &str, cmds: &[&str]) -> AppResult<()> {
    let servers = app.state::<AppState>().servers.clone();
    for c in cmds {
        servers.send_command(app, id, c).await?;
    }
    Ok(())
}

async fn start_task(app: &AppHandle, id: &str, radius: u32) -> AppResult<()> {
    let radius_cmd = format!("chunky radius {radius}");
    // `confirm`: önceki bir görev ya da disk uyarısı varsa yeni görevi onaylar; yoksa zararsız.
    send(
        app,
        id,
        &[
            "chunky spawn",
            &radius_cmd,
            "chunky start",
            "chunky confirm",
        ],
    )
    .await
}

#[derive(Deserialize)]
struct StatusPayload {
    id: String,
    status: String,
}

#[derive(Deserialize)]
struct PlayersPayload {
    id: String,
    players: Vec<String>,
}

/// Sunucu durumu ve oyuncu olaylarını dinler; sağlık durumunu dakikada bir gözden geçirir.
pub fn install(app: &AppHandle) {
    let handle = app.clone();
    app.listen_any(crate::server::EVENT_STATUS, move |event| {
        let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload()) else {
            return;
        };
        let app = handle.clone();
        match p.status.as_str() {
            "running" => {
                {
                    let perf = app.state::<Perf>();
                    let mut map = perf.health.lock().unwrap_or_else(|e| e.into_inner());
                    map.entry(p.id.clone()).or_default().on_running(now_ms());
                }
                let Ok(meta) = meta(&app, &p.id) else { return };
                let pregen = load_pregen(&meta);
                tauri::async_runtime::spawn(async move {
                    let result = match pregen.state {
                        // Chunky yeni kuruldu ya da sunucu görev sürerken kapandı.
                        PregenState::Pending => start_task(&app, &p.id, pregen.radius).await,
                        PregenState::Running => send(&app, &p.id, &["chunky continue"]).await,
                        PregenState::Paused if pregen.auto_paused => {
                            update_pregen(&app, &p.id, |x| x.auto_paused = false);
                            send(&app, &p.id, &["chunky continue"]).await
                        }
                        _ => Ok(()),
                    };
                    if let Err(e) = result {
                        eprintln!("Önceden hazırlama sürdürülemedi: {e}");
                    }
                });
            }
            "stopped" | "crashed" => {
                let perf = app.state::<Perf>();
                let mut map = perf.health.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(h) = map.get_mut(&p.id)
                    && h.overloaded
                {
                    *h = Health::default();
                    emit_health(&app, &p.id, h);
                }
            }
            _ => {}
        }
    });

    let handle = app.clone();
    app.listen_any(crate::server::EVENT_PLAYERS, move |event| {
        let Ok(p) = serde_json::from_str::<PlayersPayload>(event.payload()) else {
            return;
        };
        let app = handle.clone();
        let Ok(meta) = meta(&app, &p.id) else { return };
        let pregen = load_pregen(&meta);
        tauri::async_runtime::spawn(async move {
            // Oynarken takılma olmasın: biri girince durur, son oyuncu çıkınca devam eder.
            if !p.players.is_empty() && pregen.state == PregenState::Running {
                update_pregen(&app, &p.id, |x| {
                    x.auto_paused = true;
                    x.state = PregenState::Paused;
                });
                let _ = send(&app, &p.id, &["chunky pause"]).await;
            } else if p.players.is_empty()
                && pregen.state == PregenState::Paused
                && pregen.auto_paused
            {
                update_pregen(&app, &p.id, |x| {
                    x.auto_paused = false;
                    x.state = PregenState::Running;
                });
                let _ = send(&app, &p.id, &["chunky continue"]).await;
            }
        });
    });

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let perf = handle.state::<Perf>();
            let mut map = perf.health.lock().unwrap_or_else(|e| e.into_inner());
            for (id, h) in map.iter_mut() {
                if h.tick(now_ms()) {
                    emit_health(&handle, id, h);
                }
            }
        }
    });
}

// ---- Komutlar ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfView {
    pregen: Pregen,
    overloaded: bool,
    behind_ms: u64,
    /// Önceden hazırlama bu dünyada yapılabilir mi (modlu ya da Paper).
    supported: bool,
    chunky_installed: bool,
}

fn chunky_installed(meta: &Path) -> bool {
    mods::load_records(meta)
        .iter()
        .any(|r| r.project_id == CHUNKY)
}

fn view(app: &AppHandle, id: &str) -> AppResult<PerfView> {
    let inst = instance::get(app, id)?;
    let meta = meta(app, id)?;
    let (overloaded, behind_ms) = app
        .state::<Perf>()
        .health
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .map_or((false, 0), |h| (h.overloaded, h.behind_ms));
    Ok(PerfView {
        pregen: load_pregen(&meta),
        overloaded,
        behind_ms,
        // Saf dünyada Hızlandırıcı açıkken arka plandaki Fabric'e kurulur.
        supported: inst.loader != LoaderKind::Vanilla || crate::boost::load(&meta).enabled,
        chunky_installed: chunky_installed(&meta),
    })
}

#[tauri::command]
pub fn perf_status(app: AppHandle, id: String) -> AppResult<PerfView> {
    view(&app, &id)
}

/// Önceden hazırlamayı başlatır. Chunky kurulu değilse kurar; o zaman görev dünya (yeniden)
/// açılınca başlar (eklentiler yalnız açılışta yüklenir).
#[tauri::command]
pub async fn pregen_start(app: AppHandle, id: String, radius: u32) -> AppResult<PerfView> {
    if !RADII.contains(&radius) {
        return Err(AppError::msg(tx!("Geçersiz yarıçap.", "Invalid radius.")));
    }
    let inst = instance::get(&app, &id)?;
    let meta = meta(&app, &id)?;
    let running = app.state::<AppState>().servers.snapshot(&id).status
        == crate::server::ServerStatus::Running;
    let fresh = |state| Pregen {
        state,
        radius,
        ..Pregen::default()
    };
    if !chunky_installed(&meta) {
        install_chunky(&app, &inst).await?;
        update_pregen(&app, &id, |p| *p = fresh(PregenState::Pending));
        return view(&app, &id);
    }
    if running {
        start_task(&app, &id, radius).await?;
        update_pregen(&app, &id, |p| *p = fresh(PregenState::Running));
    } else {
        update_pregen(&app, &id, |p| *p = fresh(PregenState::Pending));
    }
    view(&app, &id)
}

/// Chunky dünyanın sunucusuna; saf dünyada Hızlandırıcı'nın arka plandaki Fabric'ine.
async fn install_chunky(app: &AppHandle, inst: &instance::Instance) -> AppResult<()> {
    let _guard = crate::mods_cmds::OPS.lock().await;
    let Some(loader) = crate::boost::server_loader(app, inst).await? else {
        return Err(AppError::msg(tx!(
            "Saf dünyada önceden hazırlama için Hızlandırıcı açık olmalı.",
            "On a vanilla world, pre-generation needs the Booster turned on."
        )));
    };
    match crate::boost::install_server_mod(app, inst, loader, CHUNKY, false).await? {
        crate::boost::Outcome::Installed | crate::boost::Outcome::Already => {}
        _ => {
            return Err(AppError::msg(tx!(
                "Chunky bu dünyanın sürümü için yayınlanmamış.",
                "Chunky isn't released for this world's version."
            )));
        }
    }
    if inst.loader.is_modded() {
        crate::client_cmds::spawn_sync(app, &inst.id);
    }
    Ok(())
}

#[tauri::command]
pub async fn pregen_pause(app: AppHandle, id: String) -> AppResult<PerfView> {
    send(&app, &id, &["chunky pause"]).await?;
    update_pregen(&app, &id, |p| {
        p.state = PregenState::Paused;
        p.auto_paused = false;
    });
    view(&app, &id)
}

#[tauri::command]
pub async fn pregen_resume(app: AppHandle, id: String) -> AppResult<PerfView> {
    send(&app, &id, &["chunky continue"]).await?;
    update_pregen(&app, &id, |p| {
        p.state = PregenState::Running;
        p.auto_paused = false;
    });
    view(&app, &id)
}

/// İptal: sunucu açıksa Chunky'nin görevi de silinir; kapalıysa yalnız kayıt temizlenir.
#[tauri::command]
pub async fn pregen_cancel(app: AppHandle, id: String) -> AppResult<PerfView> {
    let running = app.state::<AppState>().servers.snapshot(&id).status
        == crate::server::ServerStatus::Running;
    if running {
        send(&app, &id, &["chunky cancel", "chunky confirm"]).await?;
    }
    update_pregen(&app, &id, |p| *p = Pregen::default());
    view(&app, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chunky_lines() {
        let progress = "[12:00:01] [Server thread/INFO]: [Chunky] Task running for minecraft:overworld. Processed: 1234 chunks (12.34%), ETA: 0:12:05, Rate: 85.2 cps, Current: 12, -3";
        assert_eq!(
            parse_chunky(progress),
            Some(ChunkyLine::Progress {
                chunks: 1234,
                percent: 12.34,
                eta_secs: Some(725)
            })
        );
        // Türkçe Java: ondalık virgül, binlik ayırıcı.
        let tr = "[Chunky] Task running for world. Processed: 12.345 chunks (45,67%), ETA: 1:02:03, Rate: 80,1 cps, Current: 1, 2";
        assert_eq!(
            parse_chunky(tr),
            Some(ChunkyLine::Progress {
                chunks: 12345,
                percent: 45.67,
                eta_secs: Some(3723)
            })
        );
        assert_eq!(
            parse_chunky(
                "[Chunky] Task finished for minecraft:overworld. Processed: 62500 chunks (100.00%), Total time: 0:13:01"
            ),
            Some(ChunkyLine::Done)
        );
        assert_eq!(
            parse_chunky("[Chunky] Task paused for world."),
            Some(ChunkyLine::Paused)
        );
        assert_eq!(
            parse_chunky("[Chunky] Task continuing for world."),
            Some(ChunkyLine::Continued)
        );
        assert_eq!(
            parse_chunky("[Chunky] Task stopped for world."),
            Some(ChunkyLine::Stopped)
        );
        assert_eq!(
            parse_chunky("[Chunky] Task cancelled for world."),
            Some(ChunkyLine::Cancelled)
        );
        assert_eq!(
            parse_chunky(
                "[Chunky] Task started in world for the square region centered at 0, 0 with radius 2000."
            ),
            Some(ChunkyLine::Started)
        );
        assert_eq!(
            parse_chunky("[12:00:01] [Server thread/INFO]: Ali joined the game"),
            None
        );
    }

    #[test]
    fn parses_cant_keep_up() {
        assert_eq!(
            parse_behind(
                "Can't keep up! Is the server overloaded? Running 2005ms or 40 ticks behind"
            ),
            Some(2005)
        );
        assert_eq!(parse_behind("Done (3.2s)!"), None);
    }

    #[test]
    fn health_window() {
        let mut h = Health::default();
        // Açılmadan ve ilk dakikada sayılmaz.
        assert!(!h.on_behind(1_000, 500));
        h.on_running(0);
        assert!(!h.on_behind(30_000, 500));
        assert!(!h.on_behind(70_000, 500));
        assert!(!h.overloaded);
        // 5 dk içinde ikinci uyarı.
        assert!(h.on_behind(100_000, 900));
        assert!(h.overloaded && h.behind_ms == 900);
        // Pencere dışındaki eski uyarılar sayılmaz.
        let mut h2 = Health::default();
        h2.on_running(0);
        assert!(!h2.on_behind(70_000, 1));
        assert!(!h2.on_behind(70_000 + WINDOW_MS + 1, 1));
        // 10 dk sessizlik → normale döner.
        assert!(!h.tick(100_000 + CALM_MS - 1));
        assert!(h.tick(100_000 + CALM_MS));
        assert!(!h.overloaded);
    }

    #[test]
    fn pregen_follows_log_lines() {
        let mut p = Pregen {
            state: PregenState::Running,
            radius: 2000,
            ..Pregen::default()
        };
        p.apply(
            &ChunkyLine::Progress {
                chunks: 10,
                percent: 5.0,
                eta_secs: Some(60),
            },
            0,
        );
        assert_eq!((p.chunks, p.state), (10, PregenState::Running));
        p.apply(&ChunkyLine::Paused, 0);
        assert_eq!(p.state, PregenState::Paused);
        // Duraklatılmışken gelen son ilerleme satırı durumu değiştirmez.
        p.apply(
            &ChunkyLine::Progress {
                chunks: 11,
                percent: 5.1,
                eta_secs: None,
            },
            0,
        );
        assert_eq!(p.state, PregenState::Paused);
        p.apply(&ChunkyLine::Stopped, 0);
        assert_eq!(p.state, PregenState::Paused);
        p.apply(&ChunkyLine::Continued, 0);
        p.apply(&ChunkyLine::Done, 42);
        assert_eq!(
            (p.state, p.done_at, p.percent),
            (PregenState::Done, Some(42), 100.0)
        );
        p.apply(&ChunkyLine::Cancelled, 0);
        assert_eq!(p, Pregen::default());
    }
}
