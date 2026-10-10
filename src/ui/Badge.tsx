import type { ReactNode } from "react";
import type { ServerStatus } from "../lib/api";
import styles from "./Badge.module.css";

type Tone = "neutral" | "accent" | "warning" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={[styles.badge, styles[tone]].join(" ")}>{children}</span>;
}

export const STATUS_LABELS: Record<ServerStatus, string> = {
  stopped: "Kapalı",
  starting: "Açılıyor",
  running: "Açık",
  stopping: "Kapanıyor",
  crashed: "Beklenmedik şekilde kapandı",
};

export function StatusDot({ status }: { status: ServerStatus }) {
  return <span className={[styles.dot, styles[status]].join(" ")} aria-hidden />;
}
