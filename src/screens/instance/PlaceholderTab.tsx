import styles from "./TabPage.module.css";

export function PlaceholderTab({ text }: { text: string }) {
  return (
    <div className={styles.page}>
      <p className={styles.soon}>Yakında</p>
      <p className={styles.dim}>{text}</p>
    </div>
  );
}
