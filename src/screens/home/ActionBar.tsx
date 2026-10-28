import { useState } from "react";
import { Hourglass, ImageIcon, LogIn, Play, Settings2, Square, Users, Wrench } from "lucide-react";
import { api, errorMessage, type Instance } from "../../lib/api";
import { useT } from "../../i18n";
import { launchNotice } from "../../lib/launchNotice";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { SplitButton } from "../../ui/SplitButton";
import { NoticeBar } from "./NoticeBar";
import { useGameNotice, type GameNotice } from "./useGameNotice";
import { useServerControl } from "./useServerControl";
import { useSharedView } from "../players/SharedCard";
import styles from "./ActionBar.module.css";

type StartMode = "start" | "join";


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

/** Sağ alt: üstte ana eylem (Başlat/Durdur), altında ikincil yuvarlak butonlar. Dar kalsın ki
 *  soldaki bilgi kartları sıkışmasın. */
export function ActionBar({ instance }: { instance: Instance }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const t = useT().home;
  const startOptions = [
    { id: "join" as const, label: t.startAndJoin, icon: LogIn },
    { id: "start" as const, label: t.start, icon: Play },
  ];
  const launch = useAppStore((s) => s.launchResults[instance.id]);
  const setLaunchResult = useAppStore((s) => s.setLaunchResult);
  const control = useServerControl(instance);
  const { status, active } = control;
  const [mode, setMode] = useState<StartMode>(() => loadMode(instance.id));
  const game = useGameNotice();
  // Ortak dünya başka bir arkadaşta açıksa burada açılmaz; ona katılınır.
  const [shared] = useSharedView(instance);
  const sharedT = useT().shared;
  const elsewhere = !active && shared?.enabled && shared.openBy && !shared.openByMe ? shared.openBy : null;
  const waiting = !active && shared?.enabled && !shared.openBy ? shared.waitingFor : null;
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinElsewhere = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const jid = await api.joinOwnShared(instance.id);
      setLaunchResult(instance.id, await api.playJoined(jid));
    } catch (e) {
      setJoinError(errorMessage(e));
    } finally {
      setJoining(false);
    }
  };
  const notice = launch ? launchNotice(launch, instance.name, (r) => setLaunchResult(instance.id, r)) : null;
  // Öncelik: başlatma hatası → oyun (ilerleme/çökme) → Launcher ipucu.
  const shown: GameNotice | null = control.error
    ? { tone: "error", text: control.error, dismiss: control.clearError }
    : joinError
      ? { tone: "error", text: joinError, dismiss: () => setJoinError(null) }
    : (game ??
      (notice && { ...notice, dismiss: () => setLaunchResult(instance.id, null) }));

  return (
    <div className={styles.bar}>
      <NoticeBar notice={shown} />

      {elsewhere ? (
        <Button variant="primary" size="lg" icon={LogIn} loading={joining} onClick={joinElsewhere} className={styles.power}>
          {sharedT.joinOpen(elsewhere)}
        </Button>
      ) : waiting ? (
        <Button variant="secondary" size="lg" icon={Hourglass} disabled className={styles.power}>
          {sharedT.waitShort(waiting)}
        </Button>
      ) : active ? (
        <Button
          variant="secondary"
          size="lg"
          icon={Square}
          loading={status === "stopping"}
          onClick={control.stop}
          className={styles.power}
        >
          {status === "stopping" ? t.stopping : status === "starting" ? t.starting : t.stop}
        </Button>
      ) : (
        <SplitButton
          options={startOptions}
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
      <div className={styles.buttons}>
        <IconButton icon={Users} label={t.players} onClick={() => openSheet("players")} />
        <IconButton icon={Settings2} label={t.worldSettings} onClick={() => openSheet("world")} />
        <IconButton icon={ImageIcon} label={t.cover} onClick={() => openSheet("cover")} />
        <IconButton icon={Wrench} label={t.advanced} onClick={() => openSheet("advanced")} />
      </div>
      {control.dialogs}
    </div>
  );
}
