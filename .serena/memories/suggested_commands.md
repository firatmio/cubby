# suggested_commands

- Dev: `bun run tauri dev` (vite :1420 + cargo run; src-tauri değişince yeniden derler)
- Rust test: `cd src-tauri && cargo test`; canlı Mojang indirme: `cargo test -- --ignored live_install` (`MCSM_TEST_DIR` ile hedef klasör)
- Lint: `cargo clippy --all-targets`, format: `cargo fmt`
- Frontend tip kontrolü + build: `bun run build`
- Doku üret: `bun scripts/gen-textures.mjs`

## Windows notları
- Shell PowerShell 5.1: `&&` yok; `Set-Content -Encoding utf8` BOM ekler (Cargo.toml/JSON için .NET `UTF8Encoding($false)` kullan).
- Dev app zorla öldürülürse `msedgewebview2.exe` yetim kalıp `EBWebView` klasörünü kilitler → sonraki açılış `HRESULT 0x800700AA` ile panikler. Komut satırında `cubby` (eskiden `mc-server-launcher`) geçen webview süreçlerini öldür.
