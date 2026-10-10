# frontend/core (src)

- Düzen: `App.tsx` iki sütun — `screens/Sidebar.tsx` (sunucu listesi + "Yeni sunucu") ve sağ panel. Router yok: zustand `view` = `empty | wizard | instance{id}`; açılışta ilk sunucu seçilir, silinince başkasına geçilir.
- `lib/api.ts` — typed invoke wrapper'ları + Rust tiplerinin aynası; `errorMessage()`, `pickFolder()`, `openExternal()`.
- `lib/events.ts` — Rust event'lerini store'a bağlar; log satırları rAF ile toplu eklenir; `starting` durumu logları sıfırlar.
- `lib/mock.ts` — YALNIZ dev: Tauri yokken (`IS_MOCK`) api/event'ler sahte veriyle çalışır; `bun run dev` + tarayıcıda `localhost:1420` ile arayüz Tauri'siz denenebilir. Prod pakete girmemesi için her kullanım `import.meta.env.DEV && IS_MOCK` koşulu + dinamik import ile.
- `ui/` — UI kiti: Button (primary/secondary/ghost/danger, `icon`, `loading`), Input+Field, Slider, Progress, Dialog (body'ye portal), Tabs, Badge/StatusBadge/StatusDot, SelectList (tek seçimli liste), Card+EmptyState, ServerAvatar (pixel çim bloğu — tek pixel-art öğe).
- `screens/` — NewServerWizard (tür→sürüm→loader [vanilla'da yok]→bellek→isim+konum→kur), InstanceScreen (başlık şeridi + sekmeler), `instance/` (Console, Settings, JavaSection, Files, Placeholder, JavaDownloadProgress).
- `lib/format.ts` (`LOADER_LABELS`, `describeInstance`...), `lib/ram.ts` (RAM sınırları).

## Stil
- CSS Modules + `styles/tokens.css` (tüm renkler/ölçüler). Griler NÖTR (R=G=B) — kullanıcı isteği; renk yalnız vurgu (çim yeşili `--accent`) ve durumlar için.
- Tema otomatik: `prefers-color-scheme`; yeni renk eklerken iki temaya da token yaz.
- Fontlar Inter + JetBrains Mono (`@fontsource-variable`, offline), ikonlar `lucide-react`.
- Dialog'lar portal ile çizilir: sayfa kapsayıcılarının `max-width`/overflow kuralları modalı bozmasın.
