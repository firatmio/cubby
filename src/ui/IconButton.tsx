import { motion, type HTMLMotionProps } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { press } from "../lib/motion";
import styles from "./IconButton.module.css";

type Props = Omit<HTMLMotionProps<"button">, "children"> & {
  icon: LucideIcon;
  /** Ekran okuyucu + üstte beliren ipucu. */
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "solid" | "ghost" | "bar_action";
  /** İpucu butonun altında mı görünsün (başlık çubuğu için). */
  tipBelow?: boolean;
};

/** Yuvarlak ikon butonu; üzerine gelince etiketi gösterir. */
export function IconButton({
  icon: Icon,
  label,
  size = "md",
  variant = "solid",
  tipBelow,
  className,
  ...rest
}: Props) {
  const iconSize = size === "lg" ? 20 : size === "sm" ? 15 : 18;
  return (
    <motion.button
      type="button"
      aria-label={label}
      className={[styles.button, styles[size], styles[variant], className].filter(Boolean).join(" ")}
      {...press}
      {...rest}
    >
      <Icon size={iconSize} aria-hidden />
      <span className={[styles.tip, tipBelow && styles.below].filter(Boolean).join(" ")}>{label}</span>
    </motion.button>
  );
}
