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
  // TLauncher'ın ortak mods klasörü: oyuncunun kendi modları bu dünyayla çakışabilir.
  const own = r.stashed
    ? t.ownModsStashed(r.stashed)
    : r.launcher === "tLauncher" && r.ownMods.length > 0
      ? t.ownModsWarn(r.ownMods.length)
      : "";
  if (r.launcher === "prism") return { tone: "info", text: r.opened ? t.prism : t.prismClosed(worldName) };
  if (r.launcher === "tLauncher") {
    if (!r.opened) return { tone: "info", text: own + why + t.tlauncherMissing + t.tlauncher(pick) + then };
    if (r.wasRunning) return { tone: "info", text: own + why + t.tlauncherRunning(pick) + then };
    return { tone: "info", text: own + why + t.tlauncherOpening(pick) + then };
  }
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
