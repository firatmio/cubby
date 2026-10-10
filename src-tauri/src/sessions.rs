//! Oynama oturumları: sunucunun "açık" olduğu aralıklar (`<instance>/.mcsm/sessions.json`).
//! Ekran görüntülerini dünyaya eşlemek ve "son oynanma" bilgisi için.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::covers;
use crate::error::AppResult;
use crate::paths;
use crate::server::EVENT_STATUS;
use crate::util::now_ms;

pub const META_DIR: &str = ".mcsm";
const SESSIONS_FILE: &str = "sessions.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayStats {
    pub last_played_at: Option<u64>,
    pub total_ms: u64,
}

pub fn load(instance_dir: &Path) -> Vec<Session> {
    std::fs::read_to_string(instance_dir.join(META_DIR).join(SESSIONS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn append(instance_dir: &Path, session: Session) -> AppResult<()> {
    let meta = instance_dir.join(META_DIR);
    std::fs::create_dir_all(&meta)?;
    let mut all = load(instance_dir);
    all.push(session);
    let tmp = meta.join(format!("{SESSIONS_FILE}.tmp"));
    std::fs::write(&tmp, serde_json::to_string(&all)?)?;
    std::fs::rename(tmp, meta.join(SESSIONS_FILE))?;
    Ok(())
}

pub fn stats(sessions: &[Session]) -> PlayStats {
    PlayStats {
        last_played_at: sessions.iter().map(|s| s.end).max(),
        total_ms: sessions.iter().map(|s| s.end.saturating_sub(s.start)).sum(),
    }
}

#[derive(Deserialize)]
struct StatusPayload {
    id: String,
    status: String,
}

/// `server://status` olaylarını Rust tarafında dinler: `running` oturumu başlatır,
/// `stopped`/`crashed` bitirip kaydeder ve kapak güncellemesini tetikler.
pub fn install(app: &AppHandle) {
    let started: Mutex<HashMap<String, u64>> = Mutex::new(HashMap::new());
    let handle = app.clone();
    app.listen_any(EVENT_STATUS, move |event| {
        let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload()) else {
            return;
        };
        let mut started = started.lock().unwrap_or_else(|e| e.into_inner());
        match p.status.as_str() {
            "running" => {
                started.insert(p.id, now_ms());
            }
            "stopped" | "crashed" => {
                let Some(start) = started.remove(&p.id) else {
                    return;
                };
                let session = Session {
                    start,
                    end: now_ms(),
                };
                if let Ok(dir) = paths::instance_dir(&handle, &p.id) {
                    if let Err(e) = append(&dir, session) {
                        eprintln!("Oturum kaydedilemedi: {e}");
                    }
                    let app = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = covers::after_session(&app, &p.id, session).await {
                            eprintln!("Kapak güncellenemedi: {e}");
                        }
                    });
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_and_summarizes() {
        let dir = std::env::temp_dir().join(format!("mcsm-sess-{}", uuid::Uuid::new_v4()));
        append(
            &dir,
            Session {
                start: 1_000,
                end: 61_000,
            },
        )
        .unwrap();
        append(
            &dir,
            Session {
                start: 100_000,
                end: 160_000,
            },
        )
        .unwrap();
        let all = load(&dir);
        assert_eq!(all.len(), 2);
        let s = stats(&all);
        assert_eq!(s.last_played_at, Some(160_000));
        assert_eq!(s.total_ms, 120_000);
        assert_eq!(stats(&[]).last_played_at, None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
