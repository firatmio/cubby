# backend/core (src-tauri/src)

- `lib.rs` — Builder; `tauri-plugin-single-instance` İLK plugin olmalı (M7 deep-link buna dayanır). `setup` içinde `Registry` manage edilir. Kapanış: `CloseRequested`/`ExitRequested` → aktif sunucu varsa engelle, `app://shutting-down` emit, `ServerManager::stop_all`, sonra `app.exit(0)`; `SHUTTING_DOWN` atomik döngüyü önler.
- `commands.rs` — tüm `#[tauri::command]`'lar + `AppState { loaders, servers }`. `create_instance` hata olursa klasörü siler; `instance.json` + kayıt ancak kurulum bitince yazılır. `delete_instance` → `trash::delete` (Geri Dönüşüm Kutusu), çalışan sunucuda hata.
- `registry.rs` — id→klasör kaydı `app_data/instances.json`. Varsayılan `app_data/instances/<id>`, özel konum `<seçilen>/<isim-slug>[-n]`. `load()` varsayılan kökte kayıtsız klasörleri göç ettirir. Bulunamayan klasörler listede sessizce atlanır.
- `paths.rs` — `instance_dir` kayıttan çözer; id yalnız `[A-Za-z0-9-]`.
- `loaders/` — `Loader` trait (native async fn, dyn yok) + `Loaders` (`dispatch!` makrosu ile `LoaderKind` → impl). `mojang.rs` ortak manifest/sha1'li server jar. Yeni loader eklemek: impl + `LoaderKind` varyantı + `Loaders` alanı + makro kolu + frontend `LoaderKind`/etiketler.
  - Fabric: meta v2; launcher jar'ında hash yok → `ensure_jar` (PK başlığı). Vanilla jar'ı `.fabric/server/<mc>-server.jar`'a konur (launcher 1.1.x önbellek yolu; kökteki `server.jar` KULLANILMAZ). İlk açılışta kütüphaneleri kendisi indirir.
  - Paper: Fill v3 (`fill.papermc.io/v3`; eski v2 410). Build öneri: STABLE ?? BETA, ALPHA asla. sha256 doğrulama. Başlatma `--nogui`. Java minimumu Fill'den, yoksa Mojang.
  - M6 — `LoaderKind::{NeoForge("neoforge"), Forge, Quilt}`; `is_modded()`, `uses_installer()`, `label()`. `InstallRequest.java` (installer'lı türlerde `create_instance` Java'yı ÖNCE hazırlar), `InstallStage::Installer{line}` → `install://progress` `stage:"installer", line`. `launch_args(mc, loader_version)` dünyaya bağlı.
  - `installer.rs` — `download_maven` (yanındaki `.sha256`/`.sha1`), `run` (java -jar, gizli konsol, satırlar 150 ms'de bir, 20 dk zaman aşımı, hata = son 12 satır), `read_json`/`version_id`/`server_jar_path` (installer içindeki `install_profile.json` `serverJarPath` → resmi jar önceden sha1'li konur), `install_forge_like`, `cleanup`.
  - NeoForge: `maven.neoforged.net/api/maven/versions/releases/...`; `mc_for`: `21.1.x`→`1.21.1`, `26.3.0.76`→`26.3`, `+snapshot-N`. Başlatma `@libraries/net/neoforged/neoforge/<v>/win_args.txt nogui`.
  - Forge: `maven-metadata.xml` + `promotions_slim.json` (önbellekli); yalnız MC 1.17+ / 26+. `@libraries/net/minecraftforge/forge/<mc>-<v>/win_args.txt nogui`. Sürüm kaydı yalnız forge kısmı (`66.0.10`).
  - Quilt: meta v3; installer `install server <mc> <lv> --install-dir=`; meta'daki installer hash'leri ESKİ (0.15.1'de tutmadı) → Maven `.sha256`. `server.jar`'ı biz koyarız; `-jar quilt-server-launch.jar nogui`.
  - `cmp_versions` (sayısal + ön sürüm), `intersect_manifest` (Mojang sırası).
  - 26.3'te üçü de canlı kuruldu ve `Done` görüldü (Forge/NeoForge logu `[..] [Server thread/INFO] [logger/]: Done` → `"]: "` ayrıştırması tutuyor).
- `server/` — `ServerManager` (id → `ServerHandle`). Durum: stopped→starting→running("]: Done (" satırı; vanilla/Fabric/Paper aynı)→stopping→stopped/crashed. stop = stdin `stop` → 30 sn → kill. Durum geçişleri `transition()` ile atomik. Son 1000 satır `server_snapshot` ile.
- `java/` — `JavaManager` (managed state, `app_data/java`): `scan.rs` (JAVA_HOME, PATH, kayıt defteri, vendor dizinleri, Minecraft Launcher runtime'ları, kendi indirdiklerimiz), `pick()` = tam major, yoksa gerekenden büyüklerin en küçüğü. `adoptium.rs` Temurin JRE: önce ≥gereken en küçük LTS (16→17; 16 JRE'si yok), sha256, zip/tar.gz açma (zip-slip korumalı). `create_instance` uygun Java yoksa indirir ve `java_path`'e bağlar (hata olursa kurulumu bozmaz). Başlatmada UI `instance_java` ile kontrol edip indirme modalı açar. Event: `java://progress`.
- Hata tipi `AppError` frontend'e düz Türkçe string olarak serialize edilir.

## Gotchas
- Windows'ta alt süreçler `util::hide_console` ile (CREATE_NO_WINDOW).
- JVM argümanı `-Dstdout.encoding=UTF-8` şart (yoksa Cp1254). Stdin'e BOM'suz UTF-8 yazılır; sunucu stdin'i UTF-8 okur.
- PowerShell ile sunucu test ederken `StandardInput` ilk yazımda BOM ekler → ilk komut "Unknown command" olur; önce boş satır gönder.
- Log okuma `read_until` + `from_utf8_lossy`.
- Edition 2024: clippy collapsible-if → let-chains.
