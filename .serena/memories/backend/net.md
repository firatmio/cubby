# backend/net (M5) — src-tauri/src/net/

- `net/mod.rs` — `NetManager` (Arc, `app.manage`): dünya başına `World {direct: Route, mapping, renew token}`. `install()` `server://status` dinler: running + `instance.internet` → `up()` (UPnP), stopped/crashed → `down()` (eşleme silinir). `view()` → `ConnectionView {lan, internet, direct: Route}` (Route.state: off|working|ok|error). Event `net://status` `{id, view}`. `begin_shutdown` → `NetManager::shutdown()`.
- `net/upnp.rs` — igd-next 0.18 (`aio::tokio::search_gateway`; `SearchOptions` non_exhaustive → `let mut o = default()`). CGNAT: modem dış IP'si özel/100.64/10 ya da gerçek dış IP'den (api.ipify.org → icanhazip.com) farklı. `add_port` (lease 3600, OnlyPermanent → 0), PortInUse → `add_any_port`; 30 dk'da bir yenileme. Kullanıcının modemi (192.168.0.1) UPnP'ye yanıt vermiyor (Windows NATUPnP da bulamadı).
- Komutlar `net_cmds.rs`: connection_status, set_internet. Instance alanı `internet` (serde default).
- **playit.gg kaldırıldı (karar 2026-10-10):** 1.0 Windows'ta servis istiyor; gömme mümkündü ama hesap girişi gerekiyor ve ToS §3.4 (bundled/white-label yasak) riski var. Kullanıcı kararı: UPnP olmazsa çözüm M7'deki uygulamalar arası doğrudan bağlantı ("arkadaşın da uygulamayı kursun" → kitle büyür).
- Canlı test: `cargo test --lib -- --ignored live_upnp --nocapture`.
