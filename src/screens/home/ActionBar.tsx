import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  AlertTriangle,
  ImageIcon,
  Info,
  LogIn,
  Play,
  Plug,
  Puzzle,
  Settings2,
  Square,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { Instance } from "../../lib/api";
import { launchHint } from "../../lib/launch";
import { spring } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { SplitButton } from "../../ui/SplitButton";
import { useServerControl } from "./useServerControl";
import styles from "./ActionBar.module.css";

type StartMode = "start" | "join";

const START_OPTIONS = [
  { id: "join" as const, label: "Başlat ve katıl", icon: LogIn },
  { id: "start" as const, label: "Başlat", icon: Play },
];

/** Dünya başına son seçilen başlatma şekli (tarayıcı deposu yoksa "Başlat ve katıl"). */
function loadMode(id: string): StartMode {
  try {
    return localStorage.getItem(`startMode:${id}`) === "start" ? "start" : "join";
  } catch {
    return "join";
  }
}

function saveMode(id: string, mode: StartMode) {
  try {
    localStorage.setItem(`startMode:${id}`, mode);
  } catch {
    // Kaydedilemezse yalnız bu oturumda hatırlanır.
  }
}

/** Sağ alt: ana eylem (Başlat/Durdur) ve solunda ikincil yuvarlak butonlar. */
export function ActionBar({ instance }: { instance: Instance }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const launch = useAppStore((s) => s.launchResults[instance.id]);
  const setLaunchResult = useAppStore((s) => s.setLaunchResult);
  const control = useServerControl(instance);
  const { status, active } = control;
  const [mode, setMode] = useState<StartMode>(() => loadMode(instance.id));
  const notice = launch ? launchHint(launch, instance.name) : null;

  return (
    <div className={styles.bar}>
      <AnimatePresence>
        {!control.error && notice && (
          <motion.div
            className={styles.error}
            role={notice.tone === "error" ? "alert" : "status"}
            style={notice.tone === "info" ? { background: "var(--surface-2)", color: "var(--text)" } : undefined}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={spring}
          >
            {notice.tone === "error" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
            <span>{notice.text}</span>
            <button type="button" aria-label="Kapat" onClick={() => setLaunchResult(instance.id, null)}>
              <X size={14} />
            </button>
          </motion.div>
        )}
        {control.error && (
          <motion.div
            className={styles.error}
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={spring}
          >
            <AlertTriangle size={16} aria-hidden />
            <span>{control.error}</span>
            <button type="button" aria-label="Kapat" onClick={control.clearError}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.buttons}>
        <IconButton icon={Users} label="Oyuncular" onClick={() => openSheet("players")} />
        <IconButton icon={Settings2} label="Dünya ayarları" onClick={() => openSheet("world")} />
        {instance.loader !== "vanilla" && (
          <IconButton
            icon={instance.loader === "paper" ? Plug : Puzzle}
            label={instance.loader === "paper" ? "Eklentiler" : "Modlar"}
            onClick={() => openSheet("mods")}
          />
        )}
        <IconButton icon={ImageIcon} label="Kapak resmi" onClick={() => openSheet("cover")} />
        <IconButton icon={Wrench} label="Gelişmiş" onClick={() => openSheet("advanced")} />
        {active ? (
          <Button
            variant="secondary"
            size="lg"
            icon={Square}
            loading={status === "stopping"}
            onClick={control.stop}
            className={styles.power}
          >
            {status === "stopping" ? "Kapanıyor" : status === "starting" ? "Açılıyor…" : "Durdur"}
          </Button>
        ) : (
          <SplitButton
            options={START_OPTIONS}
            value={mode}
            loading={control.starting}
            className={styles.power}
            onRun={(m) => {
              setMode(m);
              saveMode(instance.id, m);
              void control.start(m === "join");
            }}
          />
        )}
      </div>
      {control.dialogs}
    </div>
  );
}
