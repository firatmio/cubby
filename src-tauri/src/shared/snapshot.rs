//! Tutarlı anlık kopya: sunucu klasörünün izlenen dosyaları deponun `current/`'ına alınır ve nesil
//! bir artar. Sunucu açıkken çağıran önce kaydı durdurur (`Servers::with_saves_paused`); kopya
//! bitince kayıt yeniden açılır. Aşama 0 ölçümü: kayıtsız pencere ~0,3 sn.

use std::io::{Read, Write};
use std::path::Path;

use sha2::{Digest, Sha256};

use super::Store;
use super::manifest::{self, Diff, FileEntry, Manifest};
use crate::error::AppResult;

/// Kopyalarken özetler: kopyanın kendisi neyse manifest odur (kaynak arada değişse bile).
fn copy_hashing(from: &Path, to: &Path) -> AppResult<String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut src = std::fs::File::open(from)?;
    let mut dst = std::fs::File::create(to)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = src.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        dst.write_all(&buf[..n])?;
    }
    dst.sync_all()?;
    Ok(hex::encode(h.finalize()))
}

/// `source`'un (sunucu klasörü) değişen dosyalarını depoya alır. Hiçbir şey değişmediyse `None`
/// (nesil artmaz), değiştiyse `next` neslinin manifesti. Nesil numarası davet sunucusununkidir
/// (onun nesli + 1); depodaki son nesilden büyük olmalı.
pub fn snapshot(source: &Path, store: &Store, next: u64) -> AppResult<Option<Manifest>> {
    store.recover()?;
    let prev = store.manifest();
    let prev_sha: std::collections::HashMap<&str, &str> = prev
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.sha256.as_str()))
        .collect();
    let mut index = store.index();
    let mut files = Vec::new();
    let mut changed = Vec::new();
    let scanned = manifest::scan(source)?;
    for (path, (size, mtime)) in &scanned {
        // Boyutu ve zamanı değişmemiş, depoda aynı özetle duran dosya yeniden okunmaz.
        if let Some((s, m, sha)) = index.get(path)
            && *s == *size
            && *m == *mtime
            && prev_sha.get(path.as_str()) == Some(&sha.as_str())
        {
            files.push(FileEntry {
                path: path.clone(),
                size: *size,
                sha256: sha.clone(),
            });
            continue;
        }
        let incoming = store.root.join("incoming").join(path);
        let sha = copy_hashing(&source.join(path), &incoming)?;
        let real_size = std::fs::metadata(&incoming)?.len();
        if prev_sha.get(path.as_str()) == Some(&sha.as_str()) {
            std::fs::remove_file(&incoming)?;
        } else {
            changed.push(path.clone());
        }
        index.insert(path.clone(), (real_size, *mtime, sha.clone()));
        files.push(FileEntry {
            path: path.clone(),
            size: real_size,
            sha256: sha,
        });
    }
    index.retain(|p, _| scanned.contains_key(p));
    let removed: Vec<String> = prev
        .files
        .iter()
        .filter(|f| !scanned.contains_key(&f.path))
        .map(|f| f.path.clone())
        .collect();
    if changed.is_empty() && removed.is_empty() && prev.generation > 0 {
        let _ = std::fs::remove_dir_all(store.root.join("incoming"));
        store.save_index(&index)?;
        return Ok(None);
    }
    let next = Manifest {
        generation: next.max(prev.generation + 1),
        files,
    };
    store.commit(&next, &Diff { changed, removed })?;
    store.save_index(&index)?;
    Ok(Some(next))
}

