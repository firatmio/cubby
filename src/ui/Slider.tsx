import styles from "./Slider.module.css";

type Props = {
  label: string;
  /** Sağda gösterilen değer metni (ör. "4 GB"). */
  valueLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

export function Slider({ label, valueLabel, value, min, max, step, onChange }: Props) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className={styles.slider}>
      <span className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{valueLabel}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
