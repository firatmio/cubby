import { motion } from "motion/react";
import { ArrowRight, LogIn, Plus } from "lucide-react";
import { rise, stagger } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import styles from "./EmptyHome.module.css";

/** Hiç dünya yokken: ortada tek büyük "+" ve sağ altta aynı eylem. */
export function EmptyHome() {
  const setView = useAppStore((s) => s.setView);
  const openJoin = useAppStore((s) => s.openJoin);
  return (
    <div className={styles.empty}>
      <motion.div className={styles.center} variants={stagger} initial="hidden" animate="show">
        <motion.button
          type="button"
          className={styles.plus}
          aria-label="Yeni dünya"
          variants={rise}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setView("setup")}
        >
          <Plus size={44} aria-hidden />
        </motion.button>
        <motion.h1 variants={rise}>İlk dünyanı kuralım</motion.h1>
        <motion.p variants={rise}>
          Birkaç adımda arkadaşınla oynayabileceğin bir Minecraft dünyası. Gereken her şeyi ben indiririm.
        </motion.p>
      </motion.div>
      <div className={styles.action}>
        <Button size="lg" icon={LogIn} onClick={() => openJoin("")}>
          Arkadaşının dünyasına katıl
        </Button>
        <Button variant="primary" size="lg" icon={ArrowRight} iconRight onClick={() => setView("setup")}>
          Başlayalım
        </Button>
      </div>
    </div>
  );
}
