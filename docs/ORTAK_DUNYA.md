# Ortak dünya — Aşama 0 ölçümleri

"Kim açıksa dünya açık" özelliğinin (plan: dünyanın sahibi seçtiği arkadaşlarla paylaşır, en güncel
hâli kimdeyse o açabilir) yapılabilir olup olmadığını ölçen deneme. Tarih: 2026-10-28.

**Örnek dünya:** Fabric 0.20.1 · Minecraft 26.3, modlu, 70 bölge dosyası. Aktarılacak kısım 126 dosya,
190 MB. Kütüphaneler ve sürümler her bilgisayarda yeniden kurulur, aktarılmaz.

Testler `src-tauri/src/spike_shared.rs` içinde, ürüne girmez:

```bash
cargo test --release spike_ -- --ignored --nocapture
```

`CUBBY_SPIKE_WORLD=<sunucu klasörü>` ile çalışır.

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
