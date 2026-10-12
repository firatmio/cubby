//! Microsoft hesabı komutları ve oyunu Launcher'sız açma: dosyaları hazırla → Java → başlat.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use futures_util::TryStreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::auth::{self, Account, AuthManager};
use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::game::{self, Env, FileSpec, assets, launch};
use crate::hash::HashAlgo;
use crate::java::JavaManager;

pub const EVENT_PROGRESS: &str = "game://progress";
pub const EVENT_STATE: &str = "game://state";

/// Aynı anda indirilen dosya sayısı (asset'ler binlerce küçük dosya).
const PARALLEL: usize = 16;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(150);

/// Açık oyunun süreç kimliği (ikinci kez başlatılmasın).
#[derive(Default)]
pub struct GameState(pub Mutex<Option<u32>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// files | java | starting
    stage: &'static str,
    done: usize,
    total: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    /// running | exited
    state: &'static str,
    code: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    /// Bu sürümde Microsoft girişi var mı (Azure kimliği verilmiş mi).
    enabled: bool,
    account: Option<Account>,
}

#[tauri::command]
pub fn account_status(auth: State<'_, AuthManager>) -> AccountStatus {
    AccountStatus {
        enabled: auth::client_id().is_some(),
        account: auth.account(),
    }
}

#[tauri::command]
pub async fn account_login(app: AppHandle, auth: State<'_, AuthManager>) -> AppResult<Account> {
    auth.login(
        |url| {
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|e| AppError::msg(format!("Tarayıcı açılamadı: {e}")))
        },
        // Tarayıcıdan dönmeye gerek kalmasın: giriş biter bitmez uygulama öne gelir.
        || crate::focus_main(&app),
    )
    .await
}

#[tauri::command]
pub async fn account_logout(auth: State<'_, AuthManager>) -> AppResult<()> {
    auth.logout().await;
    Ok(())
}

/// Giriş yapılmış ve sürüm Quick Play'i destekliyorsa oyun Launcher'sız açılabilir.
pub fn direct_available(app: &AppHandle, mc_version: &str) -> bool {
    auth::client_id().is_some()
        && app.state::<AuthManager>().account().is_some()
        && crate::client::quickplay_supported(mc_version)
}

/// Başlatılmaya hazır oyun (oturum anahtarı yalnız bellekte).
pub struct Prepared {
    java: PathBuf,
    args: Vec<String>,
    game_dir: PathBuf,
    token: String,
}

fn emit_progress(app: &AppHandle, stage: &'static str, done: usize, total: usize) {
    let _ = app.emit(EVENT_PROGRESS, Progress { stage, done, total });
}

async fn download_all(
    app: &AppHandle,
    http: &reqwest::Client,
    files: Vec<FileSpec>,
) -> AppResult<()> {
    let total = files.len();
    if total == 0 {
        return Ok(());
    }
    let done = AtomicUsize::new(0);
    let last = Mutex::new(Instant::now() - PROGRESS_INTERVAL);
    emit_progress(app, "files", 0, total);
    futures_util::stream::iter(files.into_iter().map(Ok::<_, AppError>))
        .map_ok(|f| {
            let (done, last) = (&done, &last);
            async move {
                match &f.sha1 {
                    Some(sha1) => {
                        crate::download::download_file(
                            http,
                            &f.url,
                            &f.path,
                            Some((HashAlgo::Sha1, sha1)),
                            |_, _| {},
                        )
                        .await?
                    }
                    None => {
                        crate::loaders::download_maven(http, &f.url, &f.path, |_, _| {}).await?
                    }
                }
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                let mut t = last.lock().unwrap_or_else(|e| e.into_inner());
                if t.elapsed() >= PROGRESS_INTERVAL || n == total {
                    *t = Instant::now();
                    emit_progress(app, "files", n, total);
                }
                Ok::<_, AppError>(())
            }
        })
        .try_buffer_unordered(PARALLEL)
        .try_collect::<()>()
        .await
}

/// Oyuna verilecek bellek: bilgisayarın belleğinin dörtte biri, 2–6 GB arası.
fn game_ram_mb() -> u32 {
    let total = crate::server::stats::total_memory_mb() as u32;
    (total / 4).clamp(2048, 6144)
}

