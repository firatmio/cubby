import { getT, locale } from "../i18n";
import type { GameProgress, LaunchResult } from "./api";

/** Launcher açıldıktan sonra oyuncuya ne yapacağını söyleyen tek cümle. */
export function launchHint(r: LaunchResult, worldName: string): { tone: "info" | "error"; text: string } {
  const t = getT().launch;
  if (r.error) return { tone: "error", text: t.error(r.error) };
  if (r.game) return { tone: "info", text: t.gameOpening };
  const why = r.note ? t.whyNotDirect(r.note) : "";
  const then = r.direct ? t.thenDirect : t.thenMenu(worldName);
  const pick = r.pick ?? "";
  if (r.launcher === "tLauncher") return { tone: "info", text: why + t.tlauncher(pick) + then };
  if (!r.opened) return { tone: "info", text: why + t.openLauncher(pick) + then };
  if (r.wasRunning) return { tone: "info", text: why + t.alreadyOpen(pick) + then };
  return { tone: "info", text: why + t.opening(pick) + then };
}

/** Oyun Launcher'sız hazırlanırken gösterilen satır. */
export function progressHint(p: GameProgress): string {
  const t = getT().launch;
  if (p.stage === "java") return t.stageJava;
  if (p.stage === "starting") return t.stageStarting;
  const n = (x: number) => x.toLocaleString(locale());
  return p.total > 0 ? t.files(n(p.done), n(p.total)) : t.preparing;
}
