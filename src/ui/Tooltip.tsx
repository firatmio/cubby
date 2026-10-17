import type { ReactNode } from "react";
import styles from "./Tooltip.module.css";

type Props = {
  /** Boşsa ipucu çizilmez. */
  text: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Üzerine gelince ya da içindeki öğe klavyeyle odaklanınca beliren ipucu. */
export function Tooltip({ text, children, className }: Props) {
  if (!text) return <>{children}</>;
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(" ")}>
      {children}
      <span role="tooltip" className={styles.tip}>
        {text}
      </span>
    </span>
  );
}
