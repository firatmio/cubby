import type { ReactNode } from "react";
import { getT } from "../i18n";
import type { ServerStatus } from "../lib/api";
import styles from "./Badge.module.css";

type Tone = "neutral" | "accent" | "warning" | "danger";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={[styles.badge, styles[tone]].join(" ")}>{children}</span>;
}

export function statusLabel(status: ServerStatus): string {
  return getT().status[status];
}

export function StatusDot({ status }: { status: ServerStatus }) {
  return <span className={[styles.dot, styles[status]].join(" ")} aria-hidden />;
}
