pub mod log;
mod process;
pub mod stats;

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::process::ChildStdin;
use tokio::sync::{oneshot, watch};

use crate::consts::{LOG_BACKLOG, STOP_TIMEOUT};
use crate::error::{AppError, AppResult};
use crate::util::now_ms;

pub const EVENT_LOG: &str = "server://log";
pub const EVENT_STATUS: &str = "server://status";
pub const EVENT_STATS: &str = "server://stats";
pub const EVENT_PLAYERS: &str = "server://players";
pub const EVENT_REJECTED: &str = "server://rejected";

/// Kill sonrası sürecin bitmesi için beklenen ek süre.
const KILL_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Crashed,
}

impl ServerStatus {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Starting | Self::Running | Self::Stopping)
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
    /// Uygulamanın kendi mesajları (komut yankısı, kapanma bilgisi).
    System,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    pub stream: LogStream,
    pub line: String,
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerSnapshot {
    pub status: ServerStatus,
    pub logs: Vec<LogLine>,
    /// Şu an bağlı oyuncular (log'daki giriş/çıkış satırlarından).
    pub players: Vec<String>,
    /// Beyaz listede olmadığı için atılanlar (bu açılışta).
    pub rejected: Vec<String>,
}

#[derive(Serialize, Clone)]
struct LogPayload<'a> {
    id: &'a str,
    #[serde(flatten)]
    line: &'a LogLine,
}

#[derive(Serialize, Clone)]
struct StatusPayload<'a> {
    id: &'a str,
    status: ServerStatus,
}

#[derive(Serialize, Clone)]
struct PlayersPayload<'a> {
    id: &'a str,
    players: Vec<String>,
}

#[derive(Serialize, Clone)]
struct StatsPayload<'a> {
    id: &'a str,
    #[serde(flatten)]
    stats: &'a stats::ProcessStats,
}

