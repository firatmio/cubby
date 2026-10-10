import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ImageIcon, Play, Settings2, Square, Users, Wrench, X } from "lucide-react";
import type { Instance } from "../../lib/api";
import { spring } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { useServerControl } from "./useServerControl";
import styles from "./ActionBar.module.css";

/** Sağ alt: ana eylem (Başlat/Durdur) ve solunda ikincil yuvarlak butonlar. */
export function ActionBar({ instance }: { instance: Instance }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const control = useServerControl(instance);
  const { status, active } = control;

  return (
    <div className={styles.bar}>
      <AnimatePresence>
        {control.error && (
          <motion.div
            className={styles.error}
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={spring}
          >
            <AlertTriangle size={16} aria-hidden />
            <span>{control.error}</span>
            <button type="button" aria-label="Kapat" onClick={control.clearError}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.buttons}>
        <IconButton icon={Users} label="Oyuncular" onClick={() => openSheet("players")} />
        <IconButton icon={Settings2} label="Dünya ayarları" onClick={() => openSheet("world")} />
        <IconButton icon={ImageIcon} label="Kapak resmi" onClick={() => openSheet("cover")} />
        <IconButton icon={Wrench} label="Gelişmiş" onClick={() => openSheet("advanced")} />
        {active ? (
          <Button
            variant="secondary"
            size="lg"
            icon={Square}
            loading={status === "stopping"}
            onClick={control.stop}
            className={styles.power}
          >
            {status === "stopping" ? "Kapanıyor" : status === "starting" ? "Açılıyor…" : "Durdur"}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={Play}
            loading={control.starting}
            onClick={control.start}
            className={styles.power}
          >
            Başlat
          </Button>
        )}
      </div>
      {control.dialogs}
    </div>
  );
}
