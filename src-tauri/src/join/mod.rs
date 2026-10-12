//! Katıl modu: arkadaşın dünyasına uygulama üzerinden doğrudan bağlanma.
//!
//! Her katılınan dünya için `127.0.0.1:<yerel port>` dinlenir; Minecraft oraya bağlanınca
//! bağlantı iroh üzerinden host'a taşınır. Sunucu listesindeki kayıt bu yerel adrestir.

pub mod client;
pub mod servers_dat;

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use iroh::EndpointId;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::invite::Invite;
use crate::loaders::LoaderKind;
use crate::p2p::protocol::Reply;
use crate::p2p::{P2p, PathKind};
use crate::util::now_ms;

pub const EVENT_STATUS: &str = "join://status";
const FILE: &str = "joined.json";
const PORTS: std::ops::RangeInclusive<u16> = 25600..=25999;
const POLL_EVERY: Duration = Duration::from_secs(20);
const PING_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinedWorld {
    pub id: String,
    pub name: String,
    pub host: String,
    pub world: String,
    pub token: String,
    pub loader: LoaderKind,
    pub mc_version: String,
    pub loader_version: Option<String>,
    pub local_port: u16,
    pub added_at: u64,
    /// Modlar kurulduysa: Launcher'da seçilecek profil (ya da TLauncher sürümü) ve oyun klasörü.
    #[serde(default)]
    pub profile: Option<String>,
    #[serde(default)]
    pub game_dir: Option<String>,
    /// Kurulan mod listesinin özeti; host'unki değişince "güncelle" çıkar.
    #[serde(default)]
    pub mods_rev: Option<String>,
    /// Önerilen modlar da kurulsun mu (katılırken seçilen).
    #[serde(default)]
    pub with_recommended: bool,
}

impl JoinedWorld {
    pub fn address(&self) -> String {
        format!("127.0.0.1:{}", self.local_port)
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinStatus {
    /// `None`: henüz denenmedi.
    pub reachable: Option<bool>,
    /// Arkadaşının dünyası şu an çalışıyor mu?
    pub running: bool,
    pub path: Option<PathKind>,
    pub error: Option<String>,
    /// Host'un şu anki mod listesi özeti.
    pub mods_rev: Option<String>,
}

#[derive(Serialize, Clone)]
struct StatusPayload<'a> {
    id: &'a str,
    status: &'a JoinStatus,
}

pub struct JoinManager {
    file: PathBuf,
    p2p: Arc<P2p>,
    worlds: Mutex<Vec<JoinedWorld>>,
    listeners: Mutex<HashMap<String, CancellationToken>>,
    status: Mutex<HashMap<String, JoinStatus>>,
}

fn host_id(w: &JoinedWorld) -> AppResult<EndpointId> {
    w.host.parse().map_err(|_| {
        AppError::msg(tx!(
            "Davet bozuk: arkadaşının kimliği okunamadı.",
            "Broken invite: couldn't read your friend's ID."
        ))
    })
}

/// Ping sonucunu arayüz durumuna çevirir.
pub fn status_from(result: AppResult<(Reply, PathKind)>) -> JoinStatus {
    match result {
        Ok((
            Reply::Ok {
                running, mods_rev, ..
            },
            path,
        )) => JoinStatus {
            reachable: Some(true),
            running,
            path: Some(path),
            error: None,
            mods_rev,
        },
        Ok((Reply::Offline, path)) => JoinStatus {
            reachable: Some(true),
            running: false,
            path: Some(path),
            error: None,
            mods_rev: None,
        },
        Ok((Reply::Denied, _)) => JoinStatus {
            reachable: Some(true),
            running: false,
            path: None,
            error: Some(tx!(
                "Davet artık geçerli değil. Arkadaşından yeni bir davet iste.",
                "This invite is no longer valid. Ask your friend for a new one."
            )),
            mods_rev: None,
        },
        Err(_) => JoinStatus {
            reachable: Some(false),
            running: false,
            path: None,
            error: None,
            mods_rev: None,
        },
    }
}

/// Kullanılan portlar dışında, şu an boş olan ilk port.
fn free_port(taken: &[u16]) -> AppResult<u16> {
    PORTS
        .filter(|p| !taken.contains(p))
        .find(|p| std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, *p)).is_ok())
        .ok_or_else(|| {
            AppError::msg(tx!(
                "Bağlantı için boş port bulunamadı.",
                "No free port found for the connection."
            ))
        })
}

