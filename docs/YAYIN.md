# Yayın ve otomatik güncelleme

Cubby kendini Tauri'nin güncelleyicisiyle günceller. Kurulu uygulama
`https://cubby.quacomes.com/api/update` adresine sorar (kod: `web/api/update.ts`). Bu uç, GitHub
Releases'tan kanala göre en yeni sürümü bulur ve imzasıyla birlikte verir. Paket imzalı olduğu için
yalnız bizim anahtarımızla imzalanmış güncellemeler kurulur.

## İmza anahtarı (bir kere)

Anahtar 2026-10-17'de üretildi:

| Dosya | Ne |
| --- | --- |
| `%USERPROFILE%\.cubby\updater.key` | Gizli anahtar (**repoya girmez**) |
| `%USERPROFILE%\.cubby\updater.key.password` | Parolası |
| `%USERPROFILE%\.cubby\updater.key.pub` | Açık anahtar; `src-tauri/tauri.conf.json` › `plugins.updater.pubkey` |

**İkisini de bir parola yöneticisine yedekle.** Gizli anahtar ya da parolası kaybolursa kurulu
Cubby'ler bir daha güncellenemez; herkesin yeni bir kurulumu elle indirmesi gerekir.

Yeni bilgisayarda yayın yapacaksan bu üç dosyayı aynı klasöre koy.

## Yeni sürüm

```bash
bun run release 0.2.0-beta.2 --beta
```

- `--beta` → GitHub'da **pre-release**; yalnız deneme kanalındakiler alır.
- Kararlı sürüm için `--beta` olmadan: `bun run release 0.2.0`.
- `--notes "- Şu düzeldi"` verilmezse "Neler yeni" metni önceki etiketten bu yana commit başlıklarından
  oluşur (`docs:`/`chore:` olanlar hariç).
- `--dry`: yalnız derler; commit, push ve yükleme yapmaz.

Komut sırasıyla:
1. Çalışma alanının temiz olduğuna, sürümün yeni olduğuna ve `main`'de olduğuna bakar.
2. Sürümü üç dosyaya yazar.
3. Derler ve imzalar. Microsoft girişi kapalıdır (plan A).
4. `chore: <sürüm> sürümü` commit'ini atar, `v<sürüm>` etiketini koyar ve push eder.
5. Kurulum dosyasını ve imzasını GitHub Releases'a yükler.

Uç 5 dakika önbelleklidir; kurulu uygulamalar açılıştan 20 sn sonra ve 6 saatte bir bakar.

## Kanallar

- **Kararlı:** pre-release olmayan en yeni sürüm.
- **Deneme:** en yenisi, pre-release'ler dahil. Ayarlar › Güncellemeler › "Deneme sürümlerini al".
  Bir deneme sürümü kurulu olan (ör. `0.2.0-beta.1`) kendiliğinden deneme kanalındadır.
- Deneme kanalındaki biri, kararlı `0.2.0` çıkınca ona geçer; sonra yine ayarına göre devam eder.

## İlk kurulum (ör. test eden biri)

1. GitHub Releases'tan `Cubby_<sürüm>_x64-setup.exe` indirilir ve kurulur. Yönetici izni gerekmez,
   kullanıcı başına kurulur.
2. Kod imzası olmadığı için Windows SmartScreen "Bilinmeyen yayıncı" diyebilir:
   **Ek bilgi › Yine de çalıştır**. Uygulamanın içinden inen güncellemelerde bu uyarı çıkmaz.
3. Sonraki sürümler kendiliğinden gelir.

## Kullanıcı ne görür

- Güncelleme arkada iner (Ayarlar'dan kapatılabilir).
- Hazır olunca başlık çubuğunda "Güncelleme hazır" hapı çıkar. Tıklayınca "Neler yeni", açık dünya
  uyarısı ve **Yeniden başlat** / Sonra seçenekleri gelir.
- Asla kendiliğinden yeniden başlamaz. "Sonra" denirse Cubby tamamen kapatılınca sessizce kurulur.
- Yeni sürümle ilk açılışta bir kez "Cubby x.y sürümüne güncellendi · Neler yeni" bildirimi çıkar.
- Geliştirme derlemesi (`bun run tauri dev`) hiç güncellenmez.
