# backend/core (src-tauri/src)

- `lib.rs` — Builder; `tauri-plugin-single-instance` İLK plugin olmalı (M7 deep-link buna dayanır). Kapanış: `CloseRequested`/`ExitRequested` → aktif sunucu varsa engelle, `app://shutting-down` emit, `ServerManager::stop_all`, sonra `app.exit(0)`; `SHUTTING_DOWN` atomik döngüyü önler.
- `commands.rs` — tüm `#[tauri::command]`'lar + `AppState { vanilla, servers }`. `create_instance` hata olursa instance klasörünü siler; `instance.json` ancak kurulum bitince yazılır.
- `consts.rs` — `URL_SCHEME` (M7 davet şeması, tek yer), STOP_TIMEOUT, LOG_BACKLOG.
- `paths.rs` — `app_data_dir/instances/<id>/{instance.json, server/}`; id yalnız `[A-Za-z0-9-]` (path traversal koruması).
- `loaders/` — M1'de `LoaderKind::Vanilla` + `vanilla::VanillaApi` (manifest 10 dk cache). M2'de `Loader` trait (enum dispatch) gelecek.
- `server/` — `ServerManager` (id → `ServerHandle`). Durum: stopped→starting→running("]: Done (" satırı, `log::parse`)→stopping→stopped/crashed. stop = stdin `stop` → 30 sn → kill (oneshot) → `exit_rx` watch ile bekleme. Durum geçişleri `transition()` ile atomik. Rust tarafı son 1000 satırı tutar (`server_snapshot`).
- `java.rs` — M1: JAVA_HOME + PATH; `probe()` `java -version` parse. M3 genişletir.
- Hata tipi `AppError` frontend'e düz Türkçe string olarak serialize edilir.

## Gotchas
- Windows'ta alt süreçler `util::hide_console` ile (CREATE_NO_WINDOW).
- JVM argümanı `-Dstdout.encoding=UTF-8`: aksi halde konsol çıktısı Cp1254 gelir. Stdin'e BOM'suz UTF-8 yazılır; sunucu stdin'i UTF-8 okur (26.3 + Java 27'de doğrulandı).
- Log okuma `read_until` + `from_utf8_lossy` (geçersiz bayt okuyucuyu öldürmesin).
- Edition 2024: clippy collapsible-if → let-chains kullan.
