import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Info, X } from "lucide-react";
import { spring } from "../../lib/motion";
import type { GameNotice } from "./useGameNotice";
import styles from "./ActionBar.module.css";

/** Ana butonun üstünde tek satırlık bilgi/hata çubuğu. */
export function NoticeBar({ notice }: { notice: GameNotice | null }) {
  return (
    <AnimatePresence mode="wait">
      {notice && (
        <motion.div
          key={notice.tone + notice.text.slice(0, 24)}
          className={styles.error}
          role={notice.tone === "error" ? "alert" : "status"}
          style={notice.tone === "info" ? { background: "var(--surface-2)", color: "var(--text)" } : undefined}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={spring}
        >
          {notice.tone === "error" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
          <span>{notice.text}</span>
          {notice.action && (
            <button type="button" className={styles.noticeAction} onClick={notice.action.run}>
              {notice.action.label}
            </button>
          )}
          {notice.dismiss && (
            <button type="button" aria-label="Kapat" onClick={notice.dismiss}>
              <X size={14} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
