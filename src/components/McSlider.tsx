import styles from "./McSlider.module.css";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

/** Minecraft ayar kaydırıcısı: etiket çubuğun üstüne yazılır. */
export function McSlider({ label, value, min, max, step, onChange }: Props) {
  return (
    <label className={styles.slider}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={styles.label}>{label}</span>
    </label>
  );
}
