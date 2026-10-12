import { api } from "../../lib/api";
import { useT } from "../../i18n";
import { progressHint } from "../../lib/launch";
import { useAppStore } from "../../store/appStore";

export type GameNotice = {
  tone: "info" | "error";
  text: string;
  /** Mesajın yanındaki eylem (ör. çökünce günlüğü aç). */
  action?: { label: string; run: () => void };
  dismiss?: () => void;
};

/** Oyun Launcher'sız açılırken ilerleme ya da oyun hatayla kapandıysa mesaj; ikisi de yoksa null. */
export function useGameNotice(): GameNotice | null {
  const progress = useAppStore((s) => s.gameProgress);
  const crash = useAppStore((s) => s.gameCrash);
  const setGameCrash = useAppStore((s) => s.setGameCrash);
  const t = useT().launch;
  if (progress) return { tone: "info", text: progressHint(progress) };
  if (crash !== null) {
    return {
      tone: "error",
      text: t.crashed(crash),
      action: { label: t.openLog, run: () => void api.openGameLog().catch(console.error) },
      dismiss: () => setGameCrash(null),
    };
  }
  return null;
}
