use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    Http(#[from] reqwest::Error),
    Io(#[from] std::io::Error),
    Json(#[from] serde_json::Error),
    Tauri(#[from] tauri::Error),
    HashMismatch {
        file: String,
        expected: String,
        actual: String,
    },
    Msg(String),
}

/// Kullanıcıya giden metin, etkin dilde.
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Http(e) => tx!("Ağ hatası: {e}", "Network error: {e}"),
            Self::Io(e) => tx!("Dosya hatası: {e}", "File error: {e}"),
            Self::Json(e) => tx!("Veri okunamadı: {e}", "Couldn't read data: {e}"),
            Self::Tauri(e) => tx!("Uygulama hatası: {e}", "App error: {e}"),
            Self::HashMismatch {
                file,
                expected,
                actual,
            } => tx!(
                "Bütünlük kontrolü başarısız: {file} (beklenen {expected}, gelen {actual})",
                "Integrity check failed: {file} (expected {expected}, got {actual})"
            ),
            Self::Msg(m) => m.clone(),
        };
        f.write_str(&s)
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{Lang, set_lang};

    #[test]
    fn speaks_the_active_language() {
        let e = || AppError::HashMismatch {
            file: "a.jar".into(),
            expected: "1".into(),
            actual: "2".into(),
        };
        set_lang(Lang::En);
        assert_eq!(
            e().to_string(),
            "Integrity check failed: a.jar (expected 1, got 2)"
        );
        set_lang(Lang::Tr);
        assert!(e().to_string().starts_with("Bütünlük kontrolü başarısız"));
    }
}
