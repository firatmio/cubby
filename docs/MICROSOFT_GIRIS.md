# Microsoft girişi: Azure kaydı ve Mojang onayı

> **Durum (2026-10-13): beklemede.** Mojang ilk başvuruyu ("AppID Review Complete", 2026-10-12)
> reddetti; sebep yazmıyor. Büyük ihtimalle: Cubby premium olmayan oyuncuları destekliyor
> ("Premium olmayanlar da girebilsin", `online-mode=false`; TLauncher profilleri) ve repo bunu açıkça
> anlatıyor. Mojang'ın onay listesi buna izin veren uygulamaları kabul etmiyor. Ayrıca başvuru metninde
> "offline/cracked play yok" yazıyordu; repo ile çelişti.
>
> **Karar (plan A):** ilk kullanıcılar çoğunlukla TLauncher kullanıyor; premium olmayan desteği kalıyor,
> Microsoft girişi şimdilik kapalı. Yayın derlemeleri `MCSM_MS_CLIENT_ID` olmadan çıkar: Ayarlar'daki
> Microsoft kartı görünmez, "Başlat ve katıl" resmi Launcher'la (profil seçili, Quick Play) çalışır.
> M9 kodu yerinde durur.
>
> **Plan B'ye geçiş** (kitlede hatırı sayılır premium oyuncu olursa):
> 1. Premium olmayan ayarını ve TLauncher desteğini kaldır (sunucu hep `online-mode=true`; README/SPEC'ten de).
>    Öncesinde duyur; mümkünse Bedrock desteğiyle (Geyser) yumuşat.
> 2. Azure'da **yeni** bir uygulama kaydı aç (eski kimlik ret kaydıyla ilişkili olabilir); aşağıdaki adımlar aynı.
> 3. Başvuruda dürüst ol: "önceki sürümler premium olmayan sunucuları destekliyordu, X sürümünde kaldırıldı;
>    artık yalnız oyunu satın almış hesaplar". Uygulamayı kaldırıp onaydan sonra geri eklemek ya da aynı
>    özelliği bir "fork" üzerinden sürdürmek kimliğin engellenmesine yol açar; yapılmayacak.

Uygulamanın oyunu Launcher'a uğramadan açabilmesi için oyuncunun Microsoft hesabıyla giriş yapması
gerekiyor. Bunun için uygulamanın kendi **Azure uygulama kimliği** (client ID) ve bu kimliğin Minecraft
servislerini kullanabilmesi için **Mojang onayı** gerekir. İkisini de proje sahibi yapar; kod hazır,
yalnız kimlik bekliyor.

> Onay gelene kadar giriş zincirinin ilk üç adımı (Microsoft → Xbox Live → XSTS) çalışır, son adım
> (`login_with_xbox`) 403 "Invalid app registration" döner. Uygulama bunu "Mojang onayı bekleniyor"
> olarak gösterir ve Launcher'lı akışla çalışmaya devam eder.

## 1. Azure'da uygulama kaydı

1. [Microsoft Entra yönetim merkezi](https://entra.microsoft.com) → **Uygulamalar → Uygulama kayıtları →
   Yeni kayıt**. (Kişisel hesapta Entra kiracısı yoksa önce ücretsiz bir Azure hesabı açman istenebilir.)
2. **Ad:** `Cubby`.
3. **Desteklenen hesap türleri:** *Yalnızca kişisel Microsoft hesapları*.
   Minecraft yalnız kişisel hesaplarla çalışır.
4. **Yeniden yönlendirme URI'si:** platform *Genel istemci/yerel (mobil ve masaüstü)*, değer
   `http://localhost`. (Port yazma; uygulama her girişte rastgele bir port kullanır, Microsoft
   `localhost` için portu yok sayar.)
5. **Kaydet.** Açılan sayfadaki **Uygulama (istemci) kimliği**'ni kopyala. Gizli değildir; uygulamanın
   içine gömülür. İstemci gizli anahtarı (*client secret*) **oluşturma**, gerekmiyor.
6. **Kimlik doğrulama** sekmesi → *Genel istemci akışlarına izin ver*: **Evet**.
7. API izinleri ekleme: `XboxLive.signin` kapsamı giriş sırasında istenir, burada bir şey seçilmez.

## 2. Mojang onayı

Form: [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid). (Bağlantı açılmazsa Minecraft destek
sayfasından "Minecraft API access for third-party launchers" diye ara; süreç zaman zaman değişiyor.)

Formda istenenler ve önerilen cevaplar:

- **Application (client) ID:** 1. adımda kopyaladığın kimlik.
- **Tenant:** `consumers` (kişisel hesaplar).
- **Uygulama adı / web sitesi:** `Cubby` ve GitHub sayfası
  (`https://github.com/firatmio/mc-server-manager`).
- **Ne yapıyor (İngilizce önerilen metin):**

  > A free, open-source desktop app (Tauri) that sets up and runs Minecraft: Java Edition servers for
  > friends without using a terminal. Players sign in with their Microsoft account so the app can launch
  > the official Minecraft: Java Edition client directly into their own or a friend's server (Quick Play).
  > Only accounts that own the game can play; we verify ownership via the entitlements endpoint. Tokens are
  > stored in the OS credential store and never leave the user's computer. The app does not modify the game
  > client, does not offer offline/cracked play, and follows the Minecraft Usage Guidelines.

- **İletişim e-postası:** seninki.

Cevap e-postayla geliyor; geliştirici raporlarına göre yaklaşık bir hafta sürüyor, garanti değil.

## 3. Geliştirmede kimliği vermek

Kimlik derleme anında okunur:

```bash
MCSM_MS_CLIENT_ID=<kimlik> bun run tauri dev
```

PowerShell'de:

```powershell
$env:MCSM_MS_CLIENT_ID = "<kimlik>"; bun run tauri dev
```

Kimlik verilmezse Ayarlar'da "Microsoft hesabı" kartı görünmez, her şey Launcher'lı akışla çalışır.
Yayın derlemesinde aynı değişken CI'da verilir.
