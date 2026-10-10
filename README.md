# MC Sunucu Yöneticisi

Terminalle uğraşmadan Minecraft Java sunucusu kurup yöneten küçük bir masaüstü uygulaması.
Tauri 2 (Rust) + React + TypeScript + Vite. Ayrıntılı hedefler: [SPEC.md](SPEC.md).

## Durum

- [x] **M1** — Pixel UI temeli, Vanilla sunucu indirme (sha1 doğrulamalı), başlat/durdur, canlı konsol, CPU/RAM
- [ ] M2 — Loader mimarisi, Fabric, Paper, instance yönetimi
- [ ] M3 — Java tespiti + Adoptium'dan otomatik indirme
- [ ] M4 — server.properties, EULA, TLauncher desteği, whitelist, oyuncular
- [ ] M5 — Bağlantı: LAN, playit.gg, UPnP
- [ ] M6 — NeoForge/Forge/Quilt
- [ ] M7 — Davet linki ile katılma (istemci tarafı)

## Geliştirme

Gerekenler: [bun](https://bun.sh), Rust (stable), Windows'ta WebView2. Sunucuyu çalıştırmak için
Java (M1'de `JAVA_HOME` veya `PATH`'ten bulunur; MC 26.x için Java 25+).

```bash
bun install
bun run tauri dev
```

Testler ve kontroller:

```bash
cd src-tauri && cargo test && cargo clippy --all-targets
bun run build
```

Mojang API'sine giden canlı indirme testi: `cargo test -- --ignored live_install`

## Veri konumu

Sunucular uygulama veri dizininde tutulur:
`%APPDATA%\com.firatmio.mc-server-launcher\instances\<id>\{instance.json, server/}`

Asset lisansları: [ASSETS.md](ASSETS.md).
