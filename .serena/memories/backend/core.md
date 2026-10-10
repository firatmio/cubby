# backend/core (src-tauri/src)

- `lib.rs` — Builder; `tauri-plugin-single-instance` İLK plugin olmalı (M7 deep-link buna dayanır). `setup` içinde `Registry` manage edilir. Kapanış: `CloseRequested`/`ExitRequested` → aktif sunucu varsa engelle, `app://shutting-down` emit, `ServerManager::stop_all`, sonra `app.exit(0)`; `SHUTTING_DOWN` atomik döngüyü önler.
- `commands.rs` — tüm `#[tauri::command]`'lar + `AppState { loaders, servers }`. `create_instance` hata olursa klasörü siler; `instance.json` + kayıt ancak kurulum bitince yazılır. `delete_instance` → `trash::delete` (Geri Dönüşüm Kutusu), çalışan sunucuda hata.
- `registry.rs` — id→klasör kaydı `app_data/instances.json`. Varsayılan `app_data/instances/<id>`, özel konum `<seçilen>/<isim-slug>[-n]`. `load()` varsayılan kökte kayıtsız klasörleri göç ettirir. Bulunamayan klasörler listede sessizce atlanır.
- `paths.rs` — `instance_dir` kayıttan çözer; id yalnız `[A-Za-z0-9-]`.
- `loaders/` — `Loader` trait (native async fn, dyn yok) + `Loaders` (`dispatch!` makrosu ile `LoaderKind` → impl). `mojang.rs` ortak manifest/sha1'li server jar. Yeni loader eklemek: impl + `LoaderKind` varyantı + `Loaders` alanı + makro kolu + frontend `LoaderKind`/etiketler.
  - Fabric: meta v2; launcher jar'ında hash yok → `ensure_jar` (PK başlığı). Vanilla jar'ı `.fabric/server/<mc>-server.jar`'a konur (launcher 1.1.x önbellek yolu; kökteki `server.jar` KULLANILMAZ). İlk açılışta kütüphaneleri kendisi indirir.
  - Paper: Fill v3 (`fill.papermc.io/v3`; eski v2 410). Build öneri: STABLE ?? BETA, ALPHA asla. sha256 doğrulama. Başlatma `--nogui`. Java minimumu Fill'den, yoksa Mojang.
- `server/` — `ServerManager` (id → `ServerHandle`). Durum: stopped→starting→running("]: Done (" satırı; vanilla/Fabric/Paper aynı)→stopping→stopped/crashed. stop = stdin `stop` → 30 sn → kill. Durum geçişleri `transition()` ile atomik. Son 1000 satır `server_snapshot` ile.
- `java/` — `JavaManager` (managed state, `app_data/java`): `scan.rs` (JAVA_HOME, PATH, kayıt defteri, vendor dizinleri, Minecraft Launcher runtime'ları, kendi indirdiklerimiz), `pick()` = tam major, yoksa gerekenden büyüklerin en küçüğü. `adoptium.rs` Temurin JRE: önce ≥gereken en küçük LTS (16→17; 16 JRE'si yok), sha256, zip/tar.gz açma (zip-slip korumalı). `create_instance` uygun Java yoksa indirir ve `java_path`'e bağlar (hata olursa kurulumu bozmaz). Başlatmada UI `instance_java` ile kontrol edip indirme modalı açar. Event: `java://progress`.
- Hata tipi `AppError` frontend'e düz Türkçe string olarak serialize edilir.

## Gotchas
- Windows'ta alt süreçler `util::hide_console` ile (CREATE_NO_WINDOW).
- JVM argümanı `-Dstdout.encoding=UTF-8` şart (yoksa Cp1254). Stdin'e BOM'suz UTF-8 yazılır; sunucu stdin'i UTF-8 okur.
- PowerShell ile sunucu test ederken `StandardInput` ilk yazımda BOM ekler → ilk komut "Unknown command" olur; önce boş satır gönder.
- Log okuma `read_until` + `from_utf8_lossy`.
- Edition 2024: clippy collapsible-if → let-chains.
