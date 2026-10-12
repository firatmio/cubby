import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Settings, X } from "lucide-react";
import { IS_MOCK } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { IconButton } from "../ui/IconButton";
import { useT } from "../i18n";
import { PageSwitch } from "./PageSwitch";
import styles from "./TitleBar.module.css";

/** Pencere işlemleri; tarayıcıdaki mock modunda etkisiz. */
const win = () => (IS_MOCK ? null : getCurrentWindow());

/**
 * Kendi başlık çubuğumuz: boş yerden sürüklenir, yalnız küçült ve kapat var
 * (pencere sabit boyutlu; çift tıkla büyütme olmasın diye drag-region yerine startDragging).
 */
export function TitleBar() {
  const openSheet = useAppStore((s) => s.openSheet);
  const home = useAppStore((s) => s.view === "home");
  const t = useT().titleBar;

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    win()?.startDragging().catch(console.error);
  };

  return (
    <header className={styles.bar} onMouseDown={onMouseDown}>
      <span className={styles.name}>Cubby</span>
      {home && <PageSwitch />}
      <div className={styles.actions}>
        <IconButton icon={Settings} label={t.settings} size="sm" variant="ghost" tipBelow onClick={() => openSheet("settings")} />
        <IconButton icon={Minus} label={t.minimize} size="sm" variant="ghost" tipBelow onClick={() => win()?.minimize()} />
        <IconButton
          icon={X}
          label={t.close}
          size="sm"
          variant="ghost"
          tipBelow
          className={styles.close}
          onClick={() => win()?.close()}
        />
      </div>
    </header>
  );
}
