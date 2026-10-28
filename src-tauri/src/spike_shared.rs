//! Ortak dünya, Aşama 0: ölçüm denemesi. Ürüne girmez; yalnız `cargo test -- --ignored spike_`.
//!
//! - `spike_transfer`: bir dünya klasörünü iki iroh uç noktası arasında aktarır, hızı ölçer
//!   (doğrudan ve yalnız aracı sunucu). Kaynak `CUBBY_SPIKE_WORLD` (yoksa `--nocapture` ile söylenir).
//! - `spike_manifest`: klasörün dosya özetlerini çıkarır, süresini ölçer; `CUBBY_SPIKE_OUT` verilirse
//!   JSON'a yazar (oturum öncesi/sonrası fark için).
//! - `spike_sign`: iroh anahtarıyla Ed25519 imzası; web tarafı aynı vektörü doğrular.

#![cfg(test)]

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, SecretKey};
use tokio::io::AsyncReadExt;

use crate::hash::{HashAlgo, Hasher};

const ALPN: &[u8] = b"cubby/spike/0";

/// Aktarılacak dosyalar: kütüphaneler, sürümler, loglar ve kilit hariç (planla aynı kural).
fn files(root: &Path) -> Vec<(String, u64)> {
    const SKIP: &[&str] = &[
        "libraries",
        "versions",
        "logs",
        ".fabric",
        "cache",
        "crash-reports",
    ];
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            let rel = p
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if SKIP.iter().any(|s| rel == *s) || rel.ends_with("session.lock") {
                continue;
            }
            let Ok(md) = e.metadata() else { continue };
            if md.is_dir() {
                stack.push(p);
            } else if !rel.ends_with(".jar") || rel.starts_with("mods/") {
                out.push((rel, md.len()));
            }
        }
    }
    out.sort();
    out
}

fn source() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var("CUBBY_SPIKE_WORLD").ok()?);
    p.is_dir().then_some(p)
}

async fn endpoint(relay_only: bool) -> Endpoint {
    let mut b = Endpoint::builder(presets::N0)
        .secret_key(SecretKey::generate())
        .alpns(vec![ALPN.to_vec()]);
    if relay_only {
        b = b.clear_ip_transports();
    }
    b.bind().await.unwrap()
}

/// Host: her akışta bir satır (göreli yol) okur, dosyayı olduğu gibi yollar.
fn serve(ep: Endpoint, root: PathBuf) {
    tokio::spawn(async move {
        while let Some(inc) = ep.accept().await {
            let root = root.clone();
            tokio::spawn(async move {
                let Ok(conn) = inc.await else { return };
                while let Ok((mut send, mut recv)) = conn.accept_bi().await {
                    let root = root.clone();
                    tokio::spawn(async move {
                        let mut line = Vec::new();
                        loop {
                            let b = recv.read_u8().await.unwrap();
                            if b == b'\n' {
                                break;
                            }
                            line.push(b);
                        }
                        let rel = String::from_utf8(line).unwrap();
                        let mut f = tokio::fs::File::open(root.join(&rel)).await.unwrap();
                        tokio::io::copy(&mut f, &mut send).await.unwrap();
                        send.finish().unwrap();
                        let _ = send.stopped().await;
                    });
                }
            });
        }
    });
}

