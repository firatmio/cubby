import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, Download, ListPlus, Play, RefreshCw, Trash2 } from "lucide-react";
import { api, errorMessage, type JoinedView, type JoinStatus } from "../../lib/api";
import { getT, useT } from "../../i18n";
import { isModded, kindLabel } from "../../lib/format";
import { launchHint } from "../../lib/launch";
import { rise, stagger } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import hero from "../home/Hero.module.css";
import cards from "../home/InfoCards.module.css";
import bar from "../home/ActionBar.module.css";
import { NoticeBar } from "../home/NoticeBar";
import { useGameNotice, type GameNotice } from "../home/useGameNotice";

type State = "running" | "stopped" | "starting" | "crashed";

function describe(s: JoinStatus): { state: State; label: string; detail: string | null } {
  const t = getT().joined;
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
  const [copied, setCopied] = useState(false);
  const t = useT();
  const copy = async () => {
    await navigator.clipboard.writeText(view.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <motion.div className={cards.cards} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.div className={cards.card} variants={rise}>
        <span className={cards.label}>{t.joined.serverList}</span>
        <span className={cards.value}>{view.world.name}</span>
        <span className={[cards.hint, exists === false && cards.alert].filter(Boolean).join(" ")}>
          {exists === false ? t.joined.notInList : t.joined.inList}
        </span>
      </motion.div>
      <motion.button type="button" className={[cards.card, cards.action].join(" ")} variants={rise} onClick={copy}>
        <span className={cards.label}>{t.joined.localAddress}</span>
        <span className={cards.value}>
          {view.address}
          {copied ? <Check size={15} aria-hidden /> : <Copy size={14} aria-hidden />}
        </span>
        <span className={cards.hint}>{copied ? t.common.copied : t.joined.worksWhileOpen}</span>
      </motion.button>
    </motion.div>
  );
}

/** Sağ alt: yenile, listeye yeniden ekle, kaldır; ana buton "Oyna". */
export function JoinedActions({ view }: { view: JoinedView }) {
  const upsertJoined = useAppStore((s) => s.upsertJoined);
  const removeJoinedLocal = useAppStore((s) => s.removeJoinedLocal);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const id = view.world.id;
  const t = useT();

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
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
      setMessage(launchHint(await api.playJoined(id), view.world.name));
    });

  const game = useGameNotice();
  const shown: GameNotice | null = game ?? (message && { ...message, dismiss: () => setMessage(null) });

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
      <Button variant="primary" size="lg" icon={Play} loading={busy === "play"} onClick={play} className={bar.power}>
        {t.joined.play}
      </Button>
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
