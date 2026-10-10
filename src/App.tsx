import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { mediaUrl } from "./lib/api";
import { bindBackendEvents } from "./lib/events";
import { accentOf } from "./lib/format";
import { screen } from "./lib/motion";
import { AdvancedSheet } from "./screens/advanced/AdvancedSheet";
import { CoverSheet } from "./screens/cover/CoverSheet";
import { PlayersSheet } from "./screens/players/PlayersSheet";
import { HomeScreen } from "./screens/home/HomeScreen";
import { AppSettingsSheet } from "./screens/settings/AppSettingsSheet";
import { SetupFlow } from "./screens/setup/SetupFlow";
import { WorldSettingsSheet } from "./screens/world/WorldSettingsSheet";
import { Background } from "./shell/Background";
import { TitleBar } from "./shell/TitleBar";
import { useAppStore, useSelected } from "./store/appStore";
import { Dialog } from "./ui/Dialog";
import { Progress } from "./ui/Progress";
import styles from "./App.module.css";

export default function App() {
  const view = useAppStore((s) => s.view);
  const setupColor = useAppStore((s) => s.setupColor);
  const shuttingDown = useAppStore((s) => s.shuttingDown);
  const selected = useSelected();

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

  const inSetup = view === "setup";
  const accent = inSetup ? setupColor : accentOf(selected);
  const image =
    !inSetup && selected?.cover ? mediaUrl(`cover/${selected.id}`, selected.cover.version) : null;

  // Vurgu rengi (@property ile kayıtlı) dünya değişince yumuşakça geçer.
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

  return (
    <div className={styles.app}>
      <Background image={image} color={accent} />
      <TitleBar />
      <AnimatePresence mode="wait">
        <motion.main
          key={view}
          className={styles.main}
          variants={screen}
          initial="hidden"
          animate="show"
          exit="exit"
        >
          {inSetup ? <SetupFlow /> : <HomeScreen />}
        </motion.main>
      </AnimatePresence>

      <PlayersSheet />
      <WorldSettingsSheet />
      <AdvancedSheet />
      <CoverSheet />
      <AppSettingsSheet />

      {shuttingDown && (
        <Dialog title="Kapatılıyor">
          <p>Dünya kaydediliyor ve sunucu durduruluyor…</p>
          <Progress value={null} />
        </Dialog>
      )}
    </div>
  );
}
