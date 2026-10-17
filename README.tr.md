# Cubby

[English](README.md) · **Türkçe**

Arkadaşlarınla kendi Minecraft dünyan: terminalle uğraşmadan Java sunucusu kurar, yönetir, arkadaşlarını davet eder ve oyunu doğrudan dünyada açar.
Tauri 2 (Rust) + React + TypeScript + Vite. Ayrıntılı hedefler: [SPEC.md](SPEC.md).

## Durum

- [x] **M1** — Pixel UI temeli, Vanilla sunucu indirme (sha1 doğrulamalı), başlat/durdur, canlı konsol, CPU/RAM
- [x] **M2** — Loader mimarisi, Fabric + Paper (Fill v3), loader sürümü seçimi, yeniden adlandırma / RAM / silme (Geri Dönüşüm Kutusu), sunucu başına konum
- [x] **M3** — Java tespiti (PATH, JAVA_HOME, kayıt defteri, yaygın dizinler, Minecraft Launcher runtime'ları) + Adoptium'dan taşınabilir JRE, sunucu başına Java seçimi
- [x] **Konsol tarzı arayüz** — özel başlık çubuğu, sabit 1200×720 pencere, koyu tema, dünya kutucukları; her dünyanın arka planı o dünyada çekilen oyun içi ekran görüntüsü (F2), oyuncu listesi, LAN davet adresi
- [x] **M4** — Dünya ayarları (önemli alanlar + tüm `server.properties` tablosu), tek seferlik EULA, TLauncher (premium olmayan) modu, beyaz liste (kurulumda da), yetkililer, oyuncu atma, giremeyenlere tek tıkla izin, kapak = sunucu simgesi, MOTD = dünya adı
- [x] **M5** — İnternetten katılım: dünya başına "İnternete aç", modemde otomatik port açma (UPnP) ve CGNAT tespiti; modem izin vermiyorsa neden ve çözüm sade dille gösterilir
- [x] **M6** — NeoForge, Forge (1.17+) ve Quilt: resmi installer'lar Java ile çalıştırılır (hash doğrulamalı), sürüm listeleri ve önerilen sürümler, mod mağazası her altyapı için; "Modlar oyuncunun Minecraft'ına da" akışı NeoForge/Forge istemcisini de kurar
- [x] **M7a** — Katıl modu: davet linki/kodu (`cubby://join?d=…`), uygulamalar arası doğrudan bağlantı (iroh; olmazsa aracı sunucu), onay penceresi, Minecraft sunucu listesine otomatik ekleme, sürüm uyarısı, arka planda (tray) çalışma
- [x] **M8** — Mod/eklenti mağazası (Modrinth): arama, kategoriler, sürüme uygun kurulum, bağımlılıklar kendiliğinden, güncelleme, kurulu modlar listesi (elle eklenenler hash ile tanınır)
- [x] **M7b** — Modlar oyuncunun Minecraft'ına da: modlu dünyalarda sunucuya kurulan, oyuncuda gereken/önerilen modlar kendi Minecraft'ına dünyaya özel Launcher profiliyle kendiliğinden kurulur (Ayarlar'dan kapatılabilir; TLauncher'da ortak `mods` klasörü). Katılırken eksik modlar kontrol edilir: zorunlular kurulur, önerilenler isteğe bağlı; Modrinth'ten ya da arkadaşın uygulamasından (hash doğrulamalı). Arkadaşın modları değiştirince "Güncelle"
- [x] **Başlat ve katıl** — Başlat'ın yanındaki menüden: sunucu açılınca Minecraft Launcher dünyanın profili seçili açılır, Oyna'ya basınca oyun doğrudan dünyaya bağlanır (Quick Play, 1.20+); arkadaşın tarafındaki "Oyna" da aynı
- [~] **M9** — Oyunu Launcher'sız açma: Microsoft girişi (PKCE, tarayıcıda; yenileme anahtarı Windows Kimlik Bilgisi Yöneticisi'nde), oyunun dosyaları `.minecraft`'la paylaşılarak hash doğrulamalı indirilir, oyun Quick Play ile doğrudan dünyada açılır (vanilla ve NeoForge 26.3'te canlı doğrulandı). **Beklemede:** Mojang uygulama kimliğini onaylamadı (2026-10); Cubby şu an premium olmayan (TLauncher) oyuncuları da destekliyor ve onay listesi bunu kabul etmiyor. Yayın derlemeleri uygulama kimliği olmadan çıkar: Microsoft kartı görünmez, Launcher'lı akış çalışır. Ayrıntılar ve geri dönüş yolu: [docs/MICROSOFT_GIRIS.md](docs/MICROSOFT_GIRIS.md)

