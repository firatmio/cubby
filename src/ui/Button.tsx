import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { Loader2, type LucideIcon } from "lucide-react";
import { press } from "../lib/motion";
import styles from "./Button.module.css";

type Props = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  /** İkon yazının sağında (ör. "Devam →"). */
  iconRight?: boolean;
  loading?: boolean;
  children?: ReactNode;
};

/** Hap buton. Ana eylem `primary` (beyaz), diğerleri sakin. */
export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconRight,
  loading,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  const cls = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  const iconSize = size === "lg" ? 20 : size === "sm" ? 15 : 17;
  const icon = loading ? (
    <Loader2 size={iconSize} className={styles.spin} aria-hidden />
  ) : (
    Icon && <Icon size={iconSize} aria-hidden />
  );
  return (
    <motion.button type="button" className={cls} disabled={disabled || loading} {...press} {...rest}>
      {!iconRight && icon}
      {children}
      {iconRight && icon}
    </motion.button>
  );
}
