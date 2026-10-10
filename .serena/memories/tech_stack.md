# tech_stack

- Tauri 2.12, Rust edition 2024 (rustc 1.95), crate lib adı `mc_server_launcher_lib`.
- Rust deps: tokio, reqwest 0.13 (`rustls` feature — 0.12'deki `rustls-tls` değil), sha1/sha2 0.11, sysinfo 0.39, uuid, thiserror, tauri-plugin-opener, tauri-plugin-single-instance, tauri-plugin-dialog, trash.
- Frontend: React 19, TypeScript 6, Vite 8, zustand. Paket yöneticisi **bun** (`bun.lock`).
- Uygulama identifier: `com.firatmio.mc-server-launcher`; pencere label `main`.
