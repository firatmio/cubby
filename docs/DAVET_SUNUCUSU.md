# Davet sunucusu ve kısa kodlar

Cubby'nin bağlantısı uygulamadan uygulamaya kurulur (iroh: önce doğrudan, olmazsa aracı sunucu);
bunun için bir hesap ya da port açmak gerekmez. Davet sunucusu yalnız **daveti bulmaya** yarar:
uzun davet kodunu kısa bir koda (`K7M-2QX`) ve tıklanabilir bir web linkine
(`https://cubby.quacomes.com/join/K7M2QX`, `/join?code=K7M2QX` da olur) çevirir. Paylaşılan tek
şey bu kod ya da linki. Oyun trafiği bu sunucudan geçmez. Sitenin kökü (`/`) ileride gelecek
tanıtım sitesine ayrıldı; bilinmeyen adresler 404 sayfası gösterir.

## Sunucuda ne tutulur

- Uzun davet kodu: dünyanın adı, Minecraft/altyapı sürümü, host uygulamanın iroh kimliği,
  dünyanın kimliği ve davet anahtarı (uygulamanın zaten paylaştığı davetin aynısı).
- Sahiplik anahtarının SHA-256 özeti (anahtarın kendisi yalnız host'ta, `instance.json`'da).
- Oluşturulma zamanı.

Oyuncu adı, IP adresi ya da dünya dosyası tutulmaz. Hız sınırları için IP adresi Upstash'te
kısa süreli sayaç anahtarı olarak kullanılır (en uzunu 1 gün).

## Ne kadar kalır

- Kod "Daveti yenile"ye basılana kadar geçerli; yenilenince eski kod sunucudan silinir.
- Kod 60 gün dokunulmazsa kendiliğinden silinir. Uygulama dünya açılınca ve davet paneli açılınca
  süreyi tazeler; silinmişse yeni kod alır ve paneli günceller.

## Güvenlik

- Kod 31 karakterli alfabeden 6 karakter (~887 milyon olasılık). Kod bakışı IP başına
  dakikada 30, günde 300 ile sınırlı; tahminle bir davet bulmak pratikte mümkün değil.
- Davet sayfası uzun anahtarı göstermez; "Cubby'de aç" `cubby://join?c=KOD` açar, uygulama kodu
  sunucudan çözer.
- Davet ele geçse bile beyaz liste (premium olmayanlar açıkken zorunlu) dünyaya kimin
  girebileceğini belirler; "Daveti yenile" eski kodu ve linki geçersiz kılar.

## Sunucuya ulaşılamazsa

Panelde "Davet kodu alınamadı" ve "Tekrar dene" görünür. Eski uzun linkler (`cubby://join?d=…`)
açılınca hâlâ çalışır ama artık paylaşılmaz.
Kod: [web/](../web/) (Vercel + Upstash Redis). Adres: `src-tauri/src/consts.rs` → `JOIN_WEB`.
