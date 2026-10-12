# core

**Ad: Cubby** (2026-10-12). Kimlik `com.quacomes.cubby`, davet şeması `cubby://` (`consts::URL_SCHEME`; eski `mcsm` de kabul: `LEGACY_URL_SCHEME`). Eski veri klasörü `com.firatmio.mc-server-launcher` ilk açılışta `migrate::app_data` ile taşınır, kayıtlardaki yollar düzeltilir. İç önekler (`mcsm-` profil/sürüm, `.minecraft/mcsm/`, `.mcsm`, iroh ALPN `mcsm/mc/1`, crate adı) veri uyumu için değişmedi. Launcher profil adı "<Dünya> · Cubby".

Minecraft Java sunucu yöneticisi (Tauri 2 masaüstü). Hedefler/milestone listesi: `SPEC.md` (M1–M7). M7 = istemci "Katıl" modu (davet linki, servers.dat, mod senkronu).

## Source map
- `src-tauri/src/` — Rust backend; tüm ağ/indirme/süreç işleri burada. Ayrıntı: `mem:backend/core`, kapak/oturumlar `mem:backend/covers_sessions`, server.properties/beyaz liste/oyuncular `mem:backend/players_access`, internet (UPnP) `mem:backend/net`, Katıl modu/doğrudan bağlantı `mem:backend/p2p_join`, mod mağazası `mem:backend/mods`, modların oyuncunun Minecraft'ına kurulması ve "Başlat ve katıl" (Quick Play sarmalayıcı sürüm, Launcher'ı açma) `mem:backend/client`, oyunu Launcher'sız açma + Microsoft girişi (M9) `mem:backend/game_auth`
- `src/` — React UI; yalnızca `invoke` + event dinler. Ayrıntı: `mem:frontend/core`
- `scripts/gen-textures.mjs` — 16x16 doku PNG üretici (Mojang asset'i repoya girmez; lisanslar `ASSETS.md`)

## Project-wide invariants
- UI metinleri Türkçe; kod/identifier İngilizce.
- Rust↔TS sözleşmesi elle senkron: serde `camelCase` struct'lar ↔ `src/lib/api.ts` tipleri; event adları hem `server/mod.rs`/`commands.rs`/`lib.rs` hem `src/lib/events.ts` içinde sabit.
- İndirilen her dosya hash ile doğrulanır (`download::download_file` + `hash::HashAlgo`).
- Hard-coded MC sürümü yok; her şey API'den.
- Her milestone sonunda tek commit, app çalışır halde.

Stack/komutlar: `mem:tech_stack`, `mem:suggested_commands`, `mem:task_completion`, stil: `mem:conventions`.

## Yol haritası (2026-10-12)
M1–M8 hepsi bitti (M6 NeoForge/Forge/Quilt 2026-10-12; M8 Modrinth mod mağazası; CurseForge anahtar istediği için yok). Sıradaki: isim, web katılım sayfası, yayın hazırlığı. Web katılım sayfası uygulamanın adı belli olunca (URL şeması `consts::URL_SCHEME` "mcsm" da o zaman). Testler (iki bilgisayarlı uçtan uca, kurulum dosyası) en sona; kullanıcı yerelde test edebileceği şeyleri kendisi dener.
Sonraya (yalnız not): dünya yedekleme — Google hesabı bağlayıp Drive'a yedek; ileride premium hesapla kendi VDS'imizde yedek.
