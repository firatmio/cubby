import { motion } from "motion/react";
import { snappy } from "../lib/motion";
import styles from "./Toggle.module.css";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Ekran okuyucu için (görünür etiket satırın kendisinde). */
  label: string;
  disabled?: boolean;
};

/** Etiketsiz açık/kapalı anahtarı (tablo satırlarında); görünümü `Toggle` ile aynı. */
export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.bare}
      onClick={() => onChange(!checked)}
    >
      <span className={[styles.track, checked && styles.on].filter(Boolean).join(" ")}>
        <motion.span className={styles.knob} initial={false} animate={{ x: checked ? 18 : 0 }} transition={snappy} />
      </span>
    </button>
  );
}
