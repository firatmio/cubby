# Assetler ve lisansları

Repoda Mojang/Microsoft'a ait hiçbir dosya (doku, font, ses, logo) bulunmaz.

| Dosya | Kaynak | Lisans |
|---|---|---|
| `src/assets/fonts/Monocraft.otf`, `Monocraft-Bold.otf` | [Monocraft v4.2.1](https://github.com/IdreesInc/Monocraft) — Idrees Hassan | SIL Open Font License 1.1 (`src/assets/fonts/OFL.txt`) |
| `src/assets/textures/dirt.png`, `stone.png`, `grass_side.png` | Bu projede `scripts/gen-textures.mjs` ile üretildi (kendi paletimiz, deterministik gürültü) | Proje lisansı |
| Buton, panel, slot, progress bar görünümleri | Saf CSS (`src/components/*.module.css`) | Proje lisansı |

Dokuları yeniden üretmek için: `bun scripts/gen-textures.mjs`
