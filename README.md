# MC Sunucu Yöneticisi

Terminalle uğraşmadan Minecraft Java sunucusu kurup yöneten küçük bir masaüstü uygulaması.
Tauri 2 (Rust) + React + TypeScript + Vite. Ayrıntılı hedefler: [SPEC.md](SPEC.md).

## Durum

- [x] **M1** — Pixel UI temeli, Vanilla sunucu indirme (sha1 doğrulamalı), başlat/durdur, canlı konsol, CPU/RAM
- [x] **M2** — Loader mimarisi, Fabric + Paper (Fill v3), loader sürümü seçimi, yeniden adlandırma / RAM / silme (Geri Dönüşüm Kutusu), sunucu başına konum
- [x] **M3** — Java tespiti (PATH, JAVA_HOME, kayıt defteri, yaygın dizinler, Minecraft Launcher runtime'ları) + Adoptium'dan taşınabilir JRE, sunucu başına Java seçimi
- [x] **Konsol tarzı arayüz** — özel başlık çubuğu, sabit 1200×720 pencere, koyu tema, dünya kutucukları; her dünyanın arka planı o dünyada çekilen oyun içi ekran görüntüsü (F2), oyuncu listesi, LAN davet adresi
- [x] **M4** — Dünya ayarları (önemli alanlar + tüm `server.properties` tablosu), tek seferlik EULA, TLauncher (premium olmayan) modu, beyaz liste (kurulumda da), yetkililer, oyuncu atma, giremeyenlere tek tıkla izin, kapak = sunucu simgesi, MOTD = dünya adı
- [x] **M5** — İnternetten katılım: dünya başına "İnternete aç", modemde otomatik port açma (UPnP) ve CGNAT tespiti; modem izin vermiyorsa neden ve çözüm sade dille gösterilir
- [x] **M6** — NeoForge, Forge (1.17+) ve Quilt: resmi installer'lar Java ile çalıştırılır (hash doğrulamalı), sürüm listeleri ve önerilen sürümler, mod mağazası her altyapı için; "Modlar oyuncunun Minecraft'ına da" akışı NeoForge/Forge istemcisini de kurar
- [x] **M7a** — Katıl modu: davet linki/kodu (`mcsm://join?d=…`), uygulamalar arası doğrudan bağlantı (iroh; olmazsa aracı sunucu), onay penceresi, Minecraft sunucu listesine otomatik ekleme, sürüm uyarısı, arka planda (tray) çalışma
- [x] **M8** — Mod/eklenti mağazası (Modrinth): arama, kategoriler, sürüme uygun kurulum, bağımlılıklar kendiliğinden, güncelleme, kurulu modlar listesi (elle eklenenler hash ile tanınır)
- [x] **M7b** — Modlar oyuncunun Minecraft'ına da: modlu dünyalarda sunucuya kurulan, oyuncuda gereken/önerilen modlar kendi Minecraft'ına dünyaya özel Launcher profiliyle kendiliğinden kurulur (Ayarlar'dan kapatılabilir; TLauncher'da ortak `mods` klasörü). Katılırken eksik modlar kontrol edilir: zorunlular kurulur, önerilenler isteğe bağlı; Modrinth'ten ya da arkadaşın uygulamasından (hash doğrulamalı). Arkadaşın modları değiştirince "Güncelle"
- [x] **Başlat ve katıl** — Başlat'ın yanındaki menüden: sunucu açılınca Minecraft Launcher dünyanın profili seçili açılır, Oyna'ya basınca oyun doğrudan dünyaya bağlanır (Quick Play, 1.20+); arkadaşın tarafındaki "Oyna" da aynı
- [~] **M9** — Oyunu Launcher'sız açma: Microsoft girişi (PKCE, tarayıcıda; yenileme anahtarı Windows Kimlik Bilgisi Yöneticisi'nde), oyunun dosyaları `.minecraft`'la paylaşılarak hash doğrulamalı indirilir, oyun Quick Play ile doğrudan dünyada açılır (vanilla ve NeoForge 26.3'te canlı doğrulandı). Microsoft girişinin son adımı **Mojang onayı bekliyor**: [docs/MICROSOFT_GIRIS.md](docs/MICROSOFT_GIRIS.md). Onaya kadar ve girişsiz oyuncularda Launcher'lı akış çalışır

Bütün milestone'lar bitti; sırada isim, web katılım sayfası ve yayın hazırlığı var.

**Sonra:**
- Web katılım sayfası (uygulamanın adı belli olunca, yayın hazırlığıyla birlikte)

**Fikir aşamasında:**
- Dünya yedekleme: Google hesabı bağlayıp Google Drive'a otomatik yedek
- Premium hesapla kendi sunucumuzda (VDS) yedekleme

## Geliştirme

Gerekenler: [bun](https://bun.sh), Rust (stable), Windows'ta WebView2. Sunucuyu çalıştırmak için
Java gerekmez: uygun sürüm bulunamazsa uygulama Eclipse Temurin JRE'yi kendi klasörüne indirir.

```bash
bun install
bun run tauri dev
```

Arayüzü Tauri olmadan, sahte verilerle görmek için `bun run dev` çalıştırıp tarayıcıda
`http://localhost:1420` açılabilir (yalnız geliştirme modunda; `src/lib/mock.ts`).

Testler ve kontroller:

```bash
cd src-tauri && cargo test && cargo clippy --all-targets
bun run build
```

Canlı testler (Mojang, Fabric, Paper, NeoForge, Forge, Quilt, Adoptium JRE): `cargo test -- --ignored live_install`; bu makinedeki Java'ları listelemek için `cargo test -- --ignored live_scan --nocapture`

## Veri konumu

Varsayılan olarak sunucular uygulama veri dizininde tutulur:
`%APPDATA%\com.firatmio.mc-server-launcher\instances\<id>\{instance.json, server/}`.
Sihirbazda başka bir klasör seçilebilir; hangi sunucunun nerede olduğu `instances.json` kaydında durur.

Asset lisansları: [ASSETS.md](ASSETS.md).
