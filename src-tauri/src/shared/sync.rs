//! Arkadaştan yeni nesli çekme: yalnız değişen 4 KB'lık parçalar gelir. Her dosya önce `incoming/`'e
//! iner ve SHA-256 ile doğrulanır; hepsi tamamsa günlükle yer değiştirilir (yarıda kalırsa eski nesil
//! bozulmaz). Aşama 0: 25 dakikalık oturumun farkı tam dosyayla 39,5 MB, parçalarla ~7 MB.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::TryStreamExt;
use iroh::EndpointId;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::Store;
use super::manifest::{self, Manifest};
use crate::error::{AppError, AppResult};
use crate::p2p::P2p;

/// Aynı anda en çok bu kadar dosya.
const PARALLEL: usize = 4;

/// Çekmenin özeti: kaç dosya ve kaç bayt geldi (dosyaların toplam boyutu değil, ağdan gelen).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PullStats {
    pub files: usize,
    pub bytes: u64,
}

pub struct Source<'a> {
    pub p2p: &'a P2p,
    /// Bu nesle sahip cihazlar; biri düşerse sıradakine geçilir.
    pub peers: &'a [EndpointId],
    pub world: &'a str,
    pub token: &'a str,
}

/// `target` neslini çeker. `progress(gelen, en çok gelecek)` bayt cinsinden.
pub async fn pull(
    src: &Source<'_>,
    store: &Store,
    target: u64,
    progress: impl Fn(u64, u64) + Send + Sync,
) -> AppResult<(Manifest, PullStats)> {
    store.recover()?;
    let local = store.manifest();
    if local.generation == target {
        return Ok((local, PullStats::default()));
    }
    let remote: Manifest = first_ok(src.peers, |peer| async move {
        let body = src
            .p2p
            .world_manifest(peer, src.world, src.token, target)
            .await?;
        let m: Manifest = serde_json::from_slice(&body)?;
        if m.generation != target || m.files.iter().any(|f| !manifest::is_safe_path(&f.path)) {
            return Err(AppError::msg("bad manifest"));
        }
        Ok(m)
    })
    .await?;
    let diff = manifest::diff(&local.files, &remote.files);
    let total: u64 = diff
        .changed
        .iter()
        .filter_map(|p| remote.get(p))
        .map(|f| f.size)
        .sum();
    let moved = Arc::new(AtomicU64::new(0));
    let progress = &progress;
    futures_util::stream::iter(diff.changed.iter().map(Ok::<_, AppError>))
        .try_for_each_concurrent(PARALLEL, |path| {
            let (moved, remote) = (moved.clone(), &remote);
            async move {
                let entry = remote.get(path).expect("listede");
                let count = |n: u64| progress(moved.fetch_add(n, Ordering::Relaxed) + n, total);
                fetch_file(src, store, target, entry, &count).await
            }
        })
        .await?;
    let stats = PullStats {
        files: diff.changed.len(),
        bytes: moved.load(Ordering::Relaxed),
    };
    store.commit(&remote, &diff)?;
    Ok((remote, stats))
}

