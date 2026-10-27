# Assetler ve lisansları

Repoda Mojang/Microsoft'a ait hiçbir dosya (doku, font, ses, logo, ekran görüntüsü) bulunmaz.

| Asset | Kaynak | Lisans |
|---|---|---|
| Inter (arayüz yazı tipi) | [rsms/inter](https://github.com/rsms/inter), `@fontsource-variable/inter` paketiyle | SIL Open Font License 1.1 |
| JetBrains Mono (konsol yazı tipi) | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono), `@fontsource-variable/jetbrains-mono` paketiyle | SIL Open Font License 1.1 |
| İkonlar | [Lucide](https://lucide.dev), `lucide-react` paketiyle | ISC |

## Dünya türlerinin logoları ve kart görselleri (`src/assets/loaders/`)

Logolar her projenin kendi markasıdır; yalnızca o sunucu türünü tanıtmak için, aşağıdaki koşullarla kullanılır.

| Dosya | Kaynak | Lisans / koşul | Değişiklik |
|---|---|---|---|
| `fabric_logo.png` | [FabricMC/fabricmc.net](https://github.com/FabricMC/fabricmc.net) `assets/logo.png` | Site içeriği [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) © FabricMC | Yok |
| `neoforge_icon.png`, `neoforge_banner.png` | [neoforged/.github](https://github.com/neoforged/.github/tree/main/art) `art/neoforged_icon_16x16.png`, `art/discord_server_banner.png` (tasarım: Ridanisaurus) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) © NeoForged | Yok (kartta kırpılarak gösterilir) |
| `forge_anvil.svg` | [MinecraftForge/MinecraftForge](https://github.com/MinecraftForge/MinecraftForge) `docs/assets/Forge_logo.svg` | LGPL 2.1 © Minecraft Forge | Yalnız örs kısmı, logonun kendi altın rengiyle |
| `quilt_icon.svg`, `quilt_patchwork.svg` | [QuiltMC/art](https://github.com/QuiltMC/art/tree/master/brand) `brand/svg/quilt_mini_icon_transparent.svg`, `patch-*.svg` | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Yorgan deseni resmi yama şeklinden üretildi |
| `paper_logo.svg` | [PaperMC marka sayfası](https://docs.papermc.io/misc/assets/) `papermc_logo.min.svg` | PaperMC kullanım koşulları: sunucu seçicilerde Paper'ı göstermek için; renk, oran ve saydamlık değiştirilmez | Yok |
| `paper_sheets.svg`, `vanilla_landscape.svg`, `vanilla_block.svg` | Bu proje için çizildi | Projenin lisansı | — |

Fabric logosunun lisansı ticari olmayan kullanım şartı taşır; uygulama ücretli bir özellikle dağıtılacaksa
FabricMC'den izin alınmalı ya da logo kaldırılmalıdır. "Saf Minecraft" kartının görselleri Mojang'a ait değildir.

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
