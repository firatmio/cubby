# Minecraft Sunucu Yöneticisi — Spec

Kardeşimle oynamak için, terminalle uğraşmadan Minecraft Java sunucusu kurup yöneten küçük bir masaüstü uygulaması. Minecraft hissi veren, sevimli bir UI.

## Stack
- **Tauri 2** (Rust backend) + **React + TypeScript + Vite** (frontend)
- Platform: önce Windows 11, Linux/macOS bozulmasın yeter
- State: Zustand, stil: Tailwind veya düz CSS modülleri (pixel-art UI için hangisi rahatsa)

## Temel kavram: "Instance"
Her sunucu bir instance. Birden fazla instance olabilir (ör. "Fabric 26.3 survival", "Paper test").
```
instance.json  -> { id, name, loader, mcVersion, loaderVersion, javaPath, ramMinMb, ramMaxMb, port, createdAt }
server/        -> sunucu dosyaları (jar, world, mods/plugins, server.properties)
```
Instance'lar app data dizininde tutulur, istenirse kullanıcı klasör seçebilir.

## Loader desteği (genişletilebilir mimari)
Rust tarafında bir `Loader` trait'i: `list_game_versions()`, `list_loader_versions(game)`, `install(instance)`, `launch_command(instance)`.

| Loader | Kaynak | Not |
|---|---|---|
| Vanilla | Mojang version manifest (piston-meta) | `downloads.server` jar'ı; `javaVersion.majorVersion` buradan okunur |
| Fabric | meta.fabricmc.net v2 | Hazır server launcher jar'ı direkt indirilebiliyor |
| Paper | PaperMC API (fill / v3 — güncel olanı doğrula) | Build listesi, en son stable build |
| NeoForge | maven.neoforged.net | Installer `--installServer` ile çalıştırılır |
| Forge | files.minecraftforge.net / maven | Installer `--installServer` ile çalıştırılır |
| Quilt | meta.quiltmc.org | Opsiyonel, Fabric'e benzer |

- Varsayılan seçim: **Fabric, 26.3**. Ama sürüm listesi dinamik, eskiler de seçilebilir (release / snapshot filtresi).
- Yeni sürüm çıktığında uygulamayı güncellemek gerekmesin: her şey API'den çekilir, hard-coded sürüm yok.
- Mod/plugin klasörünü açan buton (Fabric/Forge → `mods/`, Paper → `plugins/`). İleride Modrinth API ile mod arama/indirme eklenebilir (v2).

## Java yönetimi
- Seçilen MC sürümünün istediği Java major sürümünü manifest'ten oku.
- Sistemde uygun Java var mı tara (PATH, JAVA_HOME, yaygın kurulum dizinleri).
- Yoksa **Adoptium API**'den portable JRE indirip app data altına aç, instance'a bağla.

## Süreç yönetimi (Rust)
- `java -Xms.. -Xmx.. -jar ... nogui` sürecini spawn et, stdout/stderr'i satır satır Tauri event olarak frontend'e akıt.
- Konsoldan girilen komutu stdin'e yaz.
- Stop: önce `stop` komutu gönder, timeout sonrası kill.
- Durum: `stopped | starting | running | stopping | crashed`. "Done (x.xs)!" satırından running'e geç.
- Log'dan oyuncu giriş/çıkışını parse et → Oyuncular sekmesi.
- Uygulama kapanırken çalışan sunucuyu düzgün durdur.

## İlk kurulum otomasyonu
- `eula.txt` → kullanıcıya bir kere onaylat, sonra `eula=true` yaz.
- `server.properties` UI'dan düzenlenir. Önemli alanlar formda: `online-mode`, `server-port`, `max-players`, `difficulty`, `gamemode`, `motd`, `white-list`, `pvp`, `view-distance`. Geri kalanı "gelişmiş" tablosunda.
- **TLauncher desteği:** "Premium olmayan oyuncular da girebilsin" toggle'ı → `online-mode=false`. Açıkken uyarı göster ve whitelist'i otomatik aç.

## İnternet üzerinden katılım
Bağlantı sekmesinde iki adres yan yana, tek tıkla kopyalama:
1. **LAN:** yerel IPv4 + port
2. **İnternet:**
   - **playit.gg (birincil):** Agent binary'sini indir, arka planda child process olarak çalıştır, claim/link akışını UI'dan yönet, oluşan public adresi göster. Port açma gerektirmez, CGNAT'ta çalışır.
   - **UPnP (yedek):** `igd` crate'i ile port açmayı dene, başarılıysa public IP:port göster. CGNAT tespiti için dış IP ile modem WAN IP'sini karşılaştır, uyuşmuyorsa "UPnP çalışmaz, playit kullan" de.
- Güvenlik: offline-mode + internet açıkken whitelist zorunlu olsun. (Offline modda whitelist isim bazlı, yani adresi bilen biri nick taklit edebilir — bunu UI'da kısa bir notla belirt.)

## UI
- Minecraft menü hissi: dirt/stone arka plan dokusu, gri bevel'li butonlar, slot benzeri paneller, pixel font.
- Assetler: topluluk/açık lisanslı kaynaklar veya kendi çizimlerimiz. Font için **Monocraft** (OFL) gibi açık lisanslı bir seçenek. Mojang'ın orijinal dosyalarını repoya koyma; kullanılan her assetin lisansını `ASSETS.md`'ye yaz.
- `image-rendering: pixelated`, tüm boyutlar 2/4'ün katı.
- Ekranlar:
  - **Ana sayfa:** instance listesi (kart), "Yeni sunucu" butonu
  - **Yeni sunucu sihirbazı:** loader → MC sürümü → loader sürümü → RAM → isim → kur (progress bar)
  - **Instance detayı (sekmeler):** Konsol · Oyuncular · Ayarlar · Bağlantı · Dosyalar (klasörü aç)
- Büyük yeşil Başlat / kırmızı Durdur butonu, durum göstergesi, RAM/CPU kullanımı (sysinfo crate).

## Milestones
1. **M1:** Tauri iskeleti, pixel UI temeli, tek instance, Vanilla indir + başlat/durdur + canlı konsol
2. **M2:** Loader trait + Fabric, Paper; sürüm seçici; instance yönetimi
3. **M3:** Java tespiti + Adoptium'dan otomatik indirme
4. **M4:** server.properties editörü, EULA, TLauncher toggle, whitelist, oyuncu listesi
5. **M5:** Bağlantı sekmesi: LAN IP, playit.gg entegrasyonu, UPnP yedek
6. **M6:** NeoForge/Forge (installer akışı), Quilt
7. **Sonra:** Modrinth mod arama, dünya yedekleme, otomatik restart

## Kurallar
- API endpoint'lerini kodlamadan önce güncel dokümantasyondan doğrula (özellikle Paper ve playit, değişmiş olabilirler).
- Ağ/indirme işlemleri Rust tarafında; frontend sadece invoke + event dinler.
- İndirilen jar'ların hash'i varsa (Mojang sha1, Paper sha256) doğrula.
- Her milestone sonunda çalışır halde olsun.
