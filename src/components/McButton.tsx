import type { ButtonHTMLAttributes } from "react";
import styles from "./McButton.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "green" | "red";
  size?: "md" | "lg";
  wide?: boolean;
};

export function McButton({ variant = "default", size = "md", wide, className, ...rest }: Props) {
  const cls = [styles.button, styles[variant], styles[size], wide && styles.wide, className]
    .filter(Boolean)
    .join(" ");
  return <button type="button" className={cls} {...rest} />;
}
