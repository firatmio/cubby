import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, ChevronDown, Copy, Link2, Loader2, RotateCcw } from "lucide-react";
import { api, errorMessage, type AccessView, type InviteLinks, type Route } from "../../lib/api";
import { EVENT_INVITE_SHORT, listen } from "../../lib/events";
import { useT } from "../../i18n";
import { rise, spring } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { CodeDisplay } from "../../ui/CodeCells";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import { useConnection } from "./useConnection";
import { useScrollFade } from "../../ui/useScrollFade";
import styles from "./ConnectionSheet.module.css";

/** "Kopyalandı" bir süre görünür. */
function useCopied<T extends string>() {
  const [copied, setCopied] = useState<T | null>(null);
  const copy = async (what: T, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };
  return [copied, copy] as const;
}

function Address({ address }: { address: string }) {
  const [copied, copy] = useCopied<"address">();
  const tt = useT();
  return (
    <div className={styles.address}>
      <span className={styles.addressText}>{address}</span>
      <IconButton
        icon={copied ? Check : Copy}
        size="sm"
        variant="ghost"
        label={copied ? tt.common.copied : tt.connection.copy}
        onClick={() => copy("address", address)}
      />
    </div>
  );
}

/**
 * Davetin kendisi: arkadaşın kodu Cubby'de Katıl'a yazar ya da linke tıklar; modem ayarı gerekmez.
 * Kod davet sunucusundan alınır; ulaşılamazsa "Tekrar dene".
 */
