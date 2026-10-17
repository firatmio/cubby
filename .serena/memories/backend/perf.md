# Performance (perf.rs)

- **Health**: `server/log.rs` parses "Can't keep up! … Running Xms" → `LogEvent::Behind(ms)` → `perf::on_behind`. `Health` (per world, in managed `Perf`): first 60 s after "running" ignored, ≥2 hits in 5 min → overloaded, 10 min calm → clears. Event `server://health {id, overloaded, behindMs}`; 60 s tick loop in `perf::install`.
- **Pregen (Chunky, Modrinth `fALzjamp`)**: only non-vanilla loaders. `pregen_start` installs Chunky via `mods_cmds::mods_install` if missing → `Pending` (needs restart/start); if running sends `chunky spawn/radius/start/confirm`. Log lines parsed by `perf::parse_chunky` (checked before the `]: ` split; Progress lines are not pushed to the console). State in `meta/pregen.json`; event `server://pregen {id, pregen}`.
- On status "running": Pending → start, Running/auto-paused → `chunky continue`. `server://players`: players>0 → auto pause, 0 → continue.
- New worlds: view-distance 8, simulation-distance 6 (`commands::create_instance`).
- Frontend: `screens/world/PerformanceSection.tsx` (presets `PRESETS`, `presetOf`, `busyWithPregen`; inside WorldSettingsSheet, id `world-performance`), Hero chips → `openWorldPerformance()` (store `worldFocus`, sheet scrolls to the section). Overload warning hidden while pregen running or manually paused. Mock simulates progress + an overloaded mock-1.
