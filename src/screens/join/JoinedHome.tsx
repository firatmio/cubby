import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy, Download, Info, ListPlus, Play, RefreshCw, Trash2, X } from "lucide-react";
import { api, errorMessage, type JoinedView, type JoinStatus } from "../../lib/api";
import { KIND_LABELS, isModded } from "../../lib/format";
import { launchHint } from "../../lib/launch";
import { rise, spring, stagger } from "../../lib/motion";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import hero from "../home/Hero.module.css";
import cards from "../home/InfoCards.module.css";
import bar from "../home/ActionBar.module.css";

type State = "running" | "stopped" | "starting" | "crashed";

function describe(s: JoinStatus): { state: State; label: string; detail: string | null } {
  if (s.error) return { state: "crashed", label: "Bağlanılamıyor", detail: s.error };
  if (s.reachable === null) return { state: "starting", label: "Kontrol ediliyor", detail: null };
  if (!s.reachable) return { state: "stopped", label: "Ulaşılamıyor", detail: "Arkadaşının uygulaması kapalı olabilir" };
  if (!s.running) return { state: "stopped", label: "Kapalı", detail: "Arkadaşın dünyayı açınca girebilirsin" };
  return {
    state: "running",
    label: "Açık",
    detail: s.path === "relay" ? "Aracı sunucu üzerinden bağlı" : "Doğrudan bağlı",
  };
}

/** Arkadaşının dünyası: tür, büyük isim, bağlantı durumu. */
export function JoinedHero({ view }: { view: JoinedView }) {
  const d = describe(view.status);
  return (
    <motion.div className={hero.hero} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.p className={hero.caption} variants={rise}>
        Arkadaşının dünyası · {KIND_LABELS[view.world.loader]} · Minecraft {view.world.mcVersion}
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
  const copy = async () => {
    await navigator.clipboard.writeText(view.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <motion.div className={cards.cards} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.div className={cards.card} variants={rise}>
        <span className={cards.label}>Minecraft › Çok Oyunculu</span>
        <span className={cards.value}>{view.world.name}</span>
        <span className={[cards.hint, exists === false && cards.alert].filter(Boolean).join(" ")}>
          {exists === false ? "Listede yok · sağ alttan yeniden ekle" : "Sunucu listesinde hazır"}
        </span>
      </motion.div>
      <motion.button type="button" className={[cards.card, cards.action].join(" ")} variants={rise} onClick={copy}>
        <span className={cards.label}>Bu bilgisayardaki adres</span>
        <span className={cards.value}>
          {view.address}
          {copied ? <Check size={15} aria-hidden /> : <Copy size={14} aria-hidden />}
        </span>
        <span className={cards.hint}>{copied ? "Kopyalandı" : "Uygulama açıkken çalışır"}</span>
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

  // Arkadaşın mod ekledi/güncelledi: oyuncunun profilindeki modlar eski kaldı.
  const modsChanged =
    isModded(view.world.loader) &&
    !!view.status.modsRev &&
    !!view.world.modsRev &&
    view.status.modsRev !== view.world.modsRev;

  return (
    <div className={bar.bar}>
      <AnimatePresence>
        {message && (
          <motion.div
            className={bar.error}
            role={message.tone === "error" ? "alert" : "status"}
            style={message.tone === "info" ? { background: "var(--surface-2)", color: "var(--text)" } : undefined}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={spring}
          >
            {message.tone === "error" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
            <span>{message.text}</span>
            <button type="button" aria-label="Kapat" onClick={() => setMessage(null)}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={bar.buttons}>
        <IconButton
          icon={RefreshCw}
          label="Bağlantıyı yenile"
          disabled={busy !== null}
          onClick={() => run("refresh", async () => upsertJoined(await api.refreshJoined(id)))}
        />
        <IconButton
          icon={ListPlus}
          label="Sunucu listesine yeniden ekle"
          disabled={busy !== null}
          onClick={() =>
            run("readd", async () => {
              await api.readdServerEntry(id, false);
              setMessage({ tone: "info", text: "Minecraft'ın sunucu listesine eklendi." });
            })
          }
        />
        <IconButton icon={Trash2} label="Listemden kaldır" disabled={busy !== null} onClick={() => setConfirmRemove(true)} />
        {modsChanged && (
          <Button
            icon={Download}
            loading={busy === "mods"}
            disabled={busy !== null}
            onClick={() =>
              run("mods", async () => {
                upsertJoined(await api.updateJoinedMods(id));
                setMessage({ tone: "info", text: "Modlar arkadaşınınkiyle aynı oldu." });
              })
            }
          >
            Arkadaşın modları değiştirdi · Güncelle
          </Button>
        )}
        <Button variant="primary" size="lg" icon={Play} loading={busy === "play"} onClick={play} className={bar.power}>
          Oyna
        </Button>
      </div>

      {confirmRemove && (
        <Dialog
          title="Dünyayı kaldır"
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                Vazgeç
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
                Kaldır
              </Button>
            </>
          }
        >
          <p>
            <b>{view.world.name}</b> listenden ve Minecraft'ın sunucu listesinden kaldırılacak. Arkadaşının dünyası etkilenmez;
            tekrar katılmak için davet linkini yeniden açman yeterli.
          </p>
        </Dialog>
      )}
    </div>
  );
}
