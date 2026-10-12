import type { CSSProperties } from "react";
import type { LoaderKind } from "../lib/api";
import fabricLogo from "../assets/loaders/fabric_logo.png";
import forgeAnvil from "../assets/loaders/forge_anvil.svg";
import neoforgeBanner from "../assets/loaders/neoforge_banner.png";
import neoforgeIcon from "../assets/loaders/neoforge_icon.png";
import paperLogo from "../assets/loaders/paper_logo.svg";
import paperSheets from "../assets/loaders/paper_sheets.svg";
import quiltIcon from "../assets/loaders/quilt_icon.svg";
import quiltPatchwork from "../assets/loaders/quilt_patchwork.svg";
import vanillaBlock from "../assets/loaders/vanilla_block.svg";
import vanillaLandscape from "../assets/loaders/vanilla_landscape.svg";

/** Her türün kendi logosu; `pixel`: piksel çizim, büyütülürken bulanıklaşmasın. Kaynak ve lisanslar ASSETS.md'de. */
const LOGOS: Record<LoaderKind, { src: string; pixel: boolean }> = {
  // 52x56 piksel çizim; küçültülürken yumuşak ölçeklensin.
  fabric: { src: fabricLogo, pixel: false },
  neoforge: { src: neoforgeIcon, pixel: true },
  forge: { src: forgeAnvil, pixel: false },
  quilt: { src: quiltIcon, pixel: false },
  paper: { src: paperLogo, pixel: false },
  vanilla: { src: vanillaBlock, pixel: true },
};

const image = (src: string, extra: CSSProperties = {}): CSSProperties => ({
  backgroundImage: `url("${src}")`,
  backgroundSize: "cover",
  backgroundPosition: "center",
  ...extra,
});

/** Kurulum kartlarının arka planı: türün kendi rozet/banner tasarımı, yoksa ona uygun bir görsel. */
export const LOADER_ART: Record<LoaderKind, CSSProperties> = {
  // Tilki sağ üstte kalsın, yazılar çizgili kısmın üstüne gelsin.
  neoforge: image(neoforgeBanner, { imageRendering: "pixelated", backgroundSize: "165%", backgroundPosition: "92% 30%" }),
  // Yorgan deseni koyulaştırılır; logo (aynı renkler) üstünde seçilsin.
  quilt: {
    background: `linear-gradient(rgba(24, 16, 44, 0.6), rgba(24, 16, 44, 0.6)), url("${quiltPatchwork}") center / 55% repeat`,
  },
  forge: {
    background: `url("${forgeAnvil}") right -30px bottom 24px / 78% no-repeat, linear-gradient(160deg, #22344d, #121a26)`,
  },
  // Fabric: dokuma kumaş (kendi deseni; Fabric logosundaki kumaş rulosunun renkleri).
  fabric: {
    background:
      "repeating-linear-gradient(45deg, rgba(219,208,180,0.10) 0 2px, transparent 2px 9px), repeating-linear-gradient(-45deg, rgba(219,208,180,0.10) 0 2px, transparent 2px 9px), linear-gradient(160deg, #4a4232, #24201a)",
  },
  paper: image(paperSheets, { backgroundPosition: "right center" }),
  vanilla: image(vanillaLandscape, { imageRendering: "pixelated", backgroundPosition: "center bottom" }),
};

type Props = { kind: LoaderKind; size: number; className?: string };

/** Dünya türünün logosu (kare alanda, oranı korunarak). */
export function LoaderLogo({ kind, size, className }: Props) {
  const logo = LOGOS[kind];
  return (
    <img
      src={logo.src}
      alt=""
      aria-hidden
      draggable={false}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        imageRendering: logo.pixel ? "pixelated" : undefined,
      }}
    />
  );
}
