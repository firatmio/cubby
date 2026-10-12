# Microsoft girişi: Azure kaydı ve Mojang onayı

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

> **Başvuru eski adla ("MC Server Client") yapıldıysa yeniden başvurma:** onay ada değil uygulama
> kimliğine verilir. Azure'da adı *Markalama ve özellikler*'den `Cubby` yap (kimlik değişmez; oyuncunun
> Microsoft giriş ekranında görünen ad da budur). Mojang yazarsa adın değiştiğini, kimliğin aynı kaldığını
> söyle; reddederlerse Cubby adıyla, aynı kimlikle yeniden başvur.

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
