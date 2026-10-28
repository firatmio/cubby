import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Download, Hourglass, ListPlus, Network, Play, Power, RefreshCw, Send, Square, Trash2 } from "lucide-react";
import { api, errorMessage, type JoinedView, type JoinStatus, type LaunchResult, type SharedProgress } from "../../lib/api";
import { listen } from "../../lib/events";
import { useServer } from "../../store/appStore";
import { getT, useT } from "../../i18n";
import { isModded, kindLabel } from "../../lib/format";
import { launchNotice } from "../../lib/launchNotice";
import { rise, stagger } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import hero from "../home/Hero.module.css";
import { CopyButton, InfoDock, InfoItem } from "../home/InfoCards";
import bar from "../home/ActionBar.module.css";
import { NoticeBar } from "../home/NoticeBar";
import { useGameNotice, type GameNotice } from "../home/useGameNotice";

type State = "running" | "stopped" | "starting" | "crashed";

function describe(s: JoinStatus): { state: State; label: string; detail: string | null } {
  const t = getT().joined;
  const sh = s.shared;
  const st = getT().shared;
  // Ortak dünya: kim açık, kimi bekliyoruz, ben açabilir miyim.
  if (sh?.openByMe) return { state: "running", label: st.stateOpenMine, detail: null };
  if (sh?.openBy && s.running) return { state: "running", label: st.stateOpenBy(sh.openBy), detail: s.path === "relay" ? t.viaRelay : t.direct };
  if (sh?.waitingFor) return { state: "stopped", label: st.stateWaiting(sh.waitingFor), detail: st.waitingDetail };
  if (sh?.member && sh.local && !sh.openBy) return { state: "stopped", label: st.stateCanOpen, detail: null };
  if (s.error) return { state: "crashed", label: t.cantConnect, detail: s.error };
  if (s.reachable === null) return { state: "starting", label: t.checking, detail: null };
  if (!s.reachable) return { state: "stopped", label: t.unreachable, detail: t.friendAppOff };
  if (!s.running) return { state: "stopped", label: t.closed, detail: t.whenFriendOpens };
  return {
    state: "running",
    label: t.open,
    detail: s.path === "relay" ? t.viaRelay : t.direct,
  };
}

/** Arkadaşının dünyası: tür, büyük isim, bağlantı durumu. */
export function JoinedHero({ view }: { view: JoinedView }) {
  const d = describe(view.status);
  const t = useT().joined;
  return (
    <motion.div className={hero.hero} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.p className={hero.caption} variants={rise}>
        {t.caption(kindLabel(view.world.loader), view.world.mcVersion)}
      </motion.p>
      <motion.h1 className={hero.name} variants={rise}>
        {view.world.name}
      </motion.h1>
      <motion.p className={[hero.status, hero[d.state]].join(" ")} variants={rise}>
        {d.label}
        {d.detail && <span className={hero.detail}>{d.detail}</span>}
      </motion.p>
      {view.status.shared?.member && !view.status.shared.local && (
        <motion.p className={hero.detail} variants={rise}>
          <b>{getT().shared.invitedTitle}</b> · {getT().shared.invited}
        </motion.p>
      )}
    </motion.div>
  );
}

function useEntryExists(id: string) {
  const [exists, setExists] = useState<boolean | null>(null);
  const refresh = useCallback(() => {
    api.serverEntryExists(id).then(setExists).catch(() => setExists(null));
  }, [id]);
  useEffect(refresh, [refresh]);
  return [exists, refresh] as const;
}

export function JoinedCards({ view }: { view: JoinedView }) {
  const [exists] = useEntryExists(view.world.id);
  const t = useT();
  const code = view.world.code;
  return (
    <InfoDock>
      <InfoItem
        icon={ListPlus}
        label={t.joined.serverList}
        value={view.world.name}
        hint={exists === false ? t.joined.notInList : t.joined.inListAt(view.address)}
        alert={exists === false}
      />
      {code ? (
        <InfoItem
          icon={Send}
          label={t.home.invite}
          value={code}
          mono
          hint={t.joined.codeHint}
          extra={<CopyButton text={code} label={t.home.copyCode} />}
        />
      ) : (
        <InfoItem
          icon={Network}
          label={t.joined.localAddress}
          value={view.address}
          mono
          hint={t.joined.worksWhileOpen}
          extra={<CopyButton text={view.address} label={t.connection.copy} />}
        />
      )}
    </InfoDock>
  );
}

