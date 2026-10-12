import { api } from "../../lib/api";
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
  if (progress) return { tone: "info", text: progressHint(progress) };
  if (crash !== null) {
    return {
      tone: "error",
      text: `Minecraft beklenmedik şekilde kapandı (kod ${crash}).`,
      action: { label: "Günlüğü aç", run: () => void api.openGameLog().catch(console.error) },
      dismiss: () => setGameCrash(null),
    };
  }
  return null;
}