pub struct LaunchSpec {
    pub java: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

struct State {
    status: ServerStatus,
    logs: VecDeque<LogLine>,
    players: BTreeSet<String>,
    rejected: BTreeSet<String>,
    stop_requested: bool,
    kill_tx: Option<oneshot::Sender<()>>,
    /// Süreç bitince `true` olur.
    exit_rx: Option<watch::Receiver<bool>>,
}

pub struct ServerHandle {
    id: String,
    state: Mutex<State>,
    stdin: tokio::sync::Mutex<Option<ChildStdin>>,
}

impl ServerHandle {
    fn new(id: &str) -> Self {
        Self {
            id: id.to_string(),
            state: Mutex::new(State {
                status: ServerStatus::Stopped,
                logs: VecDeque::new(),
                players: BTreeSet::new(),
                rejected: BTreeSet::new(),
                stop_requested: false,
                kill_tx: None,
                exit_rx: None,
            }),
            stdin: tokio::sync::Mutex::new(None),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn status(&self) -> ServerStatus {
        self.lock().status
    }

    fn set_status(&self, app: &AppHandle, status: ServerStatus) {
        self.lock().status = status;
        self.emit_status(app, status);
    }

    /// Durum hâlâ `from` ise `to`'ya geçer (arada stop gelmişse dokunmaz).
    fn transition(&self, app: &AppHandle, from: ServerStatus, to: ServerStatus) {
        {
            let mut s = self.lock();
            if s.status != from {
                return;
            }
            s.status = to;
        }
        self.emit_status(app, to);
    }

    /// Oyuncu listesini günceller (`Some(true)` giriş, `Some(false)` çıkış, `None` temizle).
    fn update_players(&self, app: &AppHandle, change: Option<(&str, bool)>) {
        let players: Vec<String> = {
            let mut s = self.lock();
            match change {
                Some((name, true)) => {
                    s.players.insert(name.to_string());
                }
                Some((name, false)) => {
                    s.players.remove(name);
                }
                None => s.players.clear(),
            }
            s.players.iter().cloned().collect()
        };
        let _ = app.emit(
            EVENT_PLAYERS,
            PlayersPayload {
                id: &self.id,
                players,
            },
        );
    }

    /// Atılanlar listesi; `Some(isim)` ekler, `forget` ile çıkarılır.
    fn add_rejected(&self, app: &AppHandle, name: &str) {
        let list: Vec<String> = {
            let mut s = self.lock();
            s.rejected.insert(name.to_string());
            s.rejected.iter().cloned().collect()
        };
        let _ = app.emit(
            EVENT_REJECTED,
            PlayersPayload {
                id: &self.id,
                players: list,
            },
        );
    }

    fn forget_rejected(&self, app: &AppHandle, name: &str) {
        let list: Vec<String> = {
            let mut s = self.lock();
            s.rejected.retain(|n| !n.eq_ignore_ascii_case(name));
            s.rejected.iter().cloned().collect()
        };
        let _ = app.emit(
            EVENT_REJECTED,
            PlayersPayload {
                id: &self.id,
                players: list,
            },
        );
    }

    fn emit_status(&self, app: &AppHandle, status: ServerStatus) {
        let _ = app.emit(
            EVENT_STATUS,
            StatusPayload {
                id: &self.id,
                status,
            },
        );
    }

    fn push_log(&self, app: &AppHandle, stream: LogStream, line: String) {
        let entry = LogLine {
            stream,
            line,
            ts: now_ms(),
        };
        let _ = app.emit(
            EVENT_LOG,
            LogPayload {
                id: &self.id,
                line: &entry,
            },
        );
        let mut s = self.lock();
        if s.logs.len() >= LOG_BACKLOG {
            s.logs.pop_front();
        }
        s.logs.push_back(entry);
    }

    fn emit_stats(&self, app: &AppHandle, stats: &stats::ProcessStats) {
        let _ = app.emit(
            EVENT_STATS,
            StatsPayload {
                id: &self.id,
                stats,
            },
        );
    }

    async fn write_line(&self, line: &str) -> AppResult<()> {
        let mut guard = self.stdin.lock().await;
        let stdin = guard
            .as_mut()
            .ok_or_else(|| AppError::msg(tx!("Sunucu çalışmıyor", "The server isn't running")))?;
        stdin.write_all(format!("{line}\n").as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    fn kill(&self) {
        if let Some(tx) = self.lock().kill_tx.take() {
            let _ = tx.send(());
        }
    }
}

async fn wait_exit(rx: &mut watch::Receiver<bool>, limit: Duration) -> bool {
    matches!(
        tokio::time::timeout(limit, rx.wait_for(|exited| *exited)).await,
        Ok(Ok(_))
    )
}

#[derive(Default)]
pub struct ServerManager {
    servers: Mutex<HashMap<String, Arc<ServerHandle>>>,
}

impl ServerManager {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<ServerHandle>>> {
        self.servers.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn get(&self, id: &str) -> Option<Arc<ServerHandle>> {
        self.map().get(id).cloned()
    }

    fn get_or_create(&self, id: &str) -> Arc<ServerHandle> {
        self.map()
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(ServerHandle::new(id)))
            .clone()
    }

    pub fn snapshot(&self, id: &str) -> ServerSnapshot {
        match self.get(id) {
            Some(h) => {
                let s = h.lock();
                ServerSnapshot {
                    status: s.status,
                    logs: s.logs.iter().cloned().collect(),
                    players: s.players.iter().cloned().collect(),
                    rejected: s.rejected.iter().cloned().collect(),
                }
            }
            None => ServerSnapshot {
                status: ServerStatus::Stopped,
                logs: Vec::new(),
                players: Vec::new(),
                rejected: Vec::new(),
            },
        }
    }

    pub fn any_active(&self) -> bool {
        self.map().values().any(|h| h.status().is_active())
    }

    pub async fn start(&self, app: &AppHandle, id: &str, spec: LaunchSpec) -> AppResult<()> {
        let h = self.get_or_create(id);
        {
            let mut s = h.lock();
            if s.status.is_active() {
                return Err(AppError::msg(tx!(
                    "Sunucu zaten çalışıyor",
                    "The server is already running"
                )));
            }
            s.status = ServerStatus::Starting;
            s.stop_requested = false;
            s.logs.clear();
            s.players.clear();
            s.rejected.clear();
        }
        h.emit_status(app, ServerStatus::Starting);
        process::spawn(app, &h, spec).await
    }

    /// Önce `stop` komutu, `STOP_TIMEOUT` içinde kapanmazsa kill. Süreç bitene kadar bekler.
    pub async fn stop(&self, app: &AppHandle, id: &str) -> AppResult<()> {
        let Some(h) = self.get(id) else {
            return Ok(());
        };
        let (already_stopping, exit_rx) = {
            let mut s = h.lock();
            match s.status {
                ServerStatus::Starting | ServerStatus::Running => {
                    s.stop_requested = true;
                    s.status = ServerStatus::Stopping;
                    (false, s.exit_rx.clone())
                }
                ServerStatus::Stopping => (true, s.exit_rx.clone()),
                _ => return Ok(()),
            }
        };
        let Some(mut exit_rx) = exit_rx else {
            return Ok(());
        };
        if already_stopping {
            wait_exit(&mut exit_rx, STOP_TIMEOUT + KILL_GRACE).await;
            return Ok(());
        }

        h.emit_status(app, ServerStatus::Stopping);
        let sent = h.write_line("stop").await.is_ok();
        if !sent || !wait_exit(&mut exit_rx, STOP_TIMEOUT).await {
            h.push_log(
                app,
                LogStream::System,
                tx!(
                    "Sunucu yanıt vermedi, zorla kapatılıyor.",
                    "The server didn't respond; forcing it to stop."
                ),
            );
            h.kill();
            wait_exit(&mut exit_rx, KILL_GRACE).await;
        }
        Ok(())
    }

    pub async fn send_command(&self, app: &AppHandle, id: &str, command: &str) -> AppResult<()> {
        let h = self
            .get(id)
            .filter(|h| matches!(h.status(), ServerStatus::Starting | ServerStatus::Running))
            .ok_or_else(|| AppError::msg(tx!("Sunucu çalışmıyor", "The server isn't running")))?;
        // Tek satır: araya gizlenmiş ikinci bir komut gönderilemesin.
        let command = command.lines().next().unwrap_or("").trim();
        if command.is_empty() {
            return Ok(());
        }
        h.push_log(app, LogStream::System, format!("> {command}"));
        h.write_line(command).await
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.get(id).is_some_and(|h| h.status().is_active())
    }

    /// Kabul edilen bir oyuncuyu "girmeye çalışanlar" listesinden düşürür.
    pub fn forget_rejected(&self, app: &AppHandle, id: &str, name: &str) {
        if let Some(h) = self.get(id) {
            h.forget_rejected(app, name);
        }
    }

    pub async fn stop_all(&self, app: &AppHandle) {
        let ids: Vec<String> = self
            .map()
            .iter()
            .filter(|(_, h)| h.status().is_active())
            .map(|(id, _)| id.clone())
            .collect();
        futures_util::future::join_all(ids.iter().map(|id| self.stop(app, id))).await;
    }
}
