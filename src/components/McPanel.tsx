import type { HTMLAttributes } from "react";
import styles from "./McPanel.module.css";

type Props = HTMLAttributes<HTMLDivElement> & {
  /** light: envanter paneli, dark: yarı saydam menü listesi, slot: içe gömük kutu */
  variant?: "light" | "dark" | "slot";
  title?: string;
};

export function McPanel({ variant = "dark", title, className, children, ...rest }: Props) {
  return (
    <div className={[styles.panel, styles[variant], className].filter(Boolean).join(" ")} {...rest}>
      {title && <div className={styles.title}>{title}</div>}
      {children}
    </div>
  );
}
