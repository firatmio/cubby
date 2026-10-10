import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./Card.module.css";

type CardProps = {
  title?: string;
  description?: ReactNode;
  /** Başlığın sağındaki eylemler. */
  actions?: ReactNode;
  tone?: "default" | "danger";
  children?: ReactNode;
};

/** Ayarlar gibi sayfalardaki başlıklı bölüm. */
export function Card({ title, description, actions, tone = "default", children }: CardProps) {
  return (
    <section className={[styles.card, tone === "danger" && styles.danger].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <header className={styles.header}>
          <div>
            {title && <h3 className={styles.title}>{title}</h3>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {actions && <div className={styles.actions}>{actions}</div>}
        </header>
      )}
      {children && <div className={styles.body}>{children}</div>}
    </section>
  );
}

type EmptyProps = {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon size={22} aria-hidden />
      </div>
      <h3>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}
