//! Neslin dosya listesi: hangi dosyalar aktarılır, özetleri, iki nesil arasındaki fark ve dosyaların
//! 4 KB'lık blok özetleri (yalnız değişen parçalar gitsin diye).

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::AppResult;

/// Blok boyutu: bölge dosyalarının (.mca) sektör boyutu.
pub const BLOCK: u64 = 4096;

/// Her bilgisayarda yeniden kurulan ya da geçici olan, aktarılmayan üst klasörler.
const SKIP_DIRS: &[&str] = &[
    "libraries",
    "versions",
    "logs",
    ".fabric",
    "cache",
    "crash-reports",
    "debug",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(rename = "gen")]
    pub generation: u64,
    pub files: Vec<FileEntry>,
}

impl Manifest {
    pub fn get(&self, path: &str) -> Option<&FileEntry> {
        self.files.iter().find(|f| f.path == path)
    }
}

/// Göreli yol aktarıma girer mi? (`/` ayraçlı.)
pub fn is_tracked(rel: &str) -> bool {
    let top = rel.split('/').next().unwrap_or("");
    if SKIP_DIRS.contains(&top) {
        return false;
    }
    let name = rel.rsplit('/').next().unwrap_or(rel);
    // Sunucunun kilidi ve kök dizindeki sunucu jar'ları (her bilgisayarda kurulur); modlar aktarılır.
    if name == "session.lock" || (!rel.contains('/') && name.ends_with(".jar")) {
        return false;
    }
    true
}

/// Yol güvenli mi: göreli, `..` yok, sürücü harfi yok.
pub fn is_safe_path(rel: &str) -> bool {
    !rel.is_empty()
        && rel.len() <= 512
        && !rel.starts_with('/')
        && !rel.contains('\\')
        && !rel.contains(':')
        && rel
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}

/// `root` altındaki aktarılan dosyalar: göreli yol → (boyut, değişiklik zamanı ns).
pub fn scan(root: &Path) -> AppResult<BTreeMap<String, (u64, u128)>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel_dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(root.join(&rel_dir)) else {
            continue;
        };
        for entry in rd.flatten() {
            let rel = rel_dir.join(entry.file_name());
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            if !is_tracked(&rel_s) {
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            if md.is_dir() {
                stack.push(rel);
            } else if md.is_file() && is_safe_path(&rel_s) {
                let mtime = md
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_nanos());
                out.insert(rel_s, (md.len(), mtime));
            }
        }
    }
    Ok(out)
}

/// Dosyanın tamamının SHA-256'sı.
pub fn sha256_file(path: &Path) -> AppResult<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Blok başına SHA-256'nın ilk 8 baytı (dosyanın tamamı ayrıca doğrulanır).
pub fn block_hashes(path: &Path) -> AppResult<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let mut out = Vec::new();
    let mut buf = vec![0u8; BLOCK as usize];
    loop {
        let mut n = 0;
        while n < buf.len() {
            let r = f.read(&mut buf[n..])?;
            if r == 0 {
                break;
            }
            n += r;
        }
        if n == 0 {
            break;
        }
        out.extend_from_slice(&Sha256::digest(&buf[..n])[..8]);
        if n < buf.len() {
            break;
        }
    }
    Ok(out)
}

/// Uzaktaki dosyayı elde etmek için çekilmesi gereken bitişik aralıklar ([başlangıç, uzunluk]).
/// `local`/`remote`: 8'er baytlık blok özetleri; `size`: uzaktaki dosyanın boyutu.
pub fn ranges(local: &[u8], remote: &[u8], size: u64) -> Vec<[u64; 2]> {
    let blocks = remote.len() / 8;
    let mut out: Vec<[u64; 2]> = Vec::new();
    for i in 0..blocks {
        let same = local.get(i * 8..i * 8 + 8) == remote.get(i * 8..i * 8 + 8);
        if same {
            continue;
        }
        let start = i as u64 * BLOCK;
        let len = BLOCK.min(size.saturating_sub(start));
        match out.last_mut() {
            Some(last) if last[0] + last[1] == start => last[1] += len,
            _ => out.push([start, len]),
        }
    }
    out
}

/// İki liste arasındaki fark (yol sırasıyla).
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Diff {
    /// Yeni ya da içeriği değişen dosyalar.
    pub changed: Vec<String>,
    pub removed: Vec<String>,
}

impl Diff {
    pub fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.removed.is_empty()
    }
}

pub fn diff(old: &[FileEntry], new: &[FileEntry]) -> Diff {
    let old_map: HashMap<&str, &str> = old
        .iter()
        .map(|f| (f.path.as_str(), f.sha256.as_str()))
        .collect();
    let new_paths: std::collections::HashSet<&str> = new.iter().map(|f| f.path.as_str()).collect();
    Diff {
        changed: new
            .iter()
            .filter(|f| old_map.get(f.path.as_str()) != Some(&f.sha256.as_str()))
            .map(|f| f.path.clone())
            .collect(),
        removed: old
            .iter()
            .filter(|f| !new_paths.contains(f.path.as_str()))
            .map(|f| f.path.clone())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracked_rule() {
        assert!(is_tracked("world/region/r.0.0.mca"));
        assert!(is_tracked("server.properties"));
        assert!(is_tracked("mods/lithium.jar"));
        assert!(is_tracked("config/c2me.toml"));
        assert!(!is_tracked("fabric-server-launch.jar"));
        assert!(!is_tracked("libraries/net/x.jar"));
        assert!(!is_tracked("logs/latest.log"));
        assert!(!is_tracked("world/session.lock"));
        assert!(!is_tracked("versions/26.3/server.jar"));
    }

    #[test]
    fn safe_paths() {
        assert!(is_safe_path("world/region/r.0.0.mca"));
        for bad in [
            "", "../x", "a/../b", "/etc/x", "C:/x", "a\\b", "a//b", "./a",
        ] {
            assert!(!is_safe_path(bad), "{bad}");
        }
    }

    #[test]
    fn ranges_merge_and_clip() {
        let h = |b: u8| [b; 8];
        let local: Vec<u8> = [h(1), h(2), h(3), h(4)].concat();
        // Uzakta 2. ve 3. blok değişmiş, bir de yeni (kısa) 5. blok var.
        let remote: Vec<u8> = [h(1), h(9), h(9), h(4), h(7)].concat();
        let size = 4 * BLOCK + 100;
        assert_eq!(
            ranges(&local, &remote, size),
            vec![[BLOCK, 2 * BLOCK], [4 * BLOCK, 100]]
        );
        assert!(ranges(&local, &local, 4 * BLOCK).is_empty());
        // Yerelde hiç yoksa tamamı tek aralık.
        assert_eq!(ranges(&[], &remote, size), vec![[0, size]]);
    }

    #[test]
    fn diff_lists() {
        let e = |p: &str, h: &str| FileEntry {
            path: p.into(),
            size: 1,
            sha256: h.into(),
        };
        let d = diff(
            &[e("a", "1"), e("b", "1"), e("c", "1")],
            &[e("a", "1"), e("b", "2"), e("d", "1")],
        );
        assert_eq!(d.changed, vec!["b", "d"]);
        assert_eq!(d.removed, vec!["c"]);
    }

    #[test]
    fn block_hashes_cover_partial_tail() {
        let dir = std::env::temp_dir().join(format!("cubby-bh-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f");
        std::fs::write(&p, vec![7u8; (BLOCK * 2 + 10) as usize]).unwrap();
        assert_eq!(block_hashes(&p).unwrap().len(), 3 * 8);
        std::fs::write(&p, b"").unwrap();
        assert!(block_hashes(&p).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
