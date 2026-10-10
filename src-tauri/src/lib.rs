mod commands;
mod consts;
mod download;
mod error;
mod hash;
mod instance;
mod java;
mod loaders;
mod paths;
mod server;
mod util;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

use commands::AppState;
use loaders::vanilla::VanillaApi;
use server::ServerManager;

pub const EVENT_SHUTTING_DOWN: &str = "app://shutting-down";

/// Kapanış başladıysa ikinci kez tetiklenmesin.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Çalışan sunucuları düzgünce durdurur, sonra uygulamayı kapatır.
fn begin_shutdown(app: &AppHandle) {
    if SHUTTING_DOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit(EVENT_SHUTTING_DOWN, ());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let servers = app.state::<AppState>().servers.clone();
        servers.stop_all(&app).await;
        app.exit(0);
    });
}

fn needs_graceful_shutdown(app: &AppHandle) -> bool {
    !SHUTTING_DOWN.load(Ordering::SeqCst) && app.state::<AppState>().servers.any_active()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(consts::USER_AGENT)
        .build()
        .expect("HTTP istemcisi oluşturulamadı");

    let app = tauri::Builder::default()
        // İkinci kopya açılırsa mevcut pencere öne gelir (M7: deep-link de buradan gelecek).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main(app)
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            vanilla: VanillaApi::new(http),
            servers: Arc::new(ServerManager::default()),
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if SHUTTING_DOWN.load(Ordering::SeqCst) || needs_graceful_shutdown(app) {
                    api.prevent_close();
                    begin_shutdown(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::system_info,
            commands::list_mc_versions,
            commands::list_instances,
            commands::get_instance,
            commands::create_instance,
            commands::eula_status,
            commands::accept_eula,
            commands::start_server,
            commands::stop_server,
            commands::send_command,
            commands::server_snapshot,
            commands::open_instance_dir,
        ])
        .build(tauri::generate_context!())
        .expect("Tauri uygulaması oluşturulamadı");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, .. } = event
            && needs_graceful_shutdown(app)
        {
            api.prevent_exit();
            begin_shutdown(app);
        }
    });
}
