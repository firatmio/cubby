import { useEffect, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Settings, Square, X } from "lucide-react";
import { IS_MOCK } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { IconButton } from "../ui/IconButton";
import { useT } from "../i18n";
import { PageSwitch } from "./PageSwitch";
import { UpdatePill } from "./Update";
import styles from "./TitleBar.module.css";

/** Pencere işlemleri; tarayıcıdaki mock modunda etkisiz. */
const win = () => (IS_MOCK ? null : getCurrentWindow());

/**
 * Kendi başlık çubuğumuz: boş yerden sürüklenir, çift tıklayınca büyür/geri döner;
 * küçült, büyüt ve kapat düğmeleri. (Tauri'nin drag-region davranışının aynısı, elle.)
 */
export function TitleBar() {
  const openSheet = useAppStore((s) => s.openSheet);
  const home = useAppStore((s) => s.view === "home");
  const t = useT().titleBar;
  const [maximized, setMaximized] = useState(false);

  // Büyütülmüş mü: pencere boyutu her değiştiğinde sorulur (Windows'un kendi kısayolları da dahil).
  useEffect(() => {
    const w = win();
    if (!w) return;
    let un: (() => void) | undefined;
    const check = () => void w.isMaximized().then(setMaximized).catch(console.error);
    check();
    w.onResized(check).then((f) => (un = f));
    return () => un?.();
  }, []);

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    if (e.detail === 2) win()?.toggleMaximize().catch(console.error);
    else win()?.startDragging().catch(console.error);
  };

  return (
    <header className={styles.bar} onMouseDown={onMouseDown}>
      <span className={styles.name}>Cubby</span>
      {home && <PageSwitch />}
      <div className={styles.actions}>
        <UpdatePill />
        <IconButton icon={Settings} label={t.settings} size="sm" variant="ghost" tipBelow onClick={() => openSheet("settings")} />
        <IconButton icon={Minus} label={t.minimize} size="sm" variant="ghost" tipBelow onClick={() => win()?.minimize()} />
        <IconButton
          icon={maximized ? Copy : Square}
          label={maximized ? t.restore : t.maximize}
          size="sm"
          variant="ghost"
          tipBelow
          className={styles.max}
          onClick={() => win()?.toggleMaximize()}
        />
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
