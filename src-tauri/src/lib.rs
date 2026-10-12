// `tx!` (iki dilli metin) bütün modüllerde görünsün diye ilk sırada.
#[macro_use]
mod i18n;

mod auth;
mod client;
mod client_cmds;
mod commands;
mod consts;
mod covers;
mod download;
mod error;
mod game;
mod game_cmds;
mod hash;
mod instance;
mod invite;
mod java;
mod join;
mod join_cmds;
mod loaders;
mod media;
mod migrate;
mod modrinth;
mod mods;
mod mods_cmds;
mod net;
mod net_cmds;
mod p2p;
mod paths;
mod players;
mod properties;
mod registry;
mod server;
mod sessions;
mod settings;
mod util;
mod world_cmds;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

use commands::AppState;
use java::JavaManager;
use join::JoinManager;
use join_cmds::PendingInvite;
use loaders::Loaders;
use net::NetManager;
use p2p::P2p;
use registry::Registry;
use server::ServerManager;
use settings::SettingsStore;

pub const EVENT_SHUTTING_DOWN: &str = "app://shutting-down";
/// Davet linki geldi; arayüz `take_pending_invite` ile alır.
pub const EVENT_INVITE: &str = "join://invite";

/// Kapanış başladıysa ikinci kez tetiklenmesin.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

pub(crate) fn focus_main(app: &AppHandle) {
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
        // Modemde açılan portlar kapansın, doğrudan bağlantılar düzgünce kapansın.
        app.state::<Arc<NetManager>>().shutdown().await;
        app.state::<Arc<P2p>>().close().await;
        app.exit(0);
    });
}

fn needs_graceful_shutdown(app: &AppHandle) -> bool {
    !SHUTTING_DOWN.load(Ordering::SeqCst) && app.state::<AppState>().servers.any_active()
}

/// Pencere kapatılınca arka planda (tray) kalmalı mı: çalışan sunucu ya da katılınan dünya varsa.
fn keep_in_background(app: &AppHandle) -> bool {
    app.state::<AppState>().servers.any_active() || app.state::<Arc<JoinManager>>().any_now()
}

/// `cubby://join?d=...` linki: sakla, pencereyi öne getir, arayüze haber ver.
fn handle_invite_urls(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let Some(url) = urls
        .into_iter()
        .find(|u| u.starts_with(&format!("{}://", consts::URL_SCHEME)))
    else {
        return;
    };
    *app.state::<PendingInvite>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(url);
    focus_main(app);
    let _ = app.emit(EVENT_INVITE, ());
}

fn tray_menu<R: tauri::Runtime, M: Manager<R>>(app: &M) -> tauri::Result<Menu<R>> {
    let open = MenuItem::with_id(app, "open", tx!("Aç", "Open"), true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        "quit",
        tx!("Tamamen kapat", "Quit"),
        true,
        None::<&str>,
    )?;
    Menu::with_items(app, &[&open, &quit])
}

