# Ortak dünya — Aşama 0 ölçümleri

"Kim açıksa dünya açık" özelliğinin (plan: dünyanın sahibi seçtiği arkadaşlarla paylaşır, en güncel
hâli kimdeyse o açabilir) yapılabilir olup olmadığını ölçen deneme. Tarih: 2026-10-28.

**Örnek dünya:** Fabric 0.20.1 · Minecraft 26.3, modlu, 70 bölge dosyası. Aktarılacak kısım 126 dosya,
190 MB. Kütüphaneler ve sürümler her bilgisayarda yeniden kurulur, aktarılmaz.

Ölçüm testleri (`spike_shared.rs`) Aşama 2'de kaldırıldı; yerine motorun kendi canlı testi geldi:

```bash
cargo test --release shared::sync -- --ignored --nocapture
```

`CUBBY_SPIKE_WORLD=<sunucu klasörü>` verilirse o dünyayla çalışır.

## Sonuçlar

| Ölçüm | Sonuç |
|---|---|
| İlk kopya, doğrudan (aynı makinede iki iroh uç noktası, 4 akış) | 190 MB 1,3–2,4 sn; 78–150 MB/sn. İki evde bu hız internet hızıyla sınırlanır. |
| İlk kopya, yalnız aracı sunucu (n0'ın ücretsiz relay'i) | 190 MB **~199 sn, ~1 MB/sn** |
| Dosya özetleri (SHA-256, 126 dosya) | 0,2–1 sn |
| 25 dk'lık normal bir oturumda değişen | 27 dosya; tam dosya olarak **39,5 MB** (11 bölge dosyası, her biri 8–9 MB) |
| Aynı fark 4 KB'lık parçalar düzeyinde | **~6,9 MB**. Yaklaşık: önceki hâl olarak oturumun başında, sunucu açıkken alınan bir kopya kullanıldı. |
| Oyun sırasında anlık kopya: `save-off` → `save-all flush` → kopya → `save-on` | Kayıtsız pencere **0,29 sn**; "Can't keep up" yok |
| Anlık kopyanın tutarlılığı | 24.259 chunk açıldı, bozuk **0**; kopya ikinci bir sunucuda 11 sn'de sorunsuz açıldı. Bir JNA/OSHI performans sayacı uyarısı çıktı; Windows'a özgü, dünyayla ilgisiz. |
| Ed25519: iroh `SecretKey::sign` → WebCrypto `verify` | Node 26 ve bun 1.3'te doğrulanıyor, değiştirilmiş mesaj reddediliyor |

## Plana etkisi

- **Eşitleme parça bazlı olacak.** Değişen dosyalar 4 KB'lık bloklar halinde karşılaştırılır, yalnız değişen bloklar gider. Oturum sonu devri aracı sunucu üzerinden bile yaklaşık 7 sn; tam dosya gönderilseydi ~40 sn olurdu.
- **İlk kopya bir kez, arka planda iner, ilerlemesi gösterilir.** Aracı sunucuyla 200 MB'lık bir dünya birkaç dakika sürer; doğrudan bağlantıda çok daha hızlı. Oyuncu sayısı artınca kendi aracı sunucumuz bunu hızlandırır.
- **Oyun sırasında anlık kopya ucuz.** Kayıt yalnız 0,3 sn duruyor; planlanan 10 dakikada bir kopya alınabilir. Bu sayede "en güncel hâl kapalı bir bilgisayarda kaldı" durumu seyrekleşir.
- **Kimlik doğrulama ek parola istemiyor.** Web, üyelerin isteklerini iroh anahtarıyla doğrular.

Aşama 1 (web: grup, nesil, kira uçları) bu sonuçlarla değişmeden başlayabilir.

## Henüz ölçülmedi

- İki ayrı evde gerçek doğrudan bağlantı hızı (bir arkadaşla deneme).
- Daha büyük dünyalar (1 GB+): ilk kopya süresi doğrusal büyür.

## Aşama 2: motorun ilk sonuçları (2026-10-28, aynı makinede iki iroh uç noktası)

| Ölçüm | Sonuç |
|---|---|
| S2S ilk kopya (126 dosya, 190 MB) | 1,6 sn; özetlerle doğrulandı |
| İki bölge dosyasında 6 blok değişti | ağdan **24 KB** (tam 6 × 4 KB), 0,04 sn |
| İmzalı istekler üretimdeki davet sunucusunda | kira al, nesil yayınla, tekrar yayın reddi (`badGen`), bırak: geçti |

## Aşama 3: gerçek uygulamayla uçtan uca (2026-10-28, tek bilgisayar)

Karşı taraf bir **test arkadaşı** (`src-tauri/src/shared/tf.rs`, kendi iroh kimliği ve deposu); uygulama
`tauri dev` ile, tıklanarak. Küçük bir saf 26.3 test dünyası kullanıldı.

| Adım | Sonuç |
|---|---|
| Arkadaş davetle girer → sahibin "açabilir" listesinde görünür | ✓ (`seen`) |
| Dünya açıkken ortak yapılır → nesil 1 oyun sırasında kopyalanıp yayınlanır | ✓ (`save-off`/`save-all flush` uygulamanın içinden) |
| Arkadaş nesil 1'i uygulamadan çeker (grup denetimi) | ✓ 37 dosya, 7,2 MB |
| Sahip kapatır → nesil 2 yayınlanır, kira bırakılır | ✓ |
| Arkadaş açar (eksik parçaları çeker, kira, dakikada bir tazeler) → sahipte "Ayse_Test'de açık · Katıl" | ✓ |
| Sahibin Katıl'ı → bağlantı açık olana (arkadaşın sunucusuna) gider | ✓ |
| Arkadaş kirayı bırakmadan kaybolur → sahipte "Son hâli Ayse_Test'de", açılamaz | ✓ |
| Sahip "Bekleme, yine de aç" → elindeki en yeni kopya yeni nesil sayılır | ✓ (depo numarası da güncelleniyor: bu denemede bulunan hata düzeltildi) |
| Uygulama üye: kodla katılır → davet bandı → Kopyayı indir → Sen aç | ✓ |
| Sahibin davetiyle gelen biri uygulamadaki kopyaya bağlanır | ✓ (sunucu yanıt verdi) |
| Üye kapatır → nesil yayınlanır; uygulama çökünce/yeniden açılınca kalan ilerleme yayınlanır | ✓ |
| Sahip döner, üyenin son hâlini çeker | ✓ nesil 4 |
| Katılınan dünyayı kaldırmak kopyayı, dünyayı silmek ortak kaydı da siler | ✓ |

Bu denemede bulunan ve düzeltilenler: ekran ortak durumu yalnız bir kez okuyordu; durum satırı açma/kapamadan
sonra bir dakika geride kalıyordu; beklemeyi kaldırınca depo eski nesil numarasında kalıyordu; bekleme
satırı kesiliyordu; arkadaşın kopyası ve sahibin gizli katılım kaydı silinmeden kalıyordu.

Henüz iki ayrı bilgisayarla ve gerçek bir Minecraft istemcisiyle oynanarak denenmedi.
