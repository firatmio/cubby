import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> & {
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
};

/** Hap görünümlü açılır liste (sistemin kendi menüsü, koyu tema). */
export function Select({ options, onChange, className, ...rest }: Props) {
  return (
    <span className={[styles.wrap, className].filter(Boolean).join(" ")}>
      <select className={styles.select} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className={styles.chevron} aria-hidden />
    </span>
  );
}