/// Dil değişince tepsi menüsü yeni dille kurulur.
pub(crate) fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = tray_menu(app)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Cubby")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => focus_main(app),
            "quit" => begin_shutdown(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = e
            {
                focus_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(consts::USER_AGENT)
        .build()
        .expect("HTTP istemcisi oluşturulamadı");

    let app = tauri::Builder::default()
        // İkinci kopya açılırsa mevcut pencere öne gelir; `deep-link` özelliği linki buraya iletir.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main(app)
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup({
            let http = http.clone();
            move |app| {
                let data = app.path().app_data_dir()?;
                // Ad değişti: eski veri klasörü (com.firatmio.mc-server-launcher) taşınır.
                migrate::app_data(&data);
                app.manage(Registry::load(&data));
                app.manage(SettingsStore::load(&data));
                app.manage(JavaManager::new(data.join("java"), http.clone()));
                app.manage(auth::AuthManager::new(http.clone(), data.clone()));
                app.manage(game_cmds::GameState::default());
                let net = Arc::new(NetManager::new(http));
                net::install(app.handle(), net.clone());
                app.manage(net);
                sessions::install(app.handle());

                // Uygulamalar arası doğrudan bağlantı: host olarak dinle, katılınan dünyaları aç.
                let p2p = tauri::async_runtime::block_on(P2p::bind(&data))?;
                p2p.serve(join_cmds::host_decider(app.handle().clone()));
                let joins = JoinManager::load(&data, p2p.clone());
                joins.start(app.handle());
                app.manage(p2p);
                app.manage(joins);

                app.manage(PendingInvite::default());
                app.manage(mods_cmds::ModIcons::default());
                app.manage(mods_cmds::ModImages::default());
                app.manage(client_cmds::ClientStates::default());
                client_cmds::install(app.handle());
                // Kurulumda NSIS kaydeder; geliştirirken ve taşınabilir kullanımda burada kaydedilir.
                #[cfg(any(windows, target_os = "linux"))]
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("Davet linki şeması kaydedilemedi: {e}");
                }
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    handle_invite_urls(&handle, event.urls().into_iter().map(|u| u.to_string()));
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    handle_invite_urls(app.handle(), urls.into_iter().map(|u| u.to_string()));
                }

                build_tray(app)?;
                Ok(())
            }
        })
        // Kapak ve ekran görüntüsü önizlemeleri (dosya okuma + küçültme, blocking).
        .register_asynchronous_uri_scheme_protocol(media::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_string();
            // Mod ikonları ağdan gelebilir (async); diğerleri dosya okuma + küçültme (blocking).
            if let Some(project) = mods_cmds::is_image_path(&path) {
                tauri::async_runtime::spawn(async move {
                    responder.respond(mods_cmds::gallery_response(&app, &project).await);
                });
                return;
            }
            if let Some(project) = mods_cmds::is_icon_path(&path) {
                tauri::async_runtime::spawn(async move {
                    responder.respond(mods_cmds::icon_response(&app, &project).await);
                });
                return;
            }
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media::respond(&app, &path));
            });
        })
        .manage(AppState {
            loaders: Loaders::new(http.clone()),
            http,
            servers: Arc::new(ServerManager::default()),
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if SHUTTING_DOWN.load(Ordering::SeqCst) {
                    api.prevent_close();
                } else if keep_in_background(app) {
                    // Sunucu ya da arkadaşın dünyasına bağlantı sürsün; tray'den açılır/kapatılır.
                    api.prevent_close();
                    let _ = window.hide();
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
            world_cmds::get_properties,
            world_cmds::update_properties,
            world_cmds::world_access,
            world_cmds::lookup_player,
            world_cmds::whitelist_add,
            world_cmds::whitelist_remove,
            world_cmds::set_whitelist_enabled,
            world_cmds::set_offline_mode,
            world_cmds::set_op,
            world_cmds::kick_player,
            net_cmds::connection_status,
            net_cmds::set_internet,
            join_cmds::create_invite,
            join_cmds::reset_invite,
            join_cmds::preview_invite,
            join_cmds::join_world,
            join_cmds::list_joined,
            join_cmds::remove_joined,
            join_cmds::readd_server_entry,
            join_cmds::server_entry_exists,
            join_cmds::refresh_joined,
            join_cmds::take_pending_invite,
            join_cmds::update_joined_mods,
            join_cmds::play_joined,
            game_cmds::account_status,
            game_cmds::account_login,
            game_cmds::account_logout,
            game_cmds::open_game_log,
            game_cmds::game_running,
            mods_cmds::mods_search,
            mods_cmds::mods_project,
            mods_cmds::mods_install,
            mods_cmds::mods_installed,
            mods_cmds::mods_remove,
            mods_cmds::mods_update,
            mods_cmds::mods_update_all,
            client_cmds::client_status,
            client_cmds::client_resync,
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
