# Web (cubby.quacomes.com, Vercel projesi cubby-join, web/)

- Sayfalar sunucuda üretilir (dış kaynak yok, stil satır içi): `lib/site.ts` (kök `/`, TR/EN, Accept-Language), `lib/html.ts` (davet sayfası, mesaj, 404). CSP `lib/http.ts` › `html(body, status, nonce?)`; betik yalnız davet sayfasında ve nonce'lu (`newNonce`).
- Site görselleri `web/public/site/*.webp`: gerçek uygulamadan ekran kontrolüyle çekildi (pencere tam çözünürlükte PowerShell CopyFromScreen + DWM çerçevesi). Davet kodu ve arkadaş adları Chrome'da uygulamanın yazı tipleriyle (node_modules/@fontsource-variable JetBrains Mono, Inter) yamayla K7M-2QX / Ali / Zeynep yapıldı. Gerçek davet kodu herkese açık yere konmaz. Kapak: kullanıcının bir dünya kapağı (kapak.webp).
- Davet 2.0: `InviteRecord` + `host`, `coverVersion`, `mods`. Uçlar: `PUT /api/invites/:code/meta` (api/invite-meta.ts; kapak 1200×630 JPEG base64 ≤350 KB → Redis `cover:<code>`), `PUT /api/invites/:code/status` (api/invite-status.ts; `status:<code>` açıkken 6 dk ömürlü, kapalıyken davetle aynı), `GET /api/cover?code&v`, `GET /download` (api/download.ts → son kurulum dosyası; `lib/release.ts` Redis'te 10 dk önbellek, kararlı sürüm yoksa deneme). Sahiplik `lib/owned.ts`. Saf doğrulama `lib/meta.ts`.
- Önizleme dağıtımları Vercel girişiyle korunuyor (SSO): uygulama ve testler oraya ulaşamaz; uçtan uca canlı test üretimde yapılır.

# Uygulama tarafı (src-tauri/src/invite_live.rs)
- `spawn_meta(app, id)`: ad (`player_name`: ayar ya da `detect_player_name` — Launcher `launcher_accounts*.json` etkin hesabın `minecraftProfile.name`, TLauncher, tek kişilik `usercache.json`), oyuncuda gereken mod sayısı, kapak (yalnız `ShortInvite.cover_sent` kapak sürümünden farklıysa, `covers::share_jpeg`). Tetikler: kısa kod oluşunca/tazelenince (join_cmds), kapak değişince (`covers::apply`), ad değişince (`update_settings` → `spawn_meta_all`).
- Canlı durum: `server://status` ve `server://players` dinlenir, 3 sn bekleme, açık dünyalar için 2 dk kalp atışı (`LiveStatus` managed). Oyuncu isimleri gönderilmez.
- `short_invite::web()`: testlerde `CUBBY_JOIN_WEB` ile adres değiştirilebilir.
