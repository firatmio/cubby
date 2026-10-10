# task_completion

Bir iş bitince sırayla:
1. `cd src-tauri && cargo fmt && cargo clippy --all-targets` (uyarısız)
2. `cargo test`
3. `bun run build` (tsc + vite)
4. Yeni Rust komutu/event eklendiyse `src/lib/api.ts` / `src/lib/events.ts` tarafını eşle.
5. Yeni asset eklendiyse lisansını `ASSETS.md`'ye yaz.
