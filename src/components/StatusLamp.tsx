import type { ServerStatus } from "../lib/api";
import styles from "./StatusLamp.module.css";

export const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Kapalı",
  starting: "Başlıyor…",
  running: "Açık",
  stopping: "Kapanıyor…",
  crashed: "Çöktü",
};

export function StatusLamp({ status }: { status: ServerStatus }) {
  return (
    <span className={styles.status}>
      <span className={[styles.lamp, styles[status]].join(" ")} />
      {STATUS_LABELS[status]}
    </span>
  );
}
