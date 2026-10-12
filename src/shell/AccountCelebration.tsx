import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAppStore } from "../store/appStore";
import { SkinHead } from "../ui/SkinHead";
import styles from "./AccountCelebration.module.css";

const PARTICLES = 16;
const COLORS = ["#6cc04a", "#ffd36b", "#5b9cff", "#ff7a59", "#ffffff", "#a07ad8"];
const SHOW_MS = 2800;

/** Patlama parçacıkları: çevreye eşit aralıkla, biraz rastgele uzaklıkta saçılan küçük pikseller. */
const bits = Array.from({ length: PARTICLES }, (_, i) => {
  const angle = (i / PARTICLES) * Math.PI * 2 + (i % 2 ? 0.18 : -0.12);
  const dist = 110 + ((i * 37) % 60);
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    size: 6 + ((i * 13) % 7),
    color: COLORS[i % COLORS.length],
    rotate: (i % 3) * 45,
  };
});

/**
 * Microsoft girişi tamamlanınca: ekran bulanıklaşır, ortada oyuncunun kafası küçük bir patlamayla
 * belirir. Uygulama arka plandaysa (oyuncu hâlâ tarayıcıdaysa) pencere öne gelince oynar.
 */
export function AccountCelebration() {
  const account = useAppStore((s) => s.celebrate);
  const setCelebrate = useAppStore((s) => s.setCelebrate);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!account) return;
    const play = () => setVisible(true);
    if (document.hasFocus()) {
      play();
      return;
    }
    window.addEventListener("focus", play, { once: true });
    return () => window.removeEventListener("focus", play);
  }, [account]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <AnimatePresence onExitComplete={() => setCelebrate(null)}>
      {visible && account && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={() => setVisible(false)}
          role="status"
        >
          <div className={styles.center}>
            <motion.span
              className={styles.ring}
              initial={{ scale: 0.3, opacity: 0.9 }}
              animate={{ scale: 2.6, opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut", delay: 0.15 }}
            />
            {bits.map((b, i) => (
              <motion.span
                key={i}
                className={styles.bit}
                style={{ width: b.size, height: b.size, background: b.color }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
                animate={{ x: b.x, y: b.y, opacity: 0, scale: 0.5, rotate: b.rotate + 90 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
              />
            ))}
            <motion.div
              className={styles.head}
              initial={{ scale: 0, rotate: -14 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 14, delay: 0.1 }}
            >
              <SkinHead url={account.skin} size={96} />
            </motion.div>
          </div>
          <motion.p
            className={styles.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
          >
            Microsoft hesabı bağlandı
          </motion.p>
          <motion.p
            className={styles.sub}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            Hoş geldin, {account.name}. Oyun artık tek tıkla doğrudan dünyada açılır.
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
