import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import styles from "./Input.module.css";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={[styles.input, className].filter(Boolean).join(" ")} {...rest} />;
  },
);

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
};

/** Etiket + kontrol + açıklama. */
export function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
