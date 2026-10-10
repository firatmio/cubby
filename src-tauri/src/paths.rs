use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::registry::Registry;

/// `id` frontend'den gelir; yalnızca uuid karakterlerine izin verilir.
pub fn validate_id(id: &str) -> AppResult<()> {
    let valid = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(AppError::msg("Geçersiz sunucu kimliği"))
    }
}

pub fn instance_dir(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    validate_id(id)?;
    app.state::<Registry>()
        .path_of(id)
        .ok_or_else(|| AppError::msg("Sunucu bulunamadı"))
}

pub fn server_dir(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    Ok(instance_dir(app, id)?.join("server"))
}
