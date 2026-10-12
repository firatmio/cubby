import { UserRound } from "lucide-react";
import styles from "./SkinHead.module.css";

/** Minecraft skin'inin yüzü (8×8) ve şapka katmanı; skin 64×64 PNG, `size` piksele büyütülür. */
export function SkinHead({ url, size = 40 }: { url: string | null; size?: number }) {
  // textures.minecraft.net http adres veriyor; uygulama sayfası https olduğu için https'e çevrilir.
  const src = url?.replace(/^http:\/\//, "https://");
  const layer = (x: number) => ({
    backgroundImage: `url("${src}")`,
    backgroundSize: `${size * 8}px ${size * 8}px`,
    backgroundPosition: `-${size * x}px -${size}px`,
  });
  return (
    <span className={styles.head} style={{ width: size, height: size, borderRadius: size / 5 }} aria-hidden>
      {src ? (
        <>
          <span className={styles.layer} style={layer(1)} />
          <span className={styles.layer} style={layer(5)} />
        </>
      ) : (
        <UserRound size={size * 0.6} className={styles.empty} />
      )}
    </span>
  );
}