/// Sunucu açıkken: kayıt kısa süre durdurulur, kopya alınır, kayıt yeniden açılır.
pub async fn snapshot_running(
    servers: &crate::server::ServerManager,
    id: &str,
    source: std::path::PathBuf,
    store: Store,
    next: u64,
) -> AppResult<Option<Manifest>> {
    servers
        .with_saves_paused(id, || async move {
            tokio::task::spawn_blocking(move || snapshot(&source, &store, next))
                .await
                .map_err(|e| crate::error::AppError::msg(e.to_string()))?
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cubby-snap-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(root: &Path, rel: &str, body: &[u8]) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn generations_backups_and_unchanged() {
        let (src, store_dir) = (tmp("src"), tmp("store"));
        let store = Store::at(store_dir.clone());
        put(&src, "world/region/r.0.0.mca", b"bolge-1");
        put(&src, "server.properties", b"motd=x");
        put(&src, "fabric-server-launch.jar", b"jar");
        put(&src, "logs/latest.log", b"log");

        let g1 = snapshot(&src, &store, store.manifest().generation + 1)
            .unwrap()
            .unwrap();
        assert_eq!(g1.generation, 1);
        let paths: Vec<&str> = g1.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["server.properties", "world/region/r.0.0.mca"]);
        assert_eq!(
            std::fs::read(store.current().join("world/region/r.0.0.mca")).unwrap(),
            b"bolge-1"
        );

        // Değişiklik yoksa nesil artmaz.
        assert!(
            snapshot(&src, &store, store.manifest().generation + 1)
                .unwrap()
                .is_none()
        );

        // Bir dosya değişir, biri silinir, biri eklenir.
        put(&src, "world/region/r.0.0.mca", b"bolge-2");
        std::fs::remove_file(src.join("server.properties")).unwrap();
        put(&src, "world/level.dat", b"level");
        let g2 = snapshot(&src, &store, store.manifest().generation + 1)
            .unwrap()
            .unwrap();
        assert_eq!(g2.generation, 2);
        assert_eq!(
            std::fs::read(store_dir.join("backups/2/world/region/r.0.0.mca")).unwrap(),
            b"bolge-1"
        );
        assert!(store_dir.join("backups/2/server.properties").is_file());
        assert!(!store.current().join("server.properties").exists());
        assert_eq!(store.manifest(), g2);

        // Son 3 neslin yedeği kalır.
        for i in 3..=6u8 {
            put(&src, "world/region/r.0.0.mca", &[i]);
            snapshot(&src, &store, store.manifest().generation + 1)
                .unwrap()
                .unwrap();
        }
        let mut kept: Vec<String> = std::fs::read_dir(store_dir.join("backups"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        kept.sort();
        assert_eq!(kept, ["4", "5", "6"]);
        let _ = std::fs::remove_dir_all(src);
        let _ = std::fs::remove_dir_all(store_dir);
    }

    #[test]
    fn interrupted_commit_recovers() {
        let (src, store_dir) = (tmp("src"), tmp("store"));
        let store = Store::at(store_dir.clone());
        put(&src, "a", b"1");
        put(&src, "b", b"1");
        snapshot(&src, &store, store.manifest().generation + 1)
            .unwrap()
            .unwrap();

        // Yer değiştirmenin ortasında kalmış gibi: günlük ve incoming var, a taşınmış, b taşınmamış.
        put(&store_dir, "incoming/b", b"2");
        let next = Manifest {
            generation: 2,
            files: vec![
                FileEntry {
                    path: "a".into(),
                    size: 1,
                    sha256: manifest::sha256_file(&src.join("a")).unwrap(),
                },
                FileEntry {
                    path: "b".into(),
                    size: 1,
                    sha256: crate::hash::hash_bytes(crate::hash::HashAlgo::Sha256, b"2"),
                },
            ],
        };
        crate::shared::write_json(&store_dir.join("incoming/manifest.json"), &next).unwrap();
        crate::shared::write_json(
            &store_dir.join("journal.json"),
            &crate::shared::Journal {
                generation: 2,
                changed: vec!["a".into(), "b".into()],
                removed: vec![],
            },
        )
        .unwrap();
        // Eski manifest hâlâ yerinde (yarıda kalan değişiklik görünmez).
        assert_eq!(store.manifest().generation, 1);
        store.recover().unwrap();
        assert_eq!(store.manifest(), next);
        assert_eq!(std::fs::read(store.current().join("b")).unwrap(), b"2");
        assert!(!store_dir.join("journal.json").exists());
        assert!(!store_dir.join("incoming").exists());

        // Günlüksüz kalmış incoming silinir.
        put(&store_dir, "incoming/x", b"yarim");
        store.recover().unwrap();
        assert!(!store_dir.join("incoming").exists());
        let _ = std::fs::remove_dir_all(src);
        let _ = std::fs::remove_dir_all(store_dir);
    }

    #[test]
    fn checkout_writes_and_cleans() {
        let (src, store_dir, server) = (tmp("src"), tmp("store"), tmp("server"));
        let store = Store::at(store_dir.clone());
        put(&src, "world/level.dat", b"L");
        put(&src, "mods/a.jar", b"A");
        snapshot(&src, &store, store.manifest().generation + 1)
            .unwrap()
            .unwrap();
        put(&server, "world/level.dat", b"eski");
        put(&server, "world/fazla.dat", b"x");
        put(&server, "libraries/lib.jar", b"kalsin");
        store.checkout(&server).unwrap();
        assert_eq!(std::fs::read(server.join("world/level.dat")).unwrap(), b"L");
        assert_eq!(std::fs::read(server.join("mods/a.jar")).unwrap(), b"A");
        assert!(!server.join("world/fazla.dat").exists());
        assert!(server.join("libraries/lib.jar").exists());
        for d in [src, store_dir, server] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