/// Kaynakları sırayla dener; ilk başaranın sonucu, hiçbiri başaramazsa sonuncunun hatası.
async fn first_ok<T, F, Fut>(peers: &[EndpointId], f: F) -> AppResult<T>
where
    F: Fn(EndpointId) -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    let mut last = AppError::msg(tx!(
        "Dünyanın bu hâline sahip açık bir arkadaş yok.",
        "No friend with this version of the world is online."
    ));
    for &peer in peers {
        match f(peer).await {
            Ok(v) => return Ok(v),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Bir dosya: yerelde varsa yalnız farklı bloklar, yoksa tamamı. Özet tutmazsa tamamı bir kez daha.
async fn fetch_file(
    src: &Source<'_>,
    store: &Store,
    target: u64,
    entry: &manifest::FileEntry,
    count: &(impl Fn(u64) + Sync),
) -> AppResult<()> {
    let dest = store.root.join("incoming").join(&entry.path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let local = store.current().join(&entry.path);
    first_ok(src.peers, |peer| {
        let (dest, local) = (dest.clone(), local.clone());
        async move {
            let ranges = if local.is_file() {
                let remote_blocks = src
                    .p2p
                    .world_blocks(peer, src.world, src.token, target, &entry.path)
                    .await?;
                let l = local.clone();
                let local_blocks = tokio::task::spawn_blocking(move || manifest::block_hashes(&l))
                    .await
                    .map_err(|e| AppError::msg(e.to_string()))??;
                tokio::fs::copy(&local, &dest).await?;
                manifest::ranges(&local_blocks, &remote_blocks, entry.size)
            } else {
                let _ = tokio::fs::remove_file(&dest).await;
                vec![[0, entry.size]]
            };
            fill(src, peer, target, entry, &dest, &ranges, count).await?;
            if verify(&dest, entry).await? {
                return Ok(());
            }
            // Parça parça kurulan dosya tutmadı (yerel kopya beklenmedik biçimde değişmiş olabilir): tamamı.
            let _ = tokio::fs::remove_file(&dest).await;
            fill(src, peer, target, entry, &dest, &[[0, entry.size]], count).await?;
            if verify(&dest, entry).await? {
                return Ok(());
            }
            Err(AppError::HashMismatch {
                file: entry.path.clone(),
                expected: entry.sha256.clone(),
                actual: "?".into(),
            })
        }
    })
    .await
}

/// `dest`'i uzaktaki boyuta getirir ve aralıkları yazar.
async fn fill(
    src: &Source<'_>,
    peer: EndpointId,
    target: u64,
    entry: &manifest::FileEntry,
    dest: &std::path::Path,
    ranges: &[[u64; 2]],
    count: &(impl Fn(u64) + Sync),
) -> AppResult<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(dest)
        .await?;
    file.set_len(entry.size).await?;
    for &[start, len] in ranges {
        let mut recv = src
            .p2p
            .world_read(
                peer,
                src.world,
                src.token,
                target,
                &entry.path,
                [start, len],
            )
            .await?;
        file.seek(std::io::SeekFrom::Start(start)).await?;
        let mut got = 0u64;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = AsyncReadExt::read(&mut recv, &mut buf).await?;
            if n == 0 {
                break;
            }
            got += n as u64;
            if got > len {
                return Err(AppError::msg(tx!(
                    "{} beklenenden büyük geldi.",
                    "{} was larger than expected.",
                    entry.path
                )));
            }
            file.write_all(&buf[..n]).await?;
            count(n as u64);
        }
        if got != len {
            return Err(AppError::msg(tx!(
                "{} yarım geldi.",
                "{} arrived incomplete.",
                entry.path
            )));
        }
    }
    file.sync_all().await?;
    Ok(())
}

async fn verify(dest: &std::path::Path, entry: &manifest::FileEntry) -> AppResult<bool> {
    let d = dest.to_path_buf();
    let sha = tokio::task::spawn_blocking(move || manifest::sha256_file(&d))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    Ok(sha == entry.sha256)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p2p::Decision;
    use crate::p2p::protocol::{Reply, StreamHeader};
    use crate::shared::snapshot::snapshot;
    use std::path::Path;

    /// Kaynak dünya: `CUBBY_SPIKE_WORLD` verilirse onun kopyası, yoksa üretilmiş dosyalar.
    fn source(dir: &Path) {
        if let Ok(w) = std::env::var("CUBBY_SPIKE_WORLD") {
            let w = Path::new(&w);
            for (rel, _) in manifest::scan(w).unwrap() {
                let to = dir.join(&rel);
                std::fs::create_dir_all(to.parent().unwrap()).unwrap();
                std::fs::copy(w.join(&rel), to).unwrap();
            }
            return;
        }
        for i in 0..12u8 {
            let p = dir.join(format!("world/region/r.{i}.0.mca"));
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            let body: Vec<u8> = (0..(1 << 20) + i as usize * 777)
                .map(|j| (j as u8) ^ i)
                .collect();
            std::fs::write(p, body).unwrap();
        }
        std::fs::write(dir.join("server.properties"), "motd=x").unwrap();
    }

    /// Bölge dosyalarından ikisinin birkaç bloğunu değiştirir; değişen blok sayısı.
    fn touch_blocks(dir: &Path) -> u64 {
        use std::io::{Seek, SeekFrom, Write};
        let mut regions: Vec<_> = manifest::scan(dir)
            .unwrap()
            .into_iter()
            .filter(|(p, (size, _))| p.ends_with(".mca") && *size > 64 * 1024)
            .collect();
        regions.truncate(2);
        let mut blocks = 0;
        for (rel, _) in regions {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .open(dir.join(rel))
                .unwrap();
            for b in [3u64, 4, 9] {
                f.seek(SeekFrom::Start(b * manifest::BLOCK + 17)).unwrap();
                f.write_all(&[0xAB; 100]).unwrap();
                blocks += 1;
            }
        }
        blocks
    }

    /// Canlı: iki iroh uç noktası (aynı makine). A anlık kopya alır, B ilk kez tamamını çeker;
    /// A'da birkaç blok değişir, B yalnız onları çeker. İki depo aynı olmalı.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn live_shared_pull() {
        let base = std::env::temp_dir().join(format!("cubby-pull-{}", uuid::Uuid::new_v4()));
        let (src, a_dir, b_dir) = (base.join("src"), base.join("a"), base.join("b"));
        std::fs::create_dir_all(&src).unwrap();
        source(&src);
        let a = Arc::new(Store::at(a_dir.clone()));
        let b = Store::at(b_dir.clone());
        let host = P2p::bind(&base.join("host-key")).await.unwrap();
        let guest = P2p::bind(&base.join("guest-key")).await.unwrap();
        let served = a.clone();
        host.serve(Arc::new(move |h: &StreamHeader, _peer: &str| {
            if h.world != "w" || h.token != "t" {
                return Decision::Reply(Reply::Denied);
            }
            let ok = Reply::Ok {
                running: false,
                name: String::new(),
                mods_rev: None,
                cover: None,
                code: None,
            };
            served.serve(h, ok)
        }));
        guest.dial(&host).await.unwrap();
        let peers = [host.id().parse().unwrap()];
        let source = Source {
            p2p: &guest,
            peers: &peers,
            world: "w",
            token: "t",
        };

        let g1 = snapshot(&src, &a, a.manifest().generation + 1)
            .unwrap()
            .unwrap();
        let total: u64 = g1.files.iter().map(|f| f.size).sum();
        let t = std::time::Instant::now();
        let (m1, s1) = pull(&source, &b, 1, |_, _| {}).await.unwrap();
        println!(
            "ilk kopya: {} dosya, {:.1} MB, {:.2} sn",
            s1.files,
            s1.bytes as f64 / 1048576.0,
            t.elapsed().as_secs_f64()
        );
        assert_eq!(m1, g1);
        assert_eq!(s1.bytes, total);

        // Yanlış token ya da olmayan nesil: hata, depo bozulmaz.
        let bad = Source {
            token: "x",
            ..Source {
                p2p: &guest,
                peers: &peers,
                world: "w",
                token: "t",
            }
        };
        assert!(pull(&bad, &b, 2, |_, _| {}).await.is_err());
        assert_eq!(b.manifest(), g1);

        let blocks = touch_blocks(&src);
        let g2 = snapshot(&src, &a, a.manifest().generation + 1)
            .unwrap()
            .unwrap();
        let t = std::time::Instant::now();
        let (m2, s2) = pull(&source, &b, 2, |_, _| {}).await.unwrap();
        println!(
            "fark: {} dosya değişti, {} blok, ağdan {:.1} KB, {:.2} sn",
            s2.files,
            blocks,
            s2.bytes as f64 / 1024.0,
            t.elapsed().as_secs_f64()
        );
        assert_eq!(m2, g2);
        assert!(
            s2.bytes <= blocks * manifest::BLOCK,
            "yalnız değişen bloklar gelmeli: {}",
            s2.bytes
        );
        for f in &g2.files {
            assert_eq!(
                manifest::sha256_file(&b.current().join(&f.path)).unwrap(),
                f.sha256,
                "{}",
                f.path
            );
        }
        let _ = std::fs::remove_dir_all(base);
    }
}
