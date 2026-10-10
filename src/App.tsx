import { useEffect } from "react";
import { McModal } from "./components/McModal";
import { McProgress } from "./components/McProgress";
import { bindBackendEvents } from "./lib/events";
import { HomeScreen } from "./screens/HomeScreen";
import { InstanceScreen } from "./screens/InstanceScreen";
import { NewServerWizard } from "./screens/NewServerWizard";
import { useAppStore } from "./store/appStore";
import styles from "./App.module.css";

export default function App() {
  const view = useAppStore((s) => s.view);
  const shuttingDown = useAppStore((s) => s.shuttingDown);

  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | undefined;
    bindBackendEvents().then((un) => {
      if (cancelled) un();
      else unbind = un;
    });
    useAppStore.getState().loadInstances().catch(console.error);
    return () => {
      cancelled = true;
      unbind?.();
    };
  }, []);

  return (
    <div className={styles.app}>
      {view.name === "home" && <HomeScreen />}
      {view.name === "wizard" && <NewServerWizard />}
      {view.name === "instance" && <InstanceScreen key={view.id} id={view.id} />}

      {shuttingDown && (
        <McModal title="Kapatılıyor">
          <p>Sunucu durduruluyor, dünya kaydediliyor…</p>
          <McProgress value={null} />
        </McModal>
      )}
    </div>
  );
}
