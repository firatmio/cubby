import styles from "./McProgress.module.css";

/** value: 0–1; null ise belirsiz (kayan şerit). */
export function McProgress({ value }: { value: number | null }) {
  return (
    <div className={styles.track}>
      {value === null ? (
        <div className={styles.indeterminate} />
      ) : (
        <div
          className={styles.fill}
          style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      )}
    </div>
  );
}
