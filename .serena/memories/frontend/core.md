# frontend/core (src)

- Router yok: `store/appStore.ts` (zustand) içindeki `view` (`home | wizard | instance{id}`) `App.tsx`'te ekran seçer.
- `lib/api.ts` — typed invoke wrapper'ları + Rust tiplerinin aynası; `errorMessage()` Rust string hatalarını açar.
- `lib/events.ts` — Rust event'lerini store'a bağlar; log satırları rAF ile toplu eklenir; `starting` durumu logları sıfırlar.
- `components/Mc*` — pixel UI kit (McButton/McPanel/McInput/McSlider/McProgress/McModal/McTabs/StatusLamp), CSS Modules.
- `screens/` — HomeScreen, NewServerWizard (tür→sürüm→loader sürümü [vanilla'da yok]→RAM→isim+konum→kur; varsayılan Fabric + son release), InstanceScreen (+ `instance/` sekmeleri: Console, Settings [isim/RAM/sil], Files [sunucu + mods/plugins klasörü], Placeholder).
- `lib/format.ts` — `LOADER_LABELS`, `CONTENT_DIR_LABEL`, `describeInstance`; `lib/ram.ts` — RAM sınırları (sihirbaz + ayarlar ortak).
- Klasör seçimi `@tauri-apps/plugin-dialog` (`dialog:default` capability).

## Style invariants
- Stil: CSS Modules + `styles/global.css` değişkenleri; Tailwind yok.
- Tüm ölçüler 2/4'ün katı; `--px: 2px` "piksel" birimi; `image-rendering: pixelated`.
- Font Monocraft (OFL); Türkçe glifler var, ama `■ ✓ „` gibi bazı semboller yok — kullanmadan önce kontrol et.
- tsconfig lib ES2020: `Array.prototype.at` vb. yok.
