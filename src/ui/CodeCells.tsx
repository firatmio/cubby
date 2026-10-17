import styles from "./CodeCells.module.css";

export { styles as codeCellStyles };

type CellsProps = {
  value: string;
  length: number;
  /** Vurgulanan hücre (odak). */
  active?: number | null;
  /** İmlecin yanıp söndüğü boş hücre. */
  caret?: number | null;
};

/** Bir sıra karakter hücresi. */
export function Cells({ value, length, active = null, caret = null }: CellsProps) {
  return (
    <div className={styles.cells} aria-hidden>
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          className={[
            styles.cell,
            value[i] && styles.filled,
            i === active && styles.active,
            i === caret && styles.caret,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {value[i] ?? ""}
        </span>
      ))}
    </div>
  );
}

/** Salt okunur davet kodu (`K7M-2QX`): iki üçlü hücre; `code` yoksa boş hücreler nabız atar. */
export function CodeDisplay({ code, label }: { code: string | null; label: string }) {
  const plain = (code ?? "").replace("-", "");
  return (
    <div
      className={[styles.code, !code && styles.waiting].filter(Boolean).join(" ")}
      role="img"
      aria-label={code ? `${label}: ${code}` : label}
    >
      <Cells value={plain.slice(0, 3)} length={3} />
      <span className={styles.dash} aria-hidden />
      <Cells value={plain.slice(3)} length={3} />
    </div>
  );
}
