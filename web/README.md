# Cubby davet sunucusu (`web/`)

Kısa davet kodları (`K7M-2QX`) ve tıklanabilir davet sayfası: <https://cubby.quacomes.com>.
Vercel Functions (çatısız, TypeScript) + Upstash Redis. Uygulama adresi `src-tauri/src/consts.rs` → `JOIN_WEB`.

## Uçlar

| Yöntem | Yol | Ne yapar |
| --- | --- | --- |
| `POST` | `/api/invites` `{invite}` | Uzun davet için kısa kod: `{code, owner, url}` (IP başına 20/saat) |
| `GET` | `/api/invites/:code` | `{invite}` ya da 404 (IP başına 30/dk, 300/gün; sayfayla ortak) |
| `PUT` | `/api/invites/:code` `{owner, invite}` | İçeriği ve 60 günlük süreyi tazeler |
| `DELETE` | `/api/invites/:code` `{owner}` | "Daveti yenile"de eski kodu siler |
| `GET` | `/:code` | Davet sayfası (OG etiketli, Türkçe/İngilizce) |
| `GET` | `/` | Ana sayfa |

`owner` yalnız host'ta durur; sunucuda SHA-256'sı tutulur. Kodlar 31 karakterli alfabeden
(0/O, 1/I/L yok) 6 karakter. Kayıt 60 gün dokunulmazsa silinir; uygulama dünya açılınca ve davet
paneli açılınca tazeler.

## Geliştirme

```bash
cd web
bun install
bun test
bunx tsc --noEmit
```

## Yayın

Proje `cubby-join` (Vercel, kök `web`), bölge `fra1`. Redis: Vercel Marketplace › Upstash for Redis
(ücretsiz plan); `KV_REST_API_URL` / `KV_REST_API_TOKEN` kendiliğinden gelir.

```bash
cd web
vercel deploy --prod
```

Alan adı `cubby.quacomes.com` Cloudflare'de **DNS only** (gri bulut) olmalı: proxy açıkken Vercel
istemci IP'si yerine Cloudflare'in IP'sini görür ve IP başına sınırlar herkesi aynı kovaya atar.
