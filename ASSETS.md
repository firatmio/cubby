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

## Ağ hizmetleri

Arkadaşınla doğrudan bağlantı kurulamadığında (iki taraf da katı NAT arkasındaysa) trafik
[iroh](https://iroh.computer)'un (n0) ücretsiz aracı sunucularından geçer; ayrıca bağlantı kurulurken
cihaz adresleri n0'ın DNS keşif hizmetine yayınlanır. Bu sunucular bağlantı meta verilerini (IP adresleri,
veri miktarı) görebilir, oyun içeriği uçtan uca şifrelidir. İnternete açma (UPnP) için dış IP
`api.ipify.org` / `icanhazip.com`'dan öğrenilir.

Mod ve eklentiler [Modrinth](https://modrinth.com)'ten indirilir; her dosya Modrinth'in verdiği sha512 ile
doğrulanır. Mod ikonları Modrinth CDN'inden uygulama tarafından indirilip yerelde önbelleğe alınır. Her modun
lisansı ayrıntı ekranında gösterilir; modlar uygulamayla dağıtılmaz.
