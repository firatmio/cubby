//! Ortak dünya: "kim açıksa dünya açık". Dünya grubun; en güncel hâline sahip arkadaş açabilir.
//!
//! Hakem davet sunucusu (`web/lib/shared.ts`): kim açık (kira), en güncel nesil kimde. Bu modül
//! dünyanın kendisini taşıyan motor: tutarlı anlık kopya (`snapshot`), neslin dosya listesi
//! (`manifest`), arkadaştan yalnız değişen parçaları çekme (`sync`) ve sunucuyla imzalı konuşma (`web`).
//!
//! Dünya başına depo (`<dünya>/.mcsm/shared/`):
//! - `current/`: son neslin tutarlı kopyası; arkadaşlar hep buradan çeker, canlı dosyadan değil.
//! - `manifest.json`, `index.json` (değişmeyen dosya yeniden özetlenmesin).
//! - `backups/<nesil>/`: o nesille değişen dosyaların eski hâlleri, son 3 nesil.
//! - `incoming/` + `journal.json`: yeni nesil önce buraya iner; yer değiştirme günlükle yapılır,
//!   yarıda kalırsa `recover` tamamlar.

pub mod host;
pub mod manifest;
pub mod member;
pub mod snapshot;
pub mod sync;
mod tf;
pub mod web;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::p2p::Decision;
use crate::p2p::protocol::{Reply, StreamHeader, StreamKind};
use manifest::{Diff, Manifest};

/// Manifest gövdesinin üst sınırı (on binlerce dosyalı dünyalar için bile bol).
pub const MAX_MANIFEST: usize = 16 * 1024 * 1024;
/// Blok özeti listesinin üst sınırı: 4 KB blok başına 8 bayt → 2 GB'lık dosya.
pub const MAX_BLOCK_LIST: usize = 4 * 1024 * 1024;
/// Kaç neslin yedeği tutulur.
const KEEP_BACKUPS: usize = 3;

/// Yarıda kalan yer değiştirmenin kaydı.
#[derive(Debug, Serialize, Deserialize)]
struct Journal {
    #[serde(rename = "gen")]
    generation: u64,
    changed: Vec<String>,
    removed: Vec<String>,
}

/// Değişmeyen dosyayı yeniden özetlememek için: yol → (boyut, değişiklik zamanı ns, sha256).
pub type Index = HashMap<String, (u64, u128, String)>;

pub struct Store {
    root: PathBuf,
}

impl Store {
    /// `instance_dir`: dünyanın klasörü (içinde `.mcsm/`).
    pub fn for_instance(instance_dir: &Path) -> Self {
        Self::at(instance_dir.join(crate::sessions::META_DIR).join("shared"))
    }

