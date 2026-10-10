# core

Minecraft Java sunucu yöneticisi (Tauri 2 masaüstü). Hedefler/milestone listesi: `SPEC.md` (M1–M7). M7 = istemci "Katıl" modu (davet linki, servers.dat, mod senkronu).

## Source map
- `src-tauri/src/` — Rust backend; tüm ağ/indirme/süreç işleri burada. Ayrıntı: `mem:backend/core`
- `src/` — React UI; yalnızca `invoke` + event dinler. Ayrıntı: `mem:frontend/core`
- `scripts/gen-textures.mjs` — 16x16 doku PNG üretici (Mojang asset'i repoya girmez; lisanslar `ASSETS.md`)

## Project-wide invariants
- UI metinleri Türkçe; kod/identifier İngilizce.
- Rust↔TS sözleşmesi elle senkron: serde `camelCase` struct'lar ↔ `src/lib/api.ts` tipleri; event adları hem `server/mod.rs`/`commands.rs`/`lib.rs` hem `src/lib/events.ts` içinde sabit.
- İndirilen her dosya hash ile doğrulanır (`download::download_file` + `hash::HashAlgo`).
- Hard-coded MC sürümü yok; her şey API'den.
- Her milestone sonunda tek commit, app çalışır halde.

Stack/komutlar: `mem:tech_stack`, `mem:suggested_commands`, `mem:task_completion`, stil: `mem:conventions`.