async fn transfer(relay_only: bool, parallel: usize) {
    let Some(src) = source() else {
        println!("CUBBY_SPIKE_WORLD yok; atlandı");
        return;
    };
    let list = files(&src);
    let total: u64 = list.iter().map(|(_, n)| n).sum();
    let host = endpoint(relay_only).await;
    let guest = endpoint(relay_only).await;
    serve(host.clone(), src.clone());
    let addr: EndpointAddr = if relay_only {
        host.online().await;
        host.addr()
    } else {
        host.addr()
    };
    let t0 = Instant::now();
    let conn = guest.connect(addr, ALPN).await.unwrap();
    let connected = t0.elapsed();
    let dest = std::env::temp_dir().join(format!("cubby-spike-{}", uuid::Uuid::new_v4()));
    let queue = Arc::new(tokio::sync::Mutex::new(list.clone()));
    let t1 = Instant::now();
    let moved = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let mut tasks = Vec::new();
    for _ in 0..parallel {
        let (conn, queue, dest, moved) = (conn.clone(), queue.clone(), dest.clone(), moved.clone());
        tasks.push(tokio::spawn(async move {
            loop {
                let Some((rel, size)) = queue.lock().await.pop() else {
                    break;
                };
                let (mut send, mut recv) = conn.open_bi().await.unwrap();
                send.write_all(format!("{rel}\n").as_bytes()).await.unwrap();
                send.finish().unwrap();
                let out = dest.join(&rel);
                tokio::fs::create_dir_all(out.parent().unwrap())
                    .await
                    .unwrap();
                let mut f = tokio::fs::File::create(&out).await.unwrap();
                let n = tokio::io::copy(&mut recv, &mut f).await.unwrap();
                assert_eq!(n, size, "{rel}");
                let done = moved.fetch_add(n, std::sync::atomic::Ordering::Relaxed) + n;
                if done / (32 << 20) != (done - n) / (32 << 20) {
                    println!(
                        "SPIKE   … {:.0} MB, {:.1} sn",
                        done as f64 / 1048576.0,
                        t1.elapsed().as_secs_f64()
                    );
                }
            }
        }));
    }
    for t in tasks {
        t.await.unwrap();
    }
    let secs = t1.elapsed().as_secs_f64();
    let path = conn
        .paths()
        .iter()
        .find(|p| p.is_selected())
        .map(|p| if p.is_relay() { "aracı" } else { "doğrudan" })
        .unwrap_or("?");
    println!(
        "SPIKE aktarım [{}; {parallel} akış; yol: {path}]: {} dosya, {:.1} MB, bağlanma {:.2} sn, aktarım {:.1} sn → {:.1} MB/sn",
        if relay_only {
            "yalnız aracı"
        } else {
            "varsayılan"
        },
        list.len(),
        total as f64 / 1048576.0,
        connected.as_secs_f64(),
        secs,
        total as f64 / 1048576.0 / secs
    );
    let _ = std::fs::remove_dir_all(&dest);
    host.close().await;
    guest.close().await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn spike_transfer_direct() {
    transfer(false, 4).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn spike_transfer_relay() {
    transfer(true, 4).await;
}

#[test]
#[ignore]
fn spike_manifest() {
    let Some(src) = source() else {
        println!("CUBBY_SPIKE_WORLD yok; atlandı");
        return;
    };
    let t0 = Instant::now();
    let mut map = serde_json::Map::new();
    let mut total = 0u64;
    for (rel, size) in files(&src) {
        let mut h = Hasher::new(HashAlgo::Sha256);
        h.update(&std::fs::read(src.join(&rel)).unwrap());
        total += size;
        map.insert(
            rel,
            serde_json::json!({ "size": size, "sha256": h.finalize_hex() }),
        );
    }
    println!(
        "SPIKE manifest: {} dosya, {:.1} MB, {:.2} sn",
        map.len(),
        total as f64 / 1048576.0,
        t0.elapsed().as_secs_f64()
    );
    if let Ok(out) = std::env::var("CUBBY_SPIKE_OUT") {
        std::fs::write(out, serde_json::to_vec_pretty(&map).unwrap()).unwrap();
    }
}

#[test]
#[ignore]
fn spike_sign() {
    let key = SecretKey::from_bytes(&[7u8; 32]);
    let msg = b"cubby lease K7M2QX gen=3 t=1793130000";
    let sig = key.sign(msg);
    println!("SPIKE imza pub={}", hex::encode(key.public().as_bytes()));
    println!("SPIKE imza msg={}", hex::encode(msg));
    println!("SPIKE imza sig={}", hex::encode(sig.to_bytes()));
    assert!(key.public().verify(msg, &sig).is_ok());
}