    pub fn at(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn current(&self) -> PathBuf {
        self.root.join("current")
    }
    fn incoming(&self) -> PathBuf {
        self.root.join("incoming")
    }
    fn backups(&self) -> PathBuf {
        self.root.join("backups")
    }
    fn journal_path(&self) -> PathBuf {
        self.root.join("journal.json")
    }

    /// Son nesil; hiç yoksa boş (nesil 0).
    pub fn manifest(&self) -> Manifest {
        read_json(&self.root.join("manifest.json")).unwrap_or_default()
    }

    /// Sunucu klasörüne en son hangi nesil yerleştirildi (ya da hangi neslin kopyası ondan alındı).
    pub fn checked_out(&self) -> Option<u64> {
        read_json(&self.root.join("checkout.json"))
    }

    pub fn mark_checked_out(&self, generation: u64) -> AppResult<()> {
        write_json(&self.root.join("checkout.json"), &generation)
    }

    /// Sahip beklemeyi kaldırınca elde kalan en yeni kopya yeni nesil sayılır: içerik aynı, numarası
    /// değişir (başkaları bu numarayla ister).
    pub fn relabel(&self, generation: u64) -> AppResult<()> {
        let mut m = self.manifest();
        if m.generation == 0 || m.generation >= generation {
            return Ok(());
        }
        if self.checked_out() == Some(m.generation) {
            self.mark_checked_out(generation)?;
        }
        m.generation = generation;
        write_json(&self.root.join("manifest.json"), &m)
    }

    fn index(&self) -> Index {
        read_json(&self.root.join("index.json")).unwrap_or_default()
    }

    fn save_index(&self, index: &Index) -> AppResult<()> {
        write_json(&self.root.join("index.json"), index)
    }

    /// `incoming/`'e inen dosyalar yeni nesil olur: değişenlerin eski hâli `backups/<gen>/`'e,
    /// yeniler `current/`'a; en son manifest yazılır. Her adım tekrarlanabilir (`recover`).
    fn commit(&self, next: &Manifest, diff: &Diff) -> AppResult<()> {
        std::fs::create_dir_all(&self.root)?;
        write_json(&self.incoming().join("manifest.json"), next)?;
        write_json(
            &self.journal_path(),
            &Journal {
                generation: next.generation,
                changed: diff.changed.clone(),
                removed: diff.removed.clone(),
            },
        )?;
        self.finish()
    }

    /// Günlükteki yer değiştirmeyi tamamlar (zaten yapılmış adımlar atlanır).
    fn finish(&self) -> AppResult<()> {
        let Some(j) = read_json::<Journal>(&self.journal_path()) else {
            return Ok(());
        };
        let backup = self.backups().join(j.generation.to_string());
        for path in &j.changed {
            let incoming = self.incoming().join(path);
            if !incoming.exists() {
                continue; // bu dosya zaten taşındı
            }
            let current = self.current().join(path);
            if current.exists() {
                move_file(&current, &backup.join(path))?;
            }
            move_file(&incoming, &current)?;
        }
        for path in &j.removed {
            let current = self.current().join(path);
            if current.exists() {
                move_file(&current, &backup.join(path))?;
            }
        }
        let next: Manifest = read_json(&self.incoming().join("manifest.json"))
            .ok_or_else(|| crate::error::AppError::msg("journal without manifest"))?;
        write_json(&self.root.join("manifest.json"), &next)?;
        std::fs::remove_file(self.journal_path())?;
        let _ = std::fs::remove_dir_all(self.incoming());
        self.prune_backups();
        Ok(())
    }

    /// Açılışta: yarıda kalan yer değiştirmeyi tamamlar; günlüksüz kalmış `incoming/`'i siler.
    pub fn recover(&self) -> AppResult<()> {
        if self.journal_path().exists() {
            return self.finish();
        }
        if self.incoming().exists() {
            std::fs::remove_dir_all(self.incoming())?;
        }
        Ok(())
    }

    fn prune_backups(&self) {
        let Ok(rd) = std::fs::read_dir(self.backups()) else {
            return;
        };
        let mut gens: Vec<u64> = rd
            .flatten()
            .filter_map(|e| e.file_name().to_str()?.parse().ok())
            .collect();
        gens.sort_unstable_by(|a, b| b.cmp(a));
        for g in gens.into_iter().skip(KEEP_BACKUPS) {
            let _ = std::fs::remove_dir_all(self.backups().join(g.to_string()));
        }
    }

    /// Son nesli sunucu klasörüne yazar: dünya açılmadan önce. Listede olmayan izlenen dosyalar silinir.
    pub fn checkout(&self, server_dir: &Path) -> AppResult<()> {
        let m = self.manifest();
        let wanted: std::collections::HashSet<&str> =
            m.files.iter().map(|f| f.path.as_str()).collect();
        for (path, _) in manifest::scan(server_dir)? {
            if !wanted.contains(path.as_str()) {
                std::fs::remove_file(server_dir.join(&path))?;
            }
        }
        for f in &m.files {
            let dest = server_dir.join(&f.path);
            if dest.is_file()
                && std::fs::metadata(&dest)?.len() == f.size
                && manifest::sha256_file(&dest)? == f.sha256
            {
                continue;
            }
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let tmp = dest.with_extension("cubby-tmp");
            std::fs::copy(self.current().join(&f.path), &tmp)?;
            std::fs::rename(&tmp, &dest)?;
        }
        Ok(())
    }

    /// Başka bir üyenin isteğine karar: istenen nesil bizdeki değilse `Denied` (çeken başka kaynağa geçer).
    /// Grup ve token denetimini çağıran yapar.
    pub fn serve(&self, h: &StreamHeader, ok: Reply) -> Decision {
        let m = self.manifest();
        if h.generation != Some(m.generation) || m.generation == 0 {
            return Decision::Reply(Reply::Denied);
        }
        let file = || {
            let path = h.file.as_deref()?;
            if !manifest::is_safe_path(path) {
                return None;
            }
            m.get(path).map(|f| (self.current().join(&f.path), f.size))
        };
        match h.kind {
            StreamKind::WorldManifest => match serde_json::to_vec(&m) {
                Ok(body) => Decision::Body(ok, body),
                Err(_) => Decision::Reply(Reply::Denied),
            },
            StreamKind::WorldBlocks => match file().map(|(p, _)| manifest::block_hashes(&p)) {
                Some(Ok(body)) => Decision::Body(ok, body),
                _ => Decision::Reply(Reply::Denied),
            },
            StreamKind::WorldRead => match (file(), h.range) {
                (Some((path, size)), Some([start, len]))
                    if start.checked_add(len).is_some_and(|end| end <= size) =>
                {
                    Decision::FileRange(ok, path, start, len)
                }
                _ => Decision::Reply(Reply::Denied),
            },
            _ => Decision::Reply(Reply::Denied),
        }
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(value)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn move_file(from: &Path, to: &Path) -> AppResult<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if to.exists() {
        std::fs::remove_file(to)?;
    }
    std::fs::rename(from, to)?;
    Ok(())
}
