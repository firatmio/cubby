use std::path::Path;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use crate::hash::{HashAlgo, Hasher};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// `url`'i `dest`'e indirir. Önce `<dest>.part`'a yazar, hash tutarsa yerine taşır.
/// `on_progress(indirilen, toplam)` en fazla 100 ms'de bir ve en sonda bir kez çağrılır.
pub async fn download_file(
    http: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected: Option<(HashAlgo, &str)>,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> AppResult<()> {
    let resp = http.get(url).send().await?.error_for_status()?;
    let total = resp.content_length();

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let part = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&part).await?;
    let mut hasher = expected.map(|(algo, _)| Hasher::new(algo));

    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    let mut stream = resp.bytes_stream();
    let result: AppResult<()> = async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            if let Some(h) = hasher.as_mut() {
                h.update(&chunk);
            }
            downloaded += chunk.len() as u64;
            if last_emit.elapsed() >= PROGRESS_INTERVAL {
                last_emit = Instant::now();
                on_progress(downloaded, total);
            }
        }
        file.flush().await?;
        Ok(())
    }
    .await;
    drop(file);

    if let Err(e) = result {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(e);
    }
    on_progress(downloaded, total);

    if let (Some(h), Some((_, want))) = (hasher, expected) {
        let got = h.finalize_hex();
        if !got.eq_ignore_ascii_case(want) {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(AppError::HashMismatch {
                file: dest
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                expected: want.to_string(),
                actual: got,
            });
        }
    }

    tokio::fs::rename(&part, dest).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::hash_bytes;
    use tokio::io::AsyncReadExt;

    /// Tek isteğe `body` ile cevap veren yerel HTTP sunucusu.
    async fn serve_once(body: &'static [u8]) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut req = [0u8; 1024];
            let _ = sock.read(&mut req).await;
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            sock.write_all(head.as_bytes()).await.unwrap();
            sock.write_all(body).await.unwrap();
        });
        format!("http://{addr}/file.jar")
    }

    fn temp_dest(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mcsm-test-{}", uuid::Uuid::new_v4()));
        dir.join(name)
    }

    #[tokio::test]
    async fn verifies_hash_and_moves_into_place() {
        let url = serve_once(b"hello").await;
        let dest = temp_dest("ok.jar");
        let sha1 = hash_bytes(HashAlgo::Sha1, b"hello");
        let mut last = 0;
        download_file(
            &reqwest::Client::new(),
            &url,
            &dest,
            Some((HashAlgo::Sha1, &sha1)),
            |d, _| last = d,
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello");
        assert_eq!(last, 5);
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }

    #[tokio::test]
    async fn rejects_hash_mismatch_and_cleans_up() {
        let url = serve_once(b"tampered").await;
        let dest = temp_dest("bad.jar");
        let err = download_file(
            &reqwest::Client::new(),
            &url,
            &dest,
            Some((HashAlgo::Sha1, "00")),
            |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::HashMismatch { .. }));
        assert!(!dest.exists());
        assert!(!dest.with_extension("part").exists());
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }
}
