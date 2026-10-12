import { motion } from "motion/react";
import { Background } from "./Background";
import { pageX } from "./pageMotion";
import styles from "./Backdrops.module.css";

type Props = {
  image: string | null;
  color: string;
  /** Ana görünümde arka planlar sayfalarla kayar; kurulumda yalnız dünya/tür arka planı. */
  strip: boolean;
};

/**
 * Sayfaların arkasındaki iki zemin yan yana: Oyna'da dünyanın kapağı, Keşfet'te resimsiz,
 * dünyanın renginde yumuşak ışıltılar. Başlık çubuğunun arkası da dahil.
 */
export function Backdrops({ image, color, strip }: Props) {
  return (
    <div className={styles.root} aria-hidden>
      <motion.div className={styles.strip} style={{ x: strip ? pageX : 0 }}>
        <div className={styles.slot}>
          <Background image={image} color={color} />
        </div>
        <div className={styles.slot}>
          <div className={styles.discover} style={{ "--glow": color } as React.CSSProperties} />
        </div>
      </motion.div>
    </div>
  );
}
