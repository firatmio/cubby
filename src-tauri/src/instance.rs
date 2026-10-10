use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;
use crate::paths;

const INSTANCE_FILE: &str = "instance.json";

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

pub fn get(app: &AppHandle, id: &str) -> AppResult<Instance> {
    let dir = paths::instance_dir(app, id)?;
    Instance::load(&dir).map_err(|_| AppError::msg("Sunucu bulunamadı"))
}

/// Okunamayan (yarım kalmış/bozuk) klasörler atlanır.
pub fn list(app: &AppHandle) -> AppResult<Vec<Instance>> {
    let root = paths::instances_dir(app)?;
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<Instance> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| Instance::load(&e.path()).ok())
        .collect();
    out.sort_by_key(|i| i.created_at);
    Ok(out)
}
