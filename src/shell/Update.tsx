import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Download, RotateCcw, Sparkles, X } from "lucide-react";
import { api, errorMessage, type UpdateView, type WhatsNew } from "../lib/api";
import { useT } from "../i18n";
import { spring } from "../lib/motion";
import { useAppStore } from "../store/appStore";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Markdown } from "../ui/Markdown";
import { Progress } from "../ui/Progress";
import styles from "./Update.module.css";

/** Başlık çubuğunda: güncelleme hazırsa (ya da indirmeyi bekliyorsa) küçük bir hap. */
export function UpdatePill() {
  const update = useAppStore((s) => s.update);
  const openUpdate = useAppStore((s) => s.openUpdate);
  const t = useT().update;
  const state = update?.status.state;
  const shown = state === "ready" || state === "available";
  return (
    <AnimatePresence>
      {shown && (
        <motion.button
          type="button"
          className={styles.pill}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={spring}
          onClick={() => openUpdate(true)}
        >
          <span className={styles.dot} aria-hidden />
          {state === "ready" ? t.ready : t.available}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

/** Açık dünyalar (kendi sunucuların): yeniden başlatınca kapanacaklar. */
function useOpenWorlds() {
  const servers = useAppStore((s) => s.servers);
  return Object.values(servers).filter((r) => r.status === "running" || r.status === "starting").length;
}

/**
 * "Cubby x.y hazır": neler yeni, açık dünya / Minecraft uyarısı, yeniden başlat ya da sonra.
 * Asla kendiliğinden yeniden başlatılmaz; "Sonra" denirse kapatırken kurulur.
 */
export function UpdateDialog() {
  const open = useAppStore((s) => s.updateDialog);
  const openUpdate = useAppStore((s) => s.openUpdate);
  const update = useAppStore((s) => s.update);
  const setUpdate = useAppStore((s) => s.setUpdate);
  const openWorlds = useOpenWorlds();
  const [minecraft, setMinecraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tt = useT();
  const t = tt.update;

  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .updateStatus()
      .then((v) => {
        setUpdate(v);
        setMinecraft(v.minecraftRunning);
      })
      .catch(console.error);
  }, [open, setUpdate]);

  if (!open || !update) return null;
  const s = update.status;
  if (s.state !== "ready" && s.state !== "available" && s.state !== "downloading" && s.state !== "installing" && s.state !== "error")
    return null;
  const version = "version" in s ? s.version : "";
  const notes = "notes" in s ? s.notes : "";
  const close = () => openUpdate(false);
  const risky = openWorlds > 0 || minecraft;

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateInstall();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const download = async () => {
    setError(null);
    try {
      setUpdate(await api.updateDownload());
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      title={version ? t.title(version) : t.titleShort}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy || s.state === "installing"}>
            {t.later}
          </Button>
          {s.state === "ready" && (
            <Button variant="primary" icon={RotateCcw} loading={busy} onClick={install}>
              {risky ? t.closeAndUpdate : t.restart}
            </Button>
          )}
          {s.state === "available" && (
            <Button variant="primary" icon={Download} onClick={download}>
              {t.download}
            </Button>
          )}
        </>
      }
    >
      <p className={styles.current}>{t.from(update.current)}</p>
      {s.state === "downloading" && (
        <div className={styles.progress}>
          <Progress value={s.total ? s.downloaded / s.total : null} />
          <span>{t.downloading}</span>
        </div>
      )}
      {s.state === "installing" && <p className={styles.current}>{t.installing}</p>}
      {notes.trim() && (
        <div className={styles.notes}>
          <h3>{t.whatsNew}</h3>
          <Markdown source={notes} />
        </div>
      )}
      {s.state === "ready" && risky && (
        <p className={styles.warn}>
          <AlertTriangle size={15} aria-hidden />
          {openWorlds > 0 ? t.worldsOpen(openWorlds) : t.minecraftOpen}
        </p>
      )}
      {s.state === "ready" && <p className={styles.hint}>{t.laterHint}</p>}
      {(error ?? (s.state === "error" ? s.message : null)) && (
        <p className={styles.error}>{error ?? (s.state === "error" ? s.message : "")}</p>
      )}
    </Dialog>
  );
}

/** Güncellemeden sonraki ilk açılışta bir kez: "Cubby x.y'ye güncellendi · Neler yeni". */
export function UpdatedToast() {
  const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null);
  const [shown, setShown] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const t = useT().update;

  useEffect(() => {
    api
      .updateWhatsNew()
      .then((w) => {
        if (!w) return;
        setWhatsNew(w);
        setShown(true);
      })
      .catch(console.error);
  }, []);

  // Kendiliğinden kaybolur; notlar açılırsa beklenir.
  useEffect(() => {
    if (!shown || notesOpen) return;
    const timer = setTimeout(() => setShown(false), 9000);
    return () => clearTimeout(timer);
  }, [shown, notesOpen]);

  if (!whatsNew) return null;
  return (
    <>
      <AnimatePresence>
        {shown && (
          <motion.div
            className={styles.toast}
            role="status"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={spring}
          >
            <Sparkles size={16} aria-hidden className={styles.toastIcon} />
            <span>{t.updated(whatsNew.version)}</span>
            {whatsNew.notes.trim() && (
              <button type="button" className={styles.toastLink} onClick={() => setNotesOpen(true)}>
                {t.whatsNew}
              </button>
            )}
            <button type="button" className={styles.toastClose} aria-label={t.dismiss} onClick={() => setShown(false)}>
              <X size={14} aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {notesOpen && (
        <Dialog
          title={t.updated(whatsNew.version)}
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setNotesOpen(false);
                setShown(false);
              }}
            >
              {t.gotIt}
            </Button>
          }
        >
          <div className={styles.notes}>
            <Markdown source={whatsNew.notes} />
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Ayarlar kartının durum satırı. */
export function updateLine(u: UpdateView | null, t: ReturnType<typeof useT>["update"]): string {
  if (!u) return t.checking;
  const s = u.status;
  switch (s.state) {
    case "idle":
    case "upToDate":
      return t.upToDate;
    case "checking":
      return t.checking;
    case "available":
      return t.availableLine(s.version);
    case "downloading":
      return s.total ? t.downloadingLine(s.version, Math.round((s.downloaded / s.total) * 100)) : t.downloadingLine(s.version, null);
    case "ready":
      return t.readyLine(s.version);
    case "installing":
      return t.installing;
    case "error":
      return s.message;
    case "dev":
      return t.dev;
  }
}
