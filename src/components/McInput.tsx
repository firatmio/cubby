import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./McInput.module.css";

export const McInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function McInput({ className, ...rest }, ref) {
    return <input ref={ref} className={[styles.input, className].filter(Boolean).join(" ")} {...rest} />;
  },
);
