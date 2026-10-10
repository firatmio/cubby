use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

pub fn instances_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()?.join("instances"))
}

/// `id` frontend'den gelir; dizin dışına çıkılamasın diye yalnızca uuid karakterlerine izin verilir.
pub fn instance_dir(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    let valid = !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid {
        return Err(AppError::msg("Geçersiz sunucu kimliği"));
    }
    Ok(instances_dir(app)?.join(id))
}

pub fn server_dir(app: &AppHandle, id: &str) -> AppResult<PathBuf> {
    Ok(instance_dir(app, id)?.join("server"))
}
