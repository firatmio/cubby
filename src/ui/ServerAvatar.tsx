import grass from "../assets/textures/grass_side.png";

/** Sunucunun simgesi: kendi çizdiğimiz pixel çim bloğu (arayüzdeki tek pixel-art öğe). */
export function ServerAvatar({ size = 32 }: { size?: number }) {
  return (
    <img
      src={grass}
      alt=""
      width={size}
      height={size}
      style={{
        flexShrink: 0,
        borderRadius: size >= 40 ? 8 : 6,
        imageRendering: "pixelated",
      }}
    />
  );
}
