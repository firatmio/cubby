import type { ReactNode } from "react";
import type { ServerStatus } from "../lib/api";
import styles from "./Badge.module.css";

type Tone = "neutral" | "accent" | "warning" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={[styles.badge, styles[tone]].join(" ")}>{children}</span>;
}

export const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Kapalı",
  starting: "Başlıyor",
  running: "Açık",
  stopping: "Kapanıyor",
  crashed: "Çöktü",
};

/** Yalnızca nokta (liste satırları için). */
export function StatusDot({ status }: { status: ServerStatus }) {
  return <span className={[styles.dot, styles[status]].join(" ")} aria-label={STATUS_LABELS[status]} />;
}

/** Noktalı hap: "● Açık". */
export function StatusBadge({ status }: { status: ServerStatus }) {
  return (
    <span className={[styles.status, styles[`s_${status}`]].join(" ")}>
      <span className={[styles.dot, styles[status]].join(" ")} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}
