import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, mediaUrl } from "./lib/api";
import { bindBackendEvents } from "./lib/events";
import { KIND_COLORS, accentOf } from "./lib/format";
import { screen } from "./lib/motion";
import { AdvancedSheet } from "./screens/advanced/AdvancedSheet";
import { CoverSheet } from "./screens/cover/CoverSheet";
import { PlayersSheet } from "./screens/players/PlayersSheet";
import { HomeScreen } from "./screens/home/HomeScreen";
import { AppSettingsSheet } from "./screens/settings/AppSettingsSheet";
import { ConnectionSheet } from "./screens/connection/ConnectionSheet";
import { JoinDialog } from "./screens/join/JoinDialog";
import { SetupFlow } from "./screens/setup/SetupFlow";
import { WorldSettingsSheet } from "./screens/world/WorldSettingsSheet";
import { Background } from "./shell/Background";
import { TitleBar } from "./shell/TitleBar";
import { useAppStore, useSelected, useSelectedJoined } from "./store/appStore";
import { Dialog } from "./ui/Dialog";
import { Progress } from "./ui/Progress";
import styles from "./App.module.css";

export default function App() {
  const view = useAppStore((s) => s.view);
  const setupColor = useAppStore((s) => s.setupColor);
  const shuttingDown = useAppStore((s) => s.shuttingDown);
  const selected = useSelected();
  const joined = useSelectedJoined();

  useEffect(() => {
    let cancelled = false;
    let unbind: (() => void) | undefined;
    bindBackendEvents().then((un) => {
      if (cancelled) un();
      else unbind = un;
    });
    const st = useAppStore.getState();
    st.loadInstances().catch(console.error);
    st.loadJoined().catch(console.error);
    // Uygulama bir davet linkiyle açıldıysa.
    api
      .takePendingInvite()
      .then((code) => code && useAppStore.getState().openJoin(code))
      .catch(console.error);
    return () => {
      cancelled = true;
      unbind?.();
    };
  }, []);

  const inSetup = view === "setup";
  const accent = inSetup ? setupColor : joined ? KIND_COLORS[joined.world.loader] : accentOf(selected);
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
      <ConnectionSheet />
      <AdvancedSheet />
      <CoverSheet />
      <AppSettingsSheet />
      <JoinDialog />

      {shuttingDown && (
        <Dialog title="Kapatılıyor">
          <p>Dünya kaydediliyor ve sunucu durduruluyor…</p>
          <Progress value={null} />
        </Dialog>
      )}
    </div>
  );
}