/// Sürümün (ör. `mcsm-test-…`) eksik dosyalarını indirir, Java'yı hazırlar, komutu kurar.
pub async fn prepare(
    app: &AppHandle,
    mc_dir: &Path,
    version_id: &str,
    game_dir: &Path,
) -> AppResult<Prepared> {
    if app
        .state::<GameState>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
    {
        return Err(AppError::msg("Minecraft zaten açık."));
    }
    let session = app.state::<AuthManager>().session().await?;
    let state = app.state::<AppState>();
    let http = state.http.clone();
    let chain = game::load_chain(mc_dir, version_id, |mc| {
        let state = app.state::<AppState>();
        async move { state.loaders.version_json(&mc).await }
    })
    .await?;
    let env = Env::current();
    let merged = game::merge(&chain, mc_dir, env)?;

    // Önce asset index'i (nesne listesi onun içinde), sonra her şey birlikte.
    let index_ref = merged.asset_index.clone().unwrap_or_default();
    let index = assets::index_spec(mc_dir, &index_ref)
        .ok_or_else(|| AppError::msg("Asset bilgisi bozuk."))?;
    if !index.present() {
        download_all(app, &http, vec![index.clone()]).await?;
    }
    let index_json: serde_json::Value = serde_json::from_slice(&std::fs::read(&index.path)?)?;
    let mut files = game::missing_files(&merged);
    files.extend(
        assets::objects(mc_dir, &index_json)
            .into_iter()
            .filter(|f| !f.present()),
    );
    download_all(app, &http, files).await?;

    let natives_dir = mc_dir.join("bin").join(format!("mcsm-{}", merged.id));
    launch::extract_natives(&merged, &natives_dir)?;
    let classpath = game::classpath(&merged)?;

    emit_progress(app, "java", 0, 0);
    let major = match merged.java_major {
        Some(m) => m,
        None => {
            let base = chain[0]
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            state.loaders.java_major(base).await?
        }
    };
    let java = app.state::<JavaManager>();
    let found = match java.resolve(None, major).await? {
        Some(j) => j,
        None => java.install(major, |_| {}).await?,
    };

    std::fs::create_dir_all(game_dir)?;
    let args = launch::command_args(
        &merged,
        &launch::LaunchSpec {
            mc_dir,
            game_dir,
            natives_dir: &natives_dir,
            classpath: &classpath,
            player: &session.account.name,
            uuid: &session.account.uuid,
            xuid: "0",
            token: &session.token,
            max_ram_mb: game_ram_mb(),
        },
        env,
    );
    Ok(Prepared {
        java: launch::windowless_java(Path::new(&found.path)),
        args,
        game_dir: game_dir.to_path_buf(),
        token: session.token,
    })
}

/// Oyunu başlatır; çıktısı `app_data/logs/game-latest.log`'a gider. Oyun uygulamadan bağımsız yaşar.
pub fn start(app: &AppHandle, p: Prepared) -> AppResult<()> {
    let games = app.state::<GameState>();
    let mut running = games.0.lock().unwrap_or_else(|e| e.into_inner());
    if running.is_some() {
        return Err(AppError::msg("Minecraft zaten açık."));
    }
    emit_progress(app, "starting", 0, 0);
    let logs = app.path().app_data_dir()?.join("logs");
    std::fs::create_dir_all(&logs)?;
    let log_path = logs.join("game-latest.log");
    let mut log = std::fs::File::create(&log_path)?;
    use std::io::Write;
    let _ = writeln!(
        log,
        "> {} {}",
        p.java.display(),
        launch::masked(&p.args, &p.token)
    );
    let mut cmd = std::process::Command::new(&p.java);
    cmd.args(&p.args)
        .current_dir(&p.game_dir)
        .stdin(std::process::Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::msg(format!("Minecraft başlatılamadı: {e}")))?;
    *running = Some(child.id());
    drop(running);
    let _ = app.emit(
        EVENT_STATE,
        StatePayload {
            state: "running",
            code: None,
        },
    );
    let app = app.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        *app.state::<GameState>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        let _ = app.emit(
            EVENT_STATE,
            StatePayload {
                state: "exited",
                code,
            },
        );
    });
    Ok(())
}

