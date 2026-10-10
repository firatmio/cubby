# conventions

- Yorumlar ve kullanıcıya dönük mesajlar Türkçe; kısa, "neden"i anlatır.
- Rust: modül başına tek sorumluluk; hata → `AppResult<T>`, kullanıcıya gidecek mesaj `AppError::msg("…")`.
- Serde: struct'lar `#[serde(rename_all = "camelCase")]`, enum'lar `lowercase`; `type` alanı `#[serde(rename = "type")] kind`.
- Gelecek milestone'da kullanılacak ama henüz kullanılmayan öğeler: `#[allow(dead_code)] // Mx: …` ile işaretlenir.
- React: function component + CSS Module; class birleştirme `[a, cond && b].filter(Boolean).join(" ")`.
- Tauri event adları `alan://olay` biçiminde (`server://log`, `install://progress`, `app://shutting-down`).