- [x] **İngilizce** — arayüz ve hata mesajları Türkçe ve İngilizce; ilk açılışta bilgisayarın diline göre, Ayarlar > Dil'den değiştirilebilir
- [x] **M10** — Oyna / Keşfet sayfaları: başlık çubuğunun ortasında goo (slime) geçişli haplar, sayfalar esneyerek kayar. Animasyon seviyesi (Tam / Sade / Kapalı) kendiliğinden belirlenir (Windows animasyon ayarı, yazılımla çizim, düşen kareler) ve Ayarlar'dan değiştirilebilir
  - [x] **M10a** — sayfalar, animasyon seviyesi, büyütülebilir/yeniden boyutlanabilir pencere (en küçük 1200×720), kendi zemini olan ve modlarla Keşfet: dünya seçici, öne çıkan bandı ve kategori raflarıyla vitrin, galerili ve açıklaması gerçek Markdown olarak görünen yan önizleme (Modrinth görselleri küçültülüp diskte önbelleklenir), önden yükleme ve bellek önbelleği sayesinde listeler anında gelir
  - [x] **M10b** — kaynak paketleri (kendi Minecraft'ına kurulur ve açılır; istenirse sunucu üzerinden arkadaşlara zorunlu), shader'lar (Iris/Sodium — Forge'da Oculus/Embeddium — kendiliğinden kurulur ve dünyaya göre eşitlenir, shader açılır), veri paketleri (dünyaya kurulur, sunucu açıksa `reload` gider); arkadaşının dünyasında yalnız değiştirebileceğin sekmeler görünür
  - [x] **M10c** — mod paketleri → yeni dünya: Keşfet'te her dünyada (dünya yokken de) Mod paketleri sekmesi; önizlemede paketin Minecraft/altyapı sürümü, mod sayıları ve boyutu, sürüm seçimi; "Yeni dünya olarak kur" sihirbazı ad ve erişim adımlarıyla açar. Paket (`.mrpack`) okunur, altyapı paketten kurulur, dosyalar hash doğrulamalı ve yalnız izinli adreslerden iner; sunucu modları ve ayarları sunucuya, yalnız oyuncuda çalışan modlar ve ayarlar senin Minecraft'ına, arkadaşlara "önerilen" olarak gider; kapak paketin görseli olur
- [x] **Web katılım sayfası** — davet 6 karakterlik kodla (`K7M-2QX`, karışan karakterler yok) ya da linkiyle paylaşılır: `cubby.quacomes.com/join/K7M2QX` (ya da `/join?code=`); sohbette önizleme, "Cubby'de aç" ve "Cubby'yi indir". Katıl'da kendiliğinden geçen iki üçlü kutu var; link yapıştırılırsa kod ayıklanır. Kendi küçük sunucumuz ([web/](web/), Vercel + Redis) yalnız daveti tutar; kod davet yenilenene kadar geçerli, 60 gün kullanılmazsa silinir. Sitenin kökü ileride gelecek tanıtım sitesine ayrıldı; bilinmeyen adresler 404 sayfası gösterir. Ayrıntılar: [docs/DAVET_SUNUCUSU.md](docs/DAVET_SUNUCUSU.md)

Sırada yayın hazırlığı var.

**Sonra:**
- Yayın hazırlığı (kurulum dosyası, GitHub Releases)
- Oyuncu sayısı artınca kendi aracı sunucumuz (bir VDS'te iroh-relay)

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
`%APPDATA%\com.quacomes.cubby\instances\<id>\{instance.json, server/}`. (Eski `com.firatmio.mc-server-launcher` klasörü ilk açılışta buraya taşınır.)
Sihirbazda başka bir klasör seçilebilir; hangi sunucunun nerede olduğu `instances.json` kaydında durur.

Asset lisansları: [ASSETS.md](ASSETS.md).
