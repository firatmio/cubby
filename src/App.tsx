import { useEffect } from "react";
import { bindBackendEvents } from "./lib/events";
import { EmptyScreen } from "./screens/EmptyScreen";
import { InstanceScreen } from "./screens/InstanceScreen";
import { NewServerWizard } from "./screens/NewServerWizard";
import { Sidebar } from "./screens/Sidebar";
import { useAppStore } from "./store/appStore";
import { Dialog } from "./ui/Dialog";
import { Progress } from "./ui/Progress";
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
      <Sidebar />
      <main className={styles.main}>
        {view.name === "empty" && <EmptyScreen />}
        {view.name === "wizard" && <NewServerWizard />}
        {view.name === "instance" && <InstanceScreen key={view.id} id={view.id} />}
      </main>

      {shuttingDown && (
        <Dialog title="Kapatılıyor">
          <p>Sunucu durduruluyor ve dünya kaydediliyor…</p>
          <Progress value={null} />
        </Dialog>
      )}
    </div>
  );
}
