# backend: kapaklar, oturumlar, ayarlar, media protokolü

- `settings.rs` — `SettingsStore` (`app_data/settings.json`: `minecraftDir`, `useScreenshots`); `default_minecraft_dir()` OS'a göre (M7 de kullanır).
- `sessions.rs` — `install(app)`: Rust tarafında `server://status` dinler (`Listener::listen_any`), running→başlangıç, stopped/crashed→`<instance>/.mcsm/sessions.json`'a ekler ve `covers::after_session` tetikler. ServerManager'a dokunmaz.
- `covers.rs` — ekran görüntüsü zamanı = dosya mtime; oturum aralığı +2 dk tolerans. `render_cover` (image crate): 1920px `cover.jpg` + 480px `thumb.jpg` (q85) + doygunluk ağırlıklı baskın renk. `instance.cover {kind: auto|manual, color, version}`; manual kapak otomatik değişmez. Oturum sonunda değişirse `cover://changed` emit.
- `media.rs` — `register_asynchronous_uri_scheme_protocol("media")`, iş `spawn_blocking`'de. Yalnız `/cover/<id>`, `/thumb/<id>`, `/shot/<dosya>` (dosya adı `is_valid_shot_name`, `%`/ayırıcı reddi). Shot önizlemeleri `app_data/cache/shots/`.
- `instance::modify(dir, f)` — instance.json için kilitli oku-değiştir-yaz; arayüz ve arka plan kapak üretimi çakışmasın diye tüm yazımlar bunu kullanmalı.
- Oyuncular: `server/log.rs` join/left ayrıştırma (isim `[A-Za-z0-9_]{1,16}`), `server://players`, snapshot'ta `players`.
- `lan_address` — `local-ip-address` + `server.properties`'teki `server-port`.
- Pencere: `decorations:false`, `resizable:false`, `maximizable:false`; capability'de window minimize/close/start-dragging.
- Debug build'de 4K PNG'den kapak ~2.4 sn (release çok daha hızlı).
