//! İnternetten katılım. Dünya "internete açık" ve çalışırken modemde port açılır (UPnP).
//! Modem izin vermiyorsa (ya da CGNAT varsa) M7'de uygulamalar arası doğrudan bağlantı devreye girer.

pub mod upnp;

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::commands::{AppState, server_port};
use crate::error::AppResult;
use crate::server::{EVENT_STATUS, ServerStatus};
use crate::{instance, paths};
use upnp::Mapping;

pub const EVENT_NET: &str = "net://status";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RouteState {
    /// Dünya kapalı ya da internete açık değil.
    #[default]
    Off,
    Working,
    Ok,
    Error,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub state: RouteState,
    pub address: Option<String>,
    pub message: Option<String>,
}

impl Route {
    fn working() -> Self {
        Self {
            state: RouteState::Working,
            ..Default::default()
        }
    }
    fn ok(address: String) -> Self {
        Self {
            state: RouteState::Ok,
            address: Some(address),
            message: None,
        }
    }
    fn error(message: String) -> Self {
        Self {
            state: RouteState::Error,
            address: None,
            message: Some(message),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    pub lan: Option<String>,
    pub internet: bool,
    /// Modem üzerinden (UPnP)
    pub direct: Route,
}

#[derive(Serialize, Clone)]
struct NetPayload<'a> {
    id: &'a str,
    view: &'a ConnectionView,
}

#[derive(Default)]
struct World {
    direct: Route,
    mapping: Option<Mapping>,
    renew: Option<CancellationToken>,
}

pub struct NetManager {
    http: reqwest::Client,
    worlds: Mutex<HashMap<String, World>>,
}

fn local_ipv4() -> Option<Ipv4Addr> {
    match local_ip_address::local_ip().ok()? {
        IpAddr::V4(ip) => Some(ip),
        IpAddr::V6(_) => None,
    }
}

fn is_running(app: &AppHandle, id: &str) -> bool {
    app.state::<AppState>().servers.snapshot(id).status == ServerStatus::Running
}

impl NetManager {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            worlds: Mutex::new(HashMap::new()),
        }
    }

    pub async fn view(&self, app: &AppHandle, id: &str) -> AppResult<ConnectionView> {
        let inst = instance::get(app, id)?;
        let port = server_port(&paths::server_dir(app, id)?, inst.port);
        let worlds = self.worlds.lock().await;
        Ok(ConnectionView {
            lan: local_ipv4().map(|ip| format!("{ip}:{port}")),
            internet: inst.internet,
            direct: worlds.get(id).map(|w| w.direct.clone()).unwrap_or_default(),
        })
    }

    pub async fn emit(&self, app: &AppHandle, id: &str) {
        if let Ok(view) = self.view(app, id).await {
            let _ = app.emit(EVENT_NET, NetPayload { id, view: &view });
        }
    }

    /// Dünya çalışıyor ve internete açık: modemde port aç.
    pub async fn up(self: &Arc<Self>, app: &AppHandle, id: &str) {
        {
            let mut worlds = self.worlds.lock().await;
            if worlds.contains_key(id) {
                return;
            }
            worlds.insert(
                id.to_string(),
                World {
                    direct: Route::working(),
                    ..Default::default()
                },
            );
        }
        self.emit(app, id).await;

        let (me, app2, id2) = (self.clone(), app.clone(), id.to_string());
        tauri::async_runtime::spawn(async move { me.up_direct(&app2, &id2).await });
    }

    async fn up_direct(self: &Arc<Self>, app: &AppHandle, id: &str) {
        let result = async {
            let inst = instance::get(app, id).map_err(|e| e.to_string())?;
            let port = server_port(
                &paths::server_dir(app, id).map_err(|e| e.to_string())?,
                inst.port,
            );
            let ip = local_ipv4().ok_or(tx!(
                "Bu bilgisayarın yerel ağ adresi bulunamadı.",
                "Couldn't find this computer's local network address."
            ))?;
            upnp::open(&self.http, ip, port)
                .await
                .map_err(|e| e.message())
        }
        .await;

        let mut worlds = self.worlds.lock().await;
        let Some(world) = worlds.get_mut(id) else {
            // Bu arada dünya kapandı.
            if let Ok(m) = result {
                m.close().await;
            }
            return;
        };
        match result {
            Ok(mapping) => {
                world.direct = Route::ok(mapping.public.to_string());
                world.mapping = Some(mapping);
                let token = CancellationToken::new();
                world.renew = Some(token.clone());
                let (me, id) = (self.clone(), id.to_string());
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::select! {
                            _ = token.cancelled() => return,
                            _ = tokio::time::sleep(upnp::RENEW_EVERY) => {}
                        }
                        let worlds = me.worlds.lock().await;
                        let Some(m) = worlds.get(&id).and_then(|w| w.mapping.as_ref()) else {
                            return;
                        };
                        let _ = m.renew().await;
                    }
                });
            }
            Err(message) => world.direct = Route::error(message),
        }
        drop(worlds);
        self.emit(app, id).await;
    }

    /// Dünya kapandı ya da internetten çıkarıldı.
    pub async fn down(&self, app: &AppHandle, id: &str) {
        let world = self.worlds.lock().await.remove(id);
        if let Some(world) = world {
            if let Some(t) = world.renew {
                t.cancel();
            }
            if let Some(m) = world.mapping {
                m.close().await;
            }
        }
        self.emit(app, id).await;
    }

    pub async fn set_internet(
        self: &Arc<Self>,
        app: &AppHandle,
        id: &str,
        on: bool,
    ) -> AppResult<ConnectionView> {
        instance::modify(&paths::instance_dir(app, id)?, |i| {
            i.internet = on;
            Ok(())
        })?;
        if is_running(app, id) {
            if on {
                self.up(app, id).await;
            } else {
                self.down(app, id).await;
            }
        }
        self.view(app, id).await
    }

    pub async fn shutdown(&self) {
        let worlds: Vec<World> = self.worlds.lock().await.drain().map(|(_, w)| w).collect();
        for w in worlds {
            if let Some(t) = w.renew {
                t.cancel();
            }
            if let Some(m) = w.mapping {
                m.close().await;
            }
        }
    }
}

#[derive(Deserialize)]
struct StatusPayload {
    id: String,
    status: String,
}

/// Sunucu durumlarını dinler: açılınca port açılır, kapanınca kapatılır.
pub fn install(app: &AppHandle, net: Arc<NetManager>) {
    let handle = app.clone();
    app.listen_any(EVENT_STATUS, move |event| {
        let Ok(p) = serde_json::from_str::<StatusPayload>(event.payload()) else {
            return;
        };
        let (app, net) = (handle.clone(), net.clone());
        tauri::async_runtime::spawn(async move {
            match p.status.as_str() {
                "running" if instance::get(&app, &p.id).is_ok_and(|i| i.internet) => {
                    net.up(&app, &p.id).await;
                }
                "stopped" | "crashed" => net.down(&app, &p.id).await,
                _ => {}
            }
        });
    });
}
