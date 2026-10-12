# conventions

- Yorumlar Türkçe; kısa, "neden"i anlatır.
- Kullanıcıya dönük metinler iki dilli (tr + en):
  - Arayüz: `src/i18n/tr.ts` asıl sözlük, `en.ts` `Dict` tipinde (eksik anahtar tsc'de hata). Bileşende `const t = useT()`, bileşen dışında `getT()`, tarih/sayı için `locale()`. Değişkenli metin = fonksiyon.
  - Rust: `tx!("Türkçe {x}", "English {x}")` (`i18n.rs`, global dil `AtomicU8`; testlerde thread-local, varsayılan tr). `AppError` Display'i de etkin dilde.
  - Etkin dil: `settings.language` (None = `sys-locale`); `get_settings`/`update_settings` `language` döner, arayüz `useLang.setLang` ile uyar; tepsi menüsü `refresh_tray`.
  - Arayüzün tanıması gereken hatalar kod önekiyle: `[NOT_APPROVED] …` → `errorCode(e)`; `errorMessage(e)` öneki atar.
- Rust: modül başına tek sorumluluk; hata → `AppResult<T>`, kullanıcıya gidecek mesaj `AppError::msg(tx!(…))`.
- Serde: struct'lar `#[serde(rename_all = "camelCase")]`, enum'lar `lowercase`; `type` alanı `#[serde(rename = "type")] kind`.
- Gelecek milestone'da kullanılacak ama henüz kullanılmayan öğeler: `#[allow(dead_code)] // Mx: …` ile işaretlenir.
- React: function component + CSS Module; class birleştirme `[a, cond && b].filter(Boolean).join(" ")`.
- Tauri event adları `alan://olay` biçiminde (`server://log`, `install://progress`, `app://shutting-down`).
