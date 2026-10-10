import type { ButtonHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import styles from "./Button.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  /** İşlem sürerken ikon yerine dönen gösterge; buton pasifleşir. */
  loading?: boolean;
  full?: boolean;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading,
  full,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  const cls = [styles.button, styles[variant], styles[size], full && styles.full, className]
    .filter(Boolean)
    .join(" ");
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? (
        <Loader2 size={iconSize} className={styles.spin} aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden />
      )}
      {children}
    </button>
  );
}
