# Assetler ve lisansları

Repoda Mojang/Microsoft'a ait hiçbir dosya (doku, font, ses, logo) bulunmaz.

| Asset | Kaynak | Lisans |
|---|---|---|
| Inter (arayüz yazı tipi) | [rsms/inter](https://github.com/rsms/inter), `@fontsource-variable/inter` paketiyle | SIL Open Font License 1.1 |
| JetBrains Mono (konsol yazı tipi) | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono), `@fontsource-variable/jetbrains-mono` paketiyle | SIL Open Font License 1.1 |
| İkonlar | [Lucide](https://lucide.dev), `lucide-react` paketiyle | ISC |
| `src/assets/textures/grass_side.png` (sunucu simgesi) | Bu projede `scripts/gen-textures.mjs` ile üretildi (kendi paletimiz, deterministik gürültü) | Proje lisansı |

Fontlar uygulamayla birlikte paketlenir; çalışırken internetten indirilmez.
Simgeyi yeniden üretmek için: `bun scripts/gen-textures.mjs`
