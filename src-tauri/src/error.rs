use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Ağ hatası: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Dosya hatası: {0}")]
    Io(#[from] std::io::Error),
    #[error("Veri okunamadı: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Uygulama hatası: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("Bütünlük kontrolü başarısız: {file} (beklenen {expected}, gelen {actual})")]
    HashMismatch {
        file: String,
        expected: String,
        actual: String,
    },
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Msg(s.into())
    }
}

/// Frontend'e sadece okunur mesaj gider.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
