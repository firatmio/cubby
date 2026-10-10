import type { ReactNode } from "react";
import styles from "./McModal.module.css";

type Props = {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function McModal({ title, children, actions }: Props) {
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.modal}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