impl JoinManager {
    pub fn load(app_data: &Path, p2p: Arc<P2p>) -> Arc<Self> {
        let file = app_data.join(FILE);
        let worlds = std::fs::read_to_string(&file)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Arc::new(Self {
            file,
            p2p,
            worlds: Mutex::new(worlds),
            listeners: Mutex::new(HashMap::new()),
            status: Mutex::new(HashMap::new()),
        })
    }

    async fn save(&self, worlds: &[JoinedWorld]) -> AppResult<()> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(worlds)?)?;
        std::fs::rename(tmp, &self.file)?;
        Ok(())
    }

    pub async fn list(&self) -> Vec<JoinedWorld> {
        self.worlds.lock().await.clone()
    }

    pub async fn get(&self, id: &str) -> AppResult<JoinedWorld> {
        self.worlds
            .lock()
            .await
            .iter()
            .find(|w| w.id == id)
            .cloned()
            .ok_or_else(|| {
                AppError::msg(tx!(
                    "Bu dünya listede yok.",
                    "This world isn't in the list."
                ))
            })
    }

    pub async fn status(&self, id: &str) -> JoinStatus {
        self.status
            .lock()
            .await
            .get(id)
            .cloned()
            .unwrap_or_default()
    }

    /// Senkron kontrol (pencere kapanırken); kilit meşgulse "var" sayılır.
    pub fn any_now(&self) -> bool {
        self.worlds
            .try_lock()
            .map(|w| !w.is_empty())
            .unwrap_or(true)
    }

    pub async fn find(&self, host: &str, world: &str) -> Option<JoinedWorld> {
        self.worlds
            .lock()
            .await
            .iter()
            .find(|w| w.host == host && w.world == world)
            .cloned()
    }

    /// Açılışta: kayıtlı dünyaları dinlemeye başla, durum yoklamasını kur.
    pub fn start(self: &Arc<Self>, app: &AppHandle) {
        let (me, app) = (self.clone(), app.clone());
        tauri::async_runtime::spawn(async move {
            for w in me.list().await {
                me.listen(&app, &w).await;
            }
            loop {
                me.poll_all(&app).await;
                tokio::time::sleep(POLL_EVERY).await;
            }
        });
    }

    async fn set_status(&self, app: &AppHandle, id: &str, status: JoinStatus) {
        self.status
            .lock()
            .await
            .insert(id.to_string(), status.clone());
        let _ = app.emit(
            EVENT_STATUS,
            StatusPayload {
                id,
                status: &status,
            },
        );
    }

    pub async fn poll(&self, app: &AppHandle, w: &JoinedWorld) {
        let result = match host_id(w) {
            Ok(host) => tokio::time::timeout(PING_TIMEOUT, self.p2p.ping(host, &w.world, &w.token))
                .await
                .unwrap_or_else(|_| Err(AppError::msg(tx!("zaman aşımı", "timed out")))),
            Err(e) => Err(e),
        };
        let mut status = status_from(result);
        // Dinleyici hatası (ör. port dolu) varsa göster.
        if status.error.is_none()
            && let Some(old) = self.status.lock().await.get(&w.id)
            && old.error.as_deref().is_some_and(|e| e.starts_with("Port"))
        {
            status.error = old.error.clone();
        }
        self.set_status(app, &w.id, status).await;
    }

    async fn poll_all(self: &Arc<Self>, app: &AppHandle) {
        let worlds = self.list().await;
        let tasks: Vec<_> = worlds
            .into_iter()
            .map(|w| {
                let (me, app) = (self.clone(), app.clone());
                tauri::async_runtime::spawn(async move { me.poll(&app, &w).await })
            })
            .collect();
        for t in tasks {
            let _ = t.await;
        }
    }

    /// `127.0.0.1:<yerel port>`'u dinler; gelen her Minecraft bağlantısını host'a taşır.
    async fn listen(self: &Arc<Self>, app: &AppHandle, w: &JoinedWorld) {
        if let Some(old) = self.listeners.lock().await.remove(&w.id) {
            old.cancel();
        }
        let listener = match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, w.local_port))
            .await
        {
            Ok(l) => l,
            Err(_) => {
                let status = JoinStatus {
                    error: Some(tx!(
                        "Port {} başka bir program tarafından kullanılıyor; dünyayı kaldırıp yeniden katıl.",
                        "Port {} is used by another program; remove the world and join again.",
                        w.local_port
                    )),
                    ..Default::default()
                };
                self.set_status(app, &w.id, status).await;
                return;
            }
        };
        let token = CancellationToken::new();
        self.listeners
            .lock()
            .await
            .insert(w.id.clone(), token.clone());

        let (p2p, w) = (self.p2p.clone(), w.clone());
        tauri::async_runtime::spawn(async move {
            let Ok(host) = host_id(&w) else { return };
            loop {
                let accepted = tokio::select! {
                    _ = token.cancelled() => return,
                    a = listener.accept() => a,
                };
                let Ok((tcp, _)) = accepted else { continue };
                let _ = tcp.set_nodelay(true);
                let (p2p, world, secret) = (p2p.clone(), w.world.clone(), w.token.clone());
                tauri::async_runtime::spawn(async move {
                    // Hata olursa TCP kapanır; Minecraft "bağlantı kurulamadı" der, durum kartı nedenini gösterir.
                    let _ = p2p.pipe_tcp(host, &world, &secret, tcp).await;
                });
            }
        });
    }

    /// Daveti kaydeder (aynı dünyaya önceden katıldıysa günceller) ve dinlemeye başlar.
    pub async fn join(
        self: &Arc<Self>,
        app: &AppHandle,
        invite: &Invite,
    ) -> AppResult<JoinedWorld> {
        let mut worlds = self.worlds.lock().await;
        let joined = if let Some(w) = worlds
            .iter_mut()
            .find(|w| w.host == invite.host && w.world == invite.world)
        {
            w.name = invite.name.clone();
            w.token = invite.token.clone();
            w.loader = invite.loader;
            w.mc_version = invite.mc_version.clone();
            w.loader_version = invite.loader_version.clone();
            w.clone()
        } else {
            let taken: Vec<u16> = worlds.iter().map(|w| w.local_port).collect();
            let w = JoinedWorld {
                id: uuid::Uuid::new_v4().to_string(),
                name: invite.name.clone(),
                host: invite.host.clone(),
                world: invite.world.clone(),
                token: invite.token.clone(),
                loader: invite.loader,
                mc_version: invite.mc_version.clone(),
                loader_version: invite.loader_version.clone(),
                local_port: free_port(&taken)?,
                added_at: now_ms(),
                profile: None,
                game_dir: None,
                mods_rev: None,
                with_recommended: false,
            };
            worlds.push(w.clone());
            w
        };
        self.save(&worlds).await?;
        drop(worlds);

        self.listen(app, &joined).await;
        let (me, app2, w) = (self.clone(), app.clone(), joined.clone());
        tauri::async_runtime::spawn(async move { me.poll(&app2, &w).await });
        Ok(joined)
    }

    /// Kaydı günceller (profil, mod özeti…).
    pub async fn update(
        &self,
        id: &str,
        f: impl FnOnce(&mut JoinedWorld),
    ) -> AppResult<JoinedWorld> {
        let mut worlds = self.worlds.lock().await;
        let w = worlds.iter_mut().find(|w| w.id == id).ok_or_else(|| {
            AppError::msg(tx!(
                "Bu dünya listede yok.",
                "This world isn't in the list."
            ))
        })?;
        f(w);
        let out = w.clone();
        self.save(&worlds).await?;
        Ok(out)
    }

    pub async fn remove(&self, id: &str) -> AppResult<JoinedWorld> {
        let mut worlds = self.worlds.lock().await;
        let index = worlds.iter().position(|w| w.id == id).ok_or_else(|| {
            AppError::msg(tx!(
                "Bu dünya listede yok.",
                "This world isn't in the list."
            ))
        })?;
        let removed = worlds.remove(index);
        self.save(&worlds).await?;
        drop(worlds);
        if let Some(t) = self.listeners.lock().await.remove(id) {
            t.cancel();
        }
        self.status.lock().await.remove(id);
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_mapping() {
        let ok = status_from(Ok((
            Reply::Ok {
                running: true,
                name: "x".into(),
                mods_rev: None,
            },
            PathKind::Direct,
        )));
        assert_eq!(ok.reachable, Some(true));
        assert!(ok.running);
        assert_eq!(ok.path, Some(PathKind::Direct));

        let denied = status_from(Ok((Reply::Denied, PathKind::Relay)));
        assert!(denied.error.is_some());
        assert!(!denied.running);

        let down = status_from(Err(AppError::msg("x")));
        assert_eq!(down.reachable, Some(false));
    }

    #[test]
    fn free_port_skips_taken() {
        let p = free_port(&[25600, 25601]).unwrap();
        assert!(PORTS.contains(&p) && p != 25600 && p != 25601);
    }
}