/** Sağ alt: yenile, listeye yeniden ekle, kaldır; ana buton "Oyna". */
export function JoinedActions({ view }: { view: JoinedView }) {
  const upsertJoined = useAppStore((s) => s.upsertJoined);
  const removeJoinedLocal = useAppStore((s) => s.removeJoinedLocal);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [launch, setLaunch] = useState<LaunchResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const id = view.world.id;
  const t = useT();

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    setLaunch(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const play = () =>
    run("play", async () => {
      setLaunch(await api.playJoined(id));
    });

  // Ortak dünya: davet, kopyanın inişi, "Sen aç".
  const sh = view.status.shared ?? null;
  const st = t.shared;
  const local = useServer(sh?.local ?? null);
  const localActive = local.status === "starting" || local.status === "running" || local.status === "stopping";
  const [progress, setProgress] = useState<number | null>(null);
  const [askDownload, setAskDownload] = useState(false);
  useEffect(() => {
    let off: (() => void) | undefined;
    void listen<SharedProgress>("shared://progress", ({ payload }) => {
      if (payload.id !== id) return;
      setProgress(payload.stage === "done" ? null : payload.total > 0 ? Math.round((payload.done / payload.total) * 100) : 0);
    }).then((u) => (off = u));
    return () => off?.();
  }, [id]);
  const accept = () =>
    run("accept", async () => {
      setAskDownload(false);
      setProgress(0);
      try {
        await api.acceptShared(id);
        upsertJoined(await api.refreshJoined(id));
      } finally {
        setProgress(null);
      }
    });
  const openMine = () =>
    run("open", async () => {
      await api.openShared(id);
      setMessage({ tone: "info", text: st.opening });
    });
  const closeMine = () => sh?.local && run("close", () => api.stopServer(sh.local!));
  const invited = !!sh?.member && !sh.local;
  const canOpen = !!sh?.member && !!sh.local && !sh.openBy && !sh.waitingFor && !view.status.running;

  const game = useGameNotice();
  const shown: GameNotice | null =
    game ??
    (message && { ...message, dismiss: () => setMessage(null) }) ??
    (launch && { ...launchNotice(launch, view.world.name, setLaunch), dismiss: () => setLaunch(null) });

  // Arkadaşın mod ekledi/güncelledi: oyuncunun profilindeki modlar eski kaldı.
  const modsChanged =
    isModded(view.world.loader) &&
    !!view.status.modsRev &&
    !!view.world.modsRev &&
    view.status.modsRev !== view.world.modsRev;

  return (
    <div className={bar.bar}>
      <NoticeBar notice={shown} />

      {modsChanged && (
        <Button
          icon={Download}
          loading={busy === "mods"}
          disabled={busy !== null}
          className={bar.power}
          onClick={() =>
            run("mods", async () => {
              upsertJoined(await api.updateJoinedMods(id));
              setMessage({ tone: "info", text: t.joined.modsSynced });
            })
          }
        >
          {t.joined.modsChanged}
        </Button>
      )}
      {invited ? (
        <Button
          variant="primary"
          size="lg"
          icon={Download}
          loading={busy === "accept" || sh?.syncing}
          onClick={() => setAskDownload(true)}
          className={bar.power}
        >
          {progress !== null ? st.progress(progress) : st.download}
        </Button>
      ) : sh?.waitingFor && !view.status.running ? (
        <Button variant="secondary" size="lg" icon={Hourglass} disabled className={bar.power}>
          {st.waitShort(sh.waitingFor)}
        </Button>
      ) : canOpen && !localActive ? (
        <Button
          variant="primary"
          size="lg"
          icon={Power}
          loading={busy === "open" || sh?.syncing}
          onClick={openMine}
          className={bar.power}
        >
          {progress !== null ? st.progress(progress) : st.youOpen}
        </Button>
      ) : (
        <Button variant="primary" size="lg" icon={Play} loading={busy === "play"} onClick={play} className={bar.power}>
          {t.joined.play}
        </Button>
      )}
      {sh?.local && localActive && (
        <Button variant="secondary" icon={Square} loading={local.status === "stopping" || busy === "close"} onClick={closeMine}>
          {st.closeMine}
        </Button>
      )}
      <div className={bar.buttons}>
        <IconButton
          icon={RefreshCw}
          label={t.joined.refresh}
          disabled={busy !== null}
          onClick={() => run("refresh", async () => upsertJoined(await api.refreshJoined(id)))}
        />
        <IconButton
          icon={ListPlus}
          label={t.joined.readd}
          disabled={busy !== null}
          onClick={() =>
            run("readd", async () => {
              await api.readdServerEntry(id, false);
              setMessage({ tone: "info", text: t.joined.readded });
            })
          }
        />
        <IconButton icon={Trash2} label={t.joined.removeFromList} disabled={busy !== null} onClick={() => setConfirmRemove(true)} />
      </div>

      {askDownload && (
        <Dialog
          title={st.downloadTitle}
          actions={
            <>
              <Button variant="ghost" onClick={() => setAskDownload(false)}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" icon={Download} onClick={accept}>
                {st.download}
              </Button>
            </>
          }
        >
          <p>{st.downloadText}</p>
        </Dialog>
      )}

      {confirmRemove && (
        <Dialog
          title={t.joined.removeTitle}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                {t.common.cancel}
              </Button>
              <Button
                variant="danger"
                loading={busy === "remove"}
                onClick={() =>
                  run("remove", async () => {
                    await api.removeJoined(id);
                    setConfirmRemove(false);
                    removeJoinedLocal(id);
                  })
                }
              >
                {t.common.remove}
              </Button>
            </>
          }
        >
          <p>
            <b>{view.world.name}</b> {t.joined.removeText}
          </p>
        </Dialog>
      )}
    </div>
  );
}
