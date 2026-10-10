import { motion } from "motion/react";
import { snappy } from "../lib/motion";
import styles from "./Toggle.module.css";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** Açık/kapalı anahtarı, solunda etiket. */
export function Toggle({ checked, onChange, label, description, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={styles.row}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      <span className={[styles.track, checked && styles.on].filter(Boolean).join(" ")}>
        <motion.span className={styles.knob} layout transition={snappy} />
      </span>
    </button>
  );
}
