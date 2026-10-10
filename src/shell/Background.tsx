import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { crossfade } from "../lib/motion";
import styles from "./Background.module.css";

type Props = {
  /** Dünyanın kapak görseli; yoksa renk parlaması. */
  image: string | null;
  color: string;
};

type Layer = { key: string; image: string | null; color: string };

/**
 * İki katmanlı arka plan: yeni görsel önce tamamen çözülür (titreme olmaz), sonra eskisinin
 * üzerine çapraz geçişle gelir. Görsel çok yavaş yakınlaşır; üstte yazıların okunması için gölge.
 */
export function Background({ image, color }: Props) {
  const [layer, setLayer] = useState<Layer>({ key: image ?? `glow:${color}`, image, color });

  useEffect(() => {
    const key = image ?? `glow:${color}`;
    if (key === layer.key) return;
    if (!image) {
      setLayer({ key, image: null, color });
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.src = image;
    img
      .decode()
      .then(() => true)
      .catch(() => false)
      .then((ok) => {
        if (cancelled) return;
        setLayer(ok ? { key, image, color } : { key: `glow:${color}`, image: null, color });
      });
    return () => {
      cancelled = true;
    };
  }, [image, color, layer.key]);

  return (
    <div className={styles.root} aria-hidden>
      <AnimatePresence initial={false}>
        <motion.div
          key={layer.key}
          className={styles.layer}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={crossfade}
        >
          {layer.image ? (
            <img src={layer.image} alt="" className={styles.image} draggable={false} />
          ) : (
            <div className={styles.glow} style={{ "--glow": layer.color } as React.CSSProperties} />
          )}
        </motion.div>
      </AnimatePresence>
      <div className={styles.scrim} />
    </div>
  );
}
