import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy, Globe, Home, Link2, Loader2, RotateCcw, Router, Send } from "lucide-react";
import { api, errorMessage, type AccessView, type InviteLinks, type Route } from "../../lib/api";
import { EVENT_INVITE_SHORT, listen } from "../../lib/events";
import { useT } from "../../i18n";
import { rise } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import { useConnection } from "./useConnection";
import styles from "./ConnectionSheet.module.css";

function Address({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const tt = useT();
  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={styles.address}>
      <span className={styles.addressText}>{address}</span>
      <IconButton
        icon={copied ? Check : Copy}
        size="sm"
        variant="ghost"
        label={copied ? tt.common.copied : tt.connection.copy}
        onClick={copy}
      />
    </div>
  );
}

function Working({ text }: { text: string }) {
  return (
    <p className={styles.working}>
      <Loader2 size={15} className={styles.spin} aria-hidden />
      {text}
    </p>
  );
}

function DirectRoute({ route }: { route: Route }) {
  const t = useT().connection;
  return (
    <div className={styles.route}>
      <div className={styles.routeHead}>
        <Router size={16} aria-hidden />
        <span>{t.viaRouter}</span>
      </div>
      {route.state === "working" && <Working text={t.checkingRouter} />}
      {route.state === "ok" && route.address && (
        <>
          <Address address={route.address} />
          <p className={styles.hint}>{t.routerHint}</p>
        </>
      )}
      {route.state === "error" && (
        <>
          <p className={styles.hint}>{route.message}</p>
          <ul className={styles.options}>
            <li>
              {t.upnpTipBefore}
              <b>UPnP</b>
              {t.upnpTipAfter}
            </li>
            <li>{t.appTip}</li>
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Uygulamadan uygulamaya davet: arkadaşın web linkine tıklar ya da kısa kodu yazar, modem ayarı
 * gerekmez. Kısa kod alınamazsa (davet sunucusuna ulaşılamadı) uzun link ve kod kullanılır.
 */
function InviteSection({ id }: { id: string }) {
  const [links, setLinks] = useState<InviteLinks | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tt = useT();
  const t = tt.connection;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .createInvite(id)
      .then(setLinks)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setLinks(null);
    load();
  }, [load]);

  // Süresi dolmuş kod arkada yenilenirse panel güncellenir.
  useEffect(() => {
    let off: (() => void) | undefined;
    let live = true;
    void listen<{ id: string; links: InviteLinks }>(EVENT_INVITE_SHORT, (e) => {
      if (e.payload.id === id) setLinks(e.payload.links);
    }).then((u) => (live ? (off = u) : u()));
    return () => {
      live = false;
      off?.();
    };
  }, [id]);

  const copy = async (what: "link" | "code") => {
    if (!links) return;
    await navigator.clipboard.writeText(what === "link" ? (links.web ?? links.link) : (links.short ?? links.code));
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const reset = async () => {
    setError(null);
    try {
      setLinks(await api.resetInvite(id));
      setConfirmReset(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className={styles.section}>
      <h3>
        <Send size={17} aria-hidden /> {t.inviteTitle}
        <span className={styles.recommended}>{t.recommended}</span>
      </h3>
      <p className={styles.hint}>{t.inviteText}</p>
      {links?.short && (
        <div className={styles.inviteCode}>
          <span>{t.inviteCode}</span>
          <b>{links.short}</b>
        </div>
      )}
      <div className={styles.buttons}>
        <Button size="sm" variant="primary" icon={copied === "link" ? Check : Link2} disabled={!links} onClick={() => copy("link")}>
          {copied === "link" ? tt.common.copied : t.copyLink}
        </Button>
        <Button size="sm" icon={copied === "code" ? Check : Copy} disabled={!links} onClick={() => copy("code")}>
          {copied === "code" ? tt.common.copied : t.copyCode}
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!links} onClick={() => setConfirmReset(true)}>
          {t.resetInvite}
        </Button>
      </div>
      {links && !links.short && !loading && (
        <p className={styles.shortFailed}>
          <AlertTriangle size={15} aria-hidden /> {t.shortFailed}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={load}>
            {t.retryShort}
          </Button>
        </p>
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

/** Arkadaşın nasıl girer: aynı evden (LAN) ya da internetten (modem üzerinden). */
export function ConnectionSheet() {
  const open = useAppStore((s) => s.sheet === "connection");
  const openSheet = useAppStore((s) => s.openSheet);
  const setConnection = useAppStore((s) => s.setConnection);
  const instance = useSelected();
  const { status } = useServer(instance?.id ?? null);
  const view = useConnection(open ? (instance?.id ?? null) : null);
  const [access, setAccess] = useState<AccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = status === "running";
  const id = instance?.id;
  const t = useT().connection;

  useEffect(() => {
    if (!open || !id) return;
    setError(null);
    api.worldAccess(id).then(setAccess).catch(() => setAccess(null));
  }, [open, id]);

  const setInternet = async (on: boolean) => {
    if (!id) return;
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

  const openToEveryone = access && !access.offlineMode && !access.whitelistEnabled;

  return (
    <Sheet open={open && !!instance} title={t.title} subtitle={instance?.name} onClose={() => openSheet(null)}>
      {view && (
        <div className={styles.scroll}>
          {id && <InviteSection id={id} />}

          <section className={styles.section}>
            <h3>
              <Home size={17} aria-hidden /> {t.sameHome}
            </h3>
            {view.lan ? <Address address={view.lan} /> : <p className={styles.hint}>{t.noLan}</p>}
            <p className={styles.hint}>{t.lanHint}</p>
          </section>

          <section className={styles.section}>
            <h3>
              <Globe size={17} aria-hidden /> {t.internet}
            </h3>
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
                <motion.div
                  className={styles.routes}
                  variants={rise}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                >
                  {running ? (
                    <DirectRoute route={view.direct} />
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
          </section>
        </div>
      )}
    </Sheet>
  );
}
