import { getT } from "../i18n";
import type { GameNotice } from "../screens/home/useGameNotice";
import { api, errorMessage, type LaunchResult } from "./api";
import { launchHint } from "./launch";

/**
 * Launcher açıldıktan sonraki bildirim. TLauncher'ın ortak `mods` klasöründe oyuncunun kendi modları
 * varsa (modlu dünyayla çakışıp oyunu çökertebilir) "Kenara al" eylemi eklenir; sonuç `update` ile
 * yeni başlatma sonucuna yazılır.
 */
export function launchNotice(
  r: LaunchResult,
  worldName: string,
  update: (r: LaunchResult) => void,
): Omit<GameNotice, "dismiss"> {
  const notice = launchHint(r, worldName);
  if (r.launcher !== "tLauncher" || r.ownMods.length === 0 || r.error) return notice;
  return {
    ...notice,
    action: {
      label: getT().launch.stashOwn,
      run: () => {
        api
          .stashOwnMods()
          .then((n) => update({ ...r, ownMods: [], stashed: n }))
          .catch((e) => update({ ...r, error: errorMessage(e) }));
      },
    },
  };
}
