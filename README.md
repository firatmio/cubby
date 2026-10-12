# Cubby

**English** · [Türkçe](README.tr.md)

Your own Minecraft world with your friends: Cubby sets up and runs a Java server without any terminal work, invites your friends, and opens the game straight into the world.
Tauri 2 (Rust) + React + TypeScript + Vite. Detailed goals (Turkish): [SPEC.md](SPEC.md).

## Status

- [x] **M1** — Pixel UI foundation, vanilla server download (sha1-verified), start/stop, live console, CPU/RAM
- [x] **M2** — Loader architecture, Fabric + Paper (Fill v3), loader version picker, rename / RAM / delete (Recycle Bin), per-server location
- [x] **M3** — Java detection (PATH, JAVA_HOME, registry, common folders, Minecraft Launcher runtimes) + portable JRE from Adoptium, per-server Java choice
- [x] **Console-style UI** — custom title bar, fixed 1200×720 window, dark theme, world tiles; each world's background is an in-game screenshot (F2) taken in that world, player list, LAN invite address
- [x] **M4** — World settings (key fields + the full `server.properties` table), one-time EULA, TLauncher (non-premium) mode, whitelist (also during setup), operators, kicking players, one-click allow for players who couldn't join, cover = server icon, MOTD = world name
- [x] **M5** — Joining over the internet: per-world "Open to internet", automatic port opening on the router (UPnP) and CGNAT detection; if the router won't allow it, the reason and the fix are explained in plain words
- [x] **M6** — NeoForge, Forge (1.17+) and Quilt: official installers run with Java (hash-verified), version lists and recommended versions, a mod store for every loader; "Mods in the player's Minecraft too" also installs the NeoForge/Forge client
- [x] **M7a** — Join mode: invite link/code (`cubby://join?d=…`), direct app-to-app connection (iroh, with a relay fallback), confirmation dialog, automatic entry in Minecraft's server list, version warning, running in the background (tray)
- [x] **M8** — Mod/plugin store (Modrinth): search, categories, version-matched installs, dependencies handled automatically, updates, installed-mods list (manually added mods are recognized by hash)
- [x] **M7b** — Mods in the player's Minecraft too: for modded worlds, mods that players need or are recommended are installed into your own Minecraft with a per-world Launcher profile (can be turned off in Settings; TLauncher uses the shared `mods` folder). When joining, missing mods are checked: required ones are installed, recommended ones are optional; from Modrinth or from your friend's app (hash-verified). "Update" when your friend changes their mods
- [x] **Start and join** — from the menu next to Start: once the server is up, the Minecraft Launcher opens with the world's profile selected and Play connects straight to the world (Quick Play, 1.20+); "Play" on your friend's side does the same
- [~] **M9** — Launching without the Launcher: Microsoft sign-in (PKCE in the browser; the refresh token lives in Windows Credential Manager), game files are downloaded hash-verified while sharing `.minecraft`, and the game opens straight into the world with Quick Play (verified live with vanilla and NeoForge 26.3). The last step of Microsoft sign-in is **waiting for Mojang's approval**: [docs/MICROSOFT_GIRIS.md](docs/MICROSOFT_GIRIS.md) (Turkish). Until then, and for players who aren't signed in, the Launcher flow is used
- [x] **English** — UI and error messages in Turkish and English; follows the computer's language on first launch, changeable in Settings > Language
- [~] **M10** — Play / Discover pages: centred pills in the title bar with a goo (slime) transition, pages slide with a stretch. Animation level (Full / Simple / Off) detected automatically (Windows animation setting, software rendering, dropped frames) and adjustable in Settings
  - [x] **M10a** — pages, animation level, Discover with mods: world picker, large-image card grid (Modrinth featured images resized and cached on disk), prefetching and an in-memory cache so lists appear instantly
  - [ ] **M10b** — resource packs (optionally required for friends), shaders (Iris installed automatically), data packs
  - [ ] **M10c** — modpacks → new world

Next up: M10b/M10c, then a web join page and release preparation.

**Next:**
- Web join page (together with release preparation)

**Ideas:**
- World backups: connect a Google account and back up to Google Drive automatically
- Backups on our own server (VDS) with a premium account

## Development

Requirements: [bun](https://bun.sh), Rust (stable), WebView2 on Windows. Java isn't needed to run
servers: if no suitable version is found, the app downloads an Eclipse Temurin JRE into its own folder.

```bash
bun install
bun run tauri dev
```

To see the UI without Tauri, using mock data, run `bun run dev` and open
`http://localhost:1420` in a browser (development mode only; `src/lib/mock.ts`).

Tests and checks:

```bash
cd src-tauri && cargo test && cargo clippy --all-targets
bun run build
```

Live tests (Mojang, Fabric, Paper, NeoForge, Forge, Quilt, Adoptium JRE): `cargo test -- --ignored live_install`; to list the Java installs on this machine: `cargo test -- --ignored live_scan --nocapture`

### Translations

UI text lives in `src/i18n/tr.ts` (the source dictionary) and `src/i18n/en.ts`; a missing key in `en.ts` fails `tsc`.
Rust messages use `tx!("Türkçe", "English")` side by side (`src-tauri/src/i18n.rs`).

## Data location

By default, servers are kept in the app data folder:
`%APPDATA%\com.quacomes.cubby\instances\<id>\{instance.json, server/}`. (The old `com.firatmio.mc-server-launcher` folder is moved here on first launch.)
A different folder can be chosen in the setup wizard; which server lives where is recorded in `instances.json`.

Asset licenses: [ASSETS.md](ASSETS.md).