function Invite({ id }: { id: string }) {
  const replaceInstance = useAppStore((s) => s.replaceInstance);
  const [links, setLinks] = useState<InviteLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, copy] = useCopied<"code" | "link">();
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tt = useT();
  const t = tt.connection;

  const got = useCallback(
    (l: InviteLinks) => {
      setLinks(l);
      // Ana ekrandaki davet kartı da kodu göstersin.
      if (l.short) api.getInstance(id).then(replaceInstance).catch(() => {});
    },
    [id, replaceInstance],
  );

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .createInvite(id)
      .then(got)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id, got]);

  useEffect(() => {
    setLinks(null);
    load();
  }, [load]);

  // Süresi dolmuş kod arkada yenilenirse panel de güncellenir.
  useEffect(() => {
    let off: (() => void) | undefined;
    let live = true;
    void listen<{ id: string; links: InviteLinks }>(EVENT_INVITE_SHORT, (e) => {
      if (e.payload.id === id) got(e.payload.links);
    }).then((u) => (live ? (off = u) : u()));
    return () => {
      live = false;
      off?.();
    };
  }, [id, got]);

  const reset = async () => {
    setError(null);
    try {
      got(await api.resetInvite(id));
      setConfirmReset(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const failed = !loading && !links?.short;

  return (
    <section className={styles.invite}>
      <CodeDisplay code={links?.short ?? null} label={t.inviteCode} />
      <p className={styles.inviteHint}>{failed ? t.shortFailed : t.inviteHint}</p>
      <div className={styles.inviteActions}>
        {failed ? (
          <Button variant="primary" icon={RotateCcw} onClick={load}>
            {t.retryShort}
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              icon={copied === "code" ? Check : Copy}
              disabled={!links?.short}
              onClick={() => links?.short && copy("code", links.short)}
            >
              {copied === "code" ? tt.common.copied : t.copyCode}
            </Button>
            <Button
              icon={copied === "link" ? Check : Link2}
              disabled={!links?.web}
              onClick={() => links?.web && copy("link", links.web)}
            >
              {copied === "link" ? tt.common.copied : t.copyLink}
            </Button>
          </>
        )}
      </div>
      {links?.short && (
        <button type="button" className={styles.quiet} onClick={() => setConfirmReset(true)}>
          <RotateCcw size={13} aria-hidden /> {t.resetInvite}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
      {confirmReset && (
        <Dialog
          title={t.resetInvite}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                {tt.common.cancel}
              </Button>
              <Button variant="danger" onClick={reset}>
                {t.reset}
              </Button>
            </>
          }
        >
          <p>{t.resetText}</p>
        </Dialog>
      )}
    </section>
  );
}

/** Modem üzerinden açılan adres (UPnP) ya da neden açılamadığı. */
function RouterAddress({ route }: { route: Route }) {
  const t = useT().connection;
  if (route.state === "working") {
    return (
      <p className={styles.working}>
        <Loader2 size={15} className={styles.spin} aria-hidden />
        {t.checkingRouter}
      </p>
    );
  }
  if (route.state === "ok" && route.address) {
    return (
      <>
        <Address address={route.address} />
        <p className={styles.hint}>{t.routerHint}</p>
      </>
    );
  }
  if (route.state === "error") {
    return (
      <p className={styles.hint}>
        {route.message} {t.upnpTipBefore}
        <b>UPnP</b>
        {t.upnpTipAfter}
      </p>
    );
  }
  return null;
}

/**
 * Cubby'si olmayan arkadaş için: Minecraft'ta Sunucu Ekle'ye yazılacak adres (aynı ev ya da modem
 * üzerinden internet). Kapalı başlar; internete açıksa açık gelir.
 */
function WithoutCubby({ id }: { id: string }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const setConnection = useAppStore((s) => s.setConnection);
  const { status } = useServer(id);
  const view = useConnection(id);
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<AccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT().connection;

  useEffect(() => {
    if (view?.internet) setOpen(true);
  }, [view?.internet]);

  useEffect(() => {
    if (!open) return;
    api.worldAccess(id).then(setAccess).catch(() => setAccess(null));
  }, [open, id]);

  const setInternet = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setConnection(id, await api.setInternet(id, on));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view) return null;
  const openToEveryone = access && !access.offlineMode && !access.whitelistEnabled;

  return (
    <section className={styles.more}>
      <button type="button" className={styles.moreHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          <b>{t.withoutCubby}</b>
          <span className={styles.hint}>{t.withoutCubbyText}</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring}>
          <ChevronDown size={18} aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.moreBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
          >
            <div className={styles.moreInner}>
              <div className={styles.group}>
                <span className={styles.groupTitle}>{t.sameHome}</span>
                {view.lan ? <Address address={view.lan} /> : <p className={styles.hint}>{t.noLan}</p>}
              </div>

              <div className={styles.group}>
                <Toggle
                  checked={view.internet}
                  onChange={setInternet}
                  disabled={busy}
                  label={t.openInternet}
                  description={t.openInternetText}
                />
                {error && <p className={styles.error}>{error}</p>}
                <AnimatePresence initial={false}>
                  {view.internet && (
                    <motion.div className={styles.group} variants={rise} initial="hidden" animate="show" exit="exit">
                      {status === "running" ? (
                        <RouterAddress route={view.direct} />
                      ) : (
                        <p className={styles.hint}>{t.startToOpen}</p>
                      )}
                      {openToEveryone && (
                        <div className={styles.warn}>
                          <AlertTriangle size={15} aria-hidden />
                          <span>
                            {t.whitelistOff}{" "}
                            <button type="button" className={styles.link} onClick={() => openSheet("players")}>
                              {t.turnOnWhitelist}
                            </button>
                          </span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Arkadaşını davet et: önce kod; Cubby'si olmayanlar için adresler katlanmış altta. */
export function ConnectionSheet() {
  const fade = useScrollFade();
  const open = useAppStore((s) => s.sheet === "connection");
  const openSheet = useAppStore((s) => s.openSheet);
  const instance = useSelected();
  const t = useT().connection;

  return (
    <Sheet open={open && !!instance} title={t.title} subtitle={instance?.name} onClose={() => openSheet(null)}>
      {instance && (
        <div ref={fade} className={styles.scroll}>
          <Invite id={instance.id} />
          <WithoutCubby id={instance.id} />
        </div>
      )}
    </Sheet>
  );
}
