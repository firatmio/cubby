import { useState } from "react";
import { ImageIcon, LogIn, Play, Plug, Puzzle, Settings2, Square, Users, Wrench } from "lucide-react";
import type { Instance } from "../../lib/api";
import { launchHint } from "../../lib/launch";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { SplitButton } from "../../ui/SplitButton";
import { NoticeBar } from "./NoticeBar";
import { useGameNotice, type GameNotice } from "./useGameNotice";
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
  const game = useGameNotice();
  const launchNotice = launch ? launchHint(launch, instance.name) : null;
  // Öncelik: başlatma hatası → oyun (ilerleme/çökme) → Launcher ipucu.
  const shown: GameNotice | null = control.error
    ? { tone: "error", text: control.error, dismiss: control.clearError }
    : (game ??
      (launchNotice && { ...launchNotice, dismiss: () => setLaunchResult(instance.id, null) }));

  return (
    <div className={styles.bar}>
      <NoticeBar notice={shown} />

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
