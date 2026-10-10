# Assetler ve lisansları

Repoda Mojang/Microsoft'a ait hiçbir dosya (doku, font, ses, logo, ekran görüntüsü) bulunmaz.

| Asset | Kaynak | Lisans |
|---|---|---|
| Inter (arayüz yazı tipi) | [rsms/inter](https://github.com/rsms/inter), `@fontsource-variable/inter` paketiyle | SIL Open Font License 1.1 |
| JetBrains Mono (konsol yazı tipi) | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono), `@fontsource-variable/jetbrains-mono` paketiyle | SIL Open Font License 1.1 |
| İkonlar | [Lucide](https://lucide.dev), `lucide-react` paketiyle | ISC |

## Dünya arka planları

Dünya kapakları uygulamayla gelmez; kullanıcının kendi bilgisayarındaki Minecraft ekran görüntülerinden
(`.minecraft/screenshots`, oyunda F2) ya da kendi seçtiği bir resimden çalışma anında üretilir ve yalnızca
o dünyanın klasöründe (`.mcsm/cover.jpg`) saklanır. Hiçbir görsel bilgisayardan dışarı gönderilmez.
Görsel yoksa arka plan, dünya türünün renginde CSS ile çizilen bir parlamadır.

Fontlar uygulamayla birlikte paketlenir; çalışırken internetten indirilmez.