/// Son oyunun çıktısını açar (çöktüğünde bakmak için).
#[tauri::command]
pub fn open_game_log(app: AppHandle) -> AppResult<()> {
    let path = app
        .path()
        .app_data_dir()?
        .join("logs")
        .join("game-latest.log");
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn game_running(games: State<'_, GameState>) -> bool {
    games.0.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Canlı (yalnız geliştirme): başlatıcının doğruluğu için oyunu geçici klasörde, test kimliğiyle
    /// ve hiçbir sunucuya bağlanmadan açar; ana menü yüklenince kapatır.
    #[tokio::test]
    #[ignore = "oyun penceresi açar"]
    async fn live_launch_game() {
        use std::io::BufRead;
        let mc = crate::settings::default_minecraft_dir().unwrap();
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let loaders = crate::loaders::Loaders::new(http.clone());
        let ids = std::env::var("MCSM_LAUNCH_IDS").unwrap_or_else(|_| "26.3".into());
        for id in ids.split(',') {
            let chain = game::load_chain(&mc, id, |v| {
                let l = &loaders;
                async move { l.version_json(&v).await }
            })
            .await
            .unwrap();
            let m = game::merge(&chain, &mc, Env::current()).unwrap();
            assert!(game::missing_files(&m).is_empty(), "eksik dosya var");
            let java = crate::java::test_java(m.java_major.unwrap()).await;
            let game_dir = crate::util::live_test_dir("game").join(id);
            let natives = game_dir.join("natives");
            launch::extract_natives(&m, &natives).unwrap();
            let cp = game::classpath(&m).unwrap();
            let args = launch::command_args(
                &m,
                &launch::LaunchSpec {
                    mc_dir: &mc,
                    game_dir: &game_dir,
                    natives_dir: &natives,
                    classpath: &cp,
                    player: "McsmTest",
                    uuid: "00000000000000000000000000000000",
                    xuid: "0",
                    token: "0",
                    max_ram_mb: 3072,
                },
                Env::current(),
            );
            std::fs::create_dir_all(&game_dir).unwrap();
            let mut child = std::process::Command::new(&java)
                .args(&args)
                .current_dir(&game_dir)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .spawn()
                .unwrap();
            let out = child.stdout.take().unwrap();
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
            let started = Instant::now();
            let mut ready = false;
            while started.elapsed() < Duration::from_secs(240) {
                match rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(line) => {
                        if line.contains("Sound engine started")
                            || line.contains("Created: ") && line.contains("atlas")
                        {
                            println!("{id}: {line}");
                            ready = true;
                            break;
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => break,
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            assert!(ready, "{id}: oyun ana menüye gelmedi");
            println!("{id}: {:.0} sn'de açıldı", started.elapsed().as_secs_f32());
        }
    }

    /// Canlı: bu makinenin `.minecraft`'ında 26.3 için eksik dosya listesi (indirmeden).
    #[tokio::test]
    #[ignore = "yerel .minecraft gerekir"]
    async fn live_missing_files_plan() {
        let mc = crate::settings::default_minecraft_dir().unwrap();
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let loaders = crate::loaders::Loaders::new(http);
        for id in ["26.3", "neoforge-26.3.0.76"] {
            if id != "26.3" && !crate::client::version_exists(&mc, id) {
                continue;
            }
            let chain = game::load_chain(&mc, id, |v| {
                let l = &loaders;
                async move { l.version_json(&v).await }
            })
            .await
            .unwrap();
            let m = game::merge(&chain, &mc, Env::current()).unwrap();
            let missing = game::missing_files(&m);
            println!(
                "{id}: {} kütüphane, ana sınıf {}, eksik {} dosya, java {:?}",
                m.libraries.len(),
                m.main_class,
                missing.len(),
                m.java_major
            );
            assert!(game::classpath(&m).is_ok() || !missing.is_empty());
        }
    }
}
