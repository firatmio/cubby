import { motion } from "motion/react";
import { ArrowRight, LogIn, Plus } from "lucide-react";
import { useT } from "../../i18n";
import { rise, stagger } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import styles from "./EmptyHome.module.css";

/** Hiç dünya yokken: ortada tek büyük "+" ve sağ altta aynı eylem. */
export function EmptyHome() {
  const setView = useAppStore((s) => s.setView);
  const openJoin = useAppStore((s) => s.openJoin);
  const t = useT().home;
  return (
    <div className={styles.empty}>
      <motion.div className={styles.center} variants={stagger} initial="hidden" animate="show">
        <motion.button
          type="button"
          className={styles.plus}
          aria-label={t.newWorld}
          variants={rise}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setView("setup")}
        >
          <Plus size={44} aria-hidden />
        </motion.button>
        <motion.h1 variants={rise}>{t.emptyTitle}</motion.h1>
        <motion.p variants={rise}>{t.emptyText}</motion.p>
      </motion.div>
      <div className={styles.action}>
        <Button size="lg" icon={LogIn} onClick={() => openJoin("")}>
          {t.joinFriend}
        </Button>
        <Button variant="primary" size="lg" icon={ArrowRight} iconRight onClick={() => setView("setup")}>
          {t.letsGo}
        </Button>
      </div>
    </div>
  );
}
