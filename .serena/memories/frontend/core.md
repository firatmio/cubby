# frontend/core (src)

Konsol (PS5 UI matematiği) tarzı: sabit 1200×720, yalnız koyu tema, özel başlık çubuğu.

- `App.tsx` — `shell/Background` (dünya kapağı çapraz geçiş / tür rengi parlaması) + `shell/TitleBar` (startDragging, küçült, kapat, ⚙) + `AnimatePresence` ile `home | setup`; paneller (`PlayersSheet`, `WorldSettingsSheet`, `AdvancedSheet`, `CoverSheet`, `AppSettingsSheet`) her zaman monte, `sheet` store alanıyla açılır. `--accent` CSS değişkeni seçili dünyanın kapak rengi (`@property` ile yumuşak geçiş).
- Store (zustand): `view`, `selectedId`, `sheet`, `setupColor`; sunucu başına `status/logs/stats/players/rejected`. `loadInstances` tüm sunucuların snapshot'ını hydrate eder.
- `screens/home/` — TileRow (kutucuklar; kapak küçük resmi `media` thumb ya da tür ikonu), Hero, InfoCards (oyuncular, LAN davet kopyala, son oynanma), ActionBar (sağ alt: Başlat/Durdur + ikon butonlar), `useServerControl` (EULA → Java → başlat akışı + diyaloglar). ←/→ dünya değiştirir.
- `screens/setup/SetupFlow` — adım başına tek soru (tür → sürüm → isim → "Kimler girebilsin?" → [beyaz liste, yalnız açıksa] → kurulum; adımlar `questionSteps` ile dinamik, TLauncher açıksa beyaz liste zorunlu, isimler `lookupPlayer` ile doğrulanır); loader sürümü/bellek/konum "Gelişmiş seçenekler"de. `loaderVersion: null` = Rust önerileni seçer.
- `screens/players/PlayersSheet` (oyunda/yetkili/at, giremeyenler, beyaz liste, daha önce girenler), `screens/world/WorldSettingsSheet` (zorluk, mod, PvP, MOTD, TLauncher; kaydet → yeniden başlatınca geçerli).
- `screens/connection/` — `ConnectionSheet` (LAN, "İnternete aç", modem üzerinden adres; olmazsa UPnP açma ipucu + "yakında uygulama ile doğrudan"), `useConnection` (store `connections` + `net://status`), `bestInvite` (modem → LAN; ana ekran davet kartı).
- `screens/join/` — `JoinDialog` (store `joinDialog`: null kapalı / "" boş / kod; önizleme → onay), `JoinedHome` (JoinedHero/Cards/Actions). Katılınan dünyalar store `joined`, seçim kimliği `join:<id>` (`joinKey`, `useSelectedJoined`), `selectStep` ikisini birlikte gezer. TileRow'da arkadaş kutucukları + "Katıl" kutucuğu. Bağlantı panelinde en üstte "Uygulamayla davet et".
- `screens/advanced/` (Konsol, Dünya, Tüm ayarlar (`PropertiesTab`), Java, Dosyalar — `screens/instance/*` bileşenleri yeniden kullanılır), `screens/cover/CoverSheet` (eşlenen/diğer ekran görüntüleri, bilgisayardan seç, otomatik), `screens/settings/AppSettingsSheet`.
- `lib/api.ts` — invoke + tipler; `mediaUrl(path, v)` → `convertFileSrc("", "media") + path` (`cover/<id>`, `thumb/<id>`, `shot/<dosya>`).
- `lib/mock.ts` — YALNIZ dev: Tauri yokken sahte veri (`bun run dev` + tarayıcı). Her kullanım `import.meta.env.DEV && IS_MOCK` + dinamik import; prod paket kontrolü: dist'te "mockInvoke" aranır ("stop-color" React'ten gelir, yanlış alarm). Mock dosyasını düzenlemek HMR ile store'u tutarsızlaştırabilir → sayfayı yenile.
- `lib/motion.ts` — `spring`, `rise`, `stagger`, `screen`, `press` ön ayarları (`motion/react`).
- `ui/` — Button (hap, motion), IconButton (daire + ipucu), Sheet (sağdan, portal), Dialog (portal), PillTabs (kayan beyaz arka plan), SelectList, Toggle, Slider, Input/Field, Progress, Badge/StatusDot, Card/EmptyState.

## Stil kuralları
- Token'lar `styles/tokens.css`; griler nötr, ana buton beyaz, renk yalnız vurgu/durum. Butonlar tam hap/daire, kartlar 24px, kutucuklar 28px.
- Ana eylem her ekranda sağ altta; kenar boşluğu 48px (`--edge`).
- Kullanıcıya görünen dil: "dünya", "arkadaşın" ("kardeşin" DEĞİL — kullanıcı değiştirdi), "Modlu/Eklentili/Saf Minecraft"; teknik adlar ikinci planda (`LOADER_LABELS`, `describeInstance`).
- Tarayıcı panelinde (Claude Browser) koordinatlı tıklamalar ölçek yüzünden kayabiliyor; testte `javascript_tool` ile `button[aria-label=...]`.click() daha güvenilir.
