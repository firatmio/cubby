use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;
use crate::paths;
use crate::registry::Registry;

pub const INSTANCE_FILE: &str = "instance.json";

/// `instance.json`'u okuyup yazan işlemler (arayüz + arka plan kapak üretimi) çakışmasın.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoverKind {
    /// Oyun içi ekran görüntülerinden otomatik seçildi; yeni oturumda güncellenebilir.
    Auto,
    /// Kullanıcı seçti; otomatik olarak değiştirilmez.
    Manual,
}

/// Dünyanın arka plan görseli (`.mcsm/cover.jpg`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cover {
    pub kind: CoverKind,
    /// Görselin baskın rengi (`#rrggbb`); arayüzde vurgu rengi.
    pub color: String,
    /// Her değişimde artar; görsel URL'lerinde önbellek kırıcı.
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub loader: LoaderKind,
    pub mc_version: String,
    pub loader_version: Option<String>,
    /// Kullanıcının seçtiği java; `None` ise otomatik bulunur.
    pub java_path: Option<String>,
    /// MC sürümünün istediği Java major sürümü (Mojang manifest'inden).
    pub java_major: u32,
    pub ram_min_mb: u32,
    pub ram_max_mb: u32,
    pub port: u16,
    pub created_at: u64,
    #[serde(default)]
    pub cover: Option<Cover>,
    /// İnternetten katılım açık mı (modemde port açılır).
    #[serde(default)]
    pub internet: bool,
    /// Davet linklerinin anahtarı; yenilenince eski davetler geçersiz olur.
    #[serde(default)]
    pub invite_token: Option<String>,
    /// Davet sunucusundaki kısa kod (`K7M-2QX`); `token` hangi davet anahtarına ait olduğunu tutar.
    #[serde(default)]
    pub short_invite: Option<crate::short_invite::ShortInvite>,
}

impl Instance {
    pub fn load(dir: &Path) -> AppResult<Self> {
        let text = std::fs::read_to_string(dir.join(INSTANCE_FILE))?;
        Ok(serde_json::from_str(&text)?)
    }

    pub fn save(&self, dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join(format!("{INSTANCE_FILE}.tmp"));
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(tmp, dir.join(INSTANCE_FILE))?;
        Ok(())
    }
}

/// Oku → değiştir → yaz; eşzamanlı yazımlara karşı kilitli.
pub fn modify(dir: &Path, f: impl FnOnce(&mut Instance) -> AppResult<()>) -> AppResult<Instance> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut inst = Instance::load(dir)?;
    f(&mut inst)?;
    inst.save(dir)?;
    Ok(inst)
}

pub fn get(app: &AppHandle, id: &str) -> AppResult<Instance> {
    let dir = paths::instance_dir(app, id)?;
    Instance::load(&dir).map_err(|_| AppError::msg(tx!("Sunucu bulunamadı", "Server not found")))
}

/// Okunamayan klasörler (silinmiş, takılı olmayan disk, bozuk dosya) atlanır.
pub fn list(app: &AppHandle) -> Vec<Instance> {
    let mut out: Vec<Instance> = app
        .state::<Registry>()
        .paths()
        .iter()
        .filter_map(|p| Instance::load(p).ok())
        .collect();
    out.sort_by_key(|i| i.created_at);
    out
}
