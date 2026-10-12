use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;
use tauri::async_runtime::spawn as spawn_task;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, watch};

use super::log::{LogEvent, parse};
use super::stats::ProcessSampler;
use super::{LaunchSpec, LogStream, ServerHandle, ServerStatus};
use crate::consts::STATS_INTERVAL;
use crate::error::{AppError, AppResult};
use crate::util::hide_console;

/// Süreç bittikten sonra kalan çıktının okunması için beklenecek en uzun süre.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

pub(super) async fn spawn(
    app: &AppHandle,
    h: &Arc<ServerHandle>,
    spec: LaunchSpec,
) -> AppResult<()> {
    let mut cmd = Command::new(&spec.java);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    hide_console(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            h.push_log(
                app,
                LogStream::System,
                tx!("Java başlatılamadı: {e}", "Couldn't start Java: {e}"),
            );
            h.set_status(app, ServerStatus::Crashed);
            return Err(AppError::msg(tx!(
                "Java başlatılamadı: {e}",
                "Couldn't start Java: {e}"
            )));
        }
    };

    *h.stdin.lock().await = child.stdin.take();
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let (exit_tx, exit_rx) = watch::channel(false);
    {
        let mut s = h.lock();
        s.kill_tx = Some(kill_tx);
        s.exit_rx = Some(exit_rx);
    }

    let stdout = child
        .stdout
        .take()
        .map(|o| spawn_task(read_lines(app.clone(), h.clone(), o, LogStream::Stdout)));
    let stderr = child
        .stderr
        .take()
        .map(|e| spawn_task(read_lines(app.clone(), h.clone(), e, LogStream::Stderr)));
    if let Some(pid) = child.id() {
        spawn_task(sample_stats(app.clone(), h.clone(), pid));
    }

    let app = app.clone();
    let h = h.clone();
    spawn_task(async move {
        let exit = tokio::select! {
            r = child.wait() => r,
            Ok(()) = kill_rx => {
                let _ = child.start_kill();
                child.wait().await
            }
        };
        for reader in [stdout, stderr].into_iter().flatten() {
            let _ = tokio::time::timeout(DRAIN_TIMEOUT, reader).await;
        }
        *h.stdin.lock().await = None;

        let code = exit.ok().and_then(|s| s.code());
        let stop_requested = {
            let mut s = h.lock();
            s.kill_tx = None;
            s.exit_rx = None;
            std::mem::take(&mut s.stop_requested)
        };
        h.push_log(
            &app,
            LogStream::System,
            tx!(
                "Sunucu kapandı (çıkış kodu: {}).",
                "The server stopped (exit code: {}).",
                code.map_or_else(|| "?".to_string(), |c| c.to_string())
            ),
        );
        h.update_players(&app, None);
        let status = if stop_requested || code == Some(0) {
            ServerStatus::Stopped
        } else {
            ServerStatus::Crashed
        };
        h.set_status(&app, status);
        let _ = exit_tx.send(true);
    });

    Ok(())
}

/// Satırları UTF-8 dışı baytlara takılmadan okur (bozuk karakter `�` olur, okuma durmaz).
async fn read_lines(
    app: AppHandle,
    h: Arc<ServerHandle>,
    pipe: impl AsyncRead + Unpin,
    stream: LogStream,
) {
    let mut reader = BufReader::new(pipe);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&buf)
            .trim_end_matches(['\r', '\n'])
            .to_string();
        let event = matches!(stream, LogStream::Stdout)
            .then(|| parse(&line))
            .flatten();
        h.push_log(&app, stream, line);
        match event {
            Some(LogEvent::Done) => {
                h.transition(&app, ServerStatus::Starting, ServerStatus::Running);
            }
            Some(LogEvent::Joined(name)) => h.update_players(&app, Some((&name, true))),
            Some(LogEvent::Left(name)) => h.update_players(&app, Some((&name, false))),
            Some(LogEvent::Rejected(name)) => h.add_rejected(&app, &name),
            None => {}
        }
    }
}

async fn sample_stats(app: AppHandle, h: Arc<ServerHandle>, pid: u32) {
    let mut sampler = ProcessSampler::new(pid);
    loop {
        tokio::time::sleep(STATS_INTERVAL).await;
        if !h.status().is_active() {
            break;
        }
        match sampler.sample() {
            Some(stats) => h.emit_stats(&app, &stats),
            None => break,
        }
    }
}
