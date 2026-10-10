import styles from "./Progress.module.css";

/** value: 0–1; null ise belirsiz (kayan şerit). */
export function Progress({ value }: { value: number | null }) {
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      {value === null ? (
        <div className={styles.indeterminate} />
      ) : (
        <div className={styles.fill} style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }} />
      )}
    </div>
  );
}
