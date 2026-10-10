mod commands;
mod consts;
mod covers;
mod download;
mod error;
mod hash;
mod instance;
mod java;
mod loaders;
mod media;
mod paths;
mod registry;
mod server;
mod sessions;
mod settings;
mod util;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

use commands::AppState;
use java::JavaManager;
use loaders::Loaders;
use registry::Registry;
use server::ServerManager;
use settings::SettingsStore;

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
        .plugin(tauri_plugin_dialog::init())
        .setup({
            let http = http.clone();
            move |app| {
                let data = app.path().app_data_dir()?;
                app.manage(Registry::load(&data));
                app.manage(SettingsStore::load(&data));
                app.manage(JavaManager::new(data.join("java"), http));
                sessions::install(app.handle());
                Ok(())
            }
        })
        // Kapak ve ekran görüntüsü önizlemeleri (dosya okuma + küçültme, blocking).
        .register_asynchronous_uri_scheme_protocol(media::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media::respond(&app, &path));
            });
        })
        .manage(AppState {
            loaders: Loaders::new(http),
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
            commands::list_game_versions,
            commands::list_loader_versions,
            commands::list_instances,
            commands::get_instance,
            commands::create_instance,
            commands::update_instance,
            commands::delete_instance,
            commands::eula_status,
            commands::accept_eula,
            commands::start_server,
            commands::stop_server,
            commands::send_command,
            commands::server_snapshot,
            commands::open_instance_dir,
            commands::open_content_dir,
            commands::list_java,
            commands::instance_java,
            commands::install_java,
            commands::set_instance_java,
            commands::get_settings,
            commands::update_settings,
            commands::list_screenshots,
            commands::set_cover,
            commands::play_stats,
            commands::lan_address,
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
