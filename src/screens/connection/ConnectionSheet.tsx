import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy, Globe, Home, Link2, Loader2, RotateCcw, Router, Send } from "lucide-react";
import { api, errorMessage, type AccessView, type InviteLinks, type Route } from "../../lib/api";
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
        label={copied ? "Kopyalandı" : "Kopyala"}
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
  return (
    <div className={styles.route}>
      <div className={styles.routeHead}>
        <Router size={16} aria-hidden />
        <span>Modem üzerinden</span>
      </div>
      {route.state === "working" && <Working text="Modem kontrol ediliyor…" />}
      {route.state === "ok" && route.address && (
        <>
          <Address address={route.address} />
          <p className={styles.hint}>
            Arkadaşın Çok Oyunculu › Sunucu Ekle'ye bunu yazar. Ev IP'n değişirse (ör. modem yeniden başlayınca) adres de
            değişir.
          </p>
        </>
      )}
      {route.state === "error" && (
        <>
          <p className={styles.hint}>{route.message}</p>
          <ul className={styles.options}>
            <li>
              Modeminin yönetim sayfasında (genelde 192.168.0.1 ya da 192.168.1.1) <b>UPnP</b>'yi açıp dünyayı yeniden
              başlatırsan bu yol çalışır.
            </li>
            <li>
              Ya da arkadaşın da bu uygulamayı kursun: yukarıdaki davet linkiyle modem ayarına gerek kalmadan girer.
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

/** Uygulamadan uygulamaya davet: arkadaşın linke tıklar, modem ayarı gerekmez. */
function InviteSection({ id }: { id: string }) {
  const [links, setLinks] = useState<InviteLinks | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLinks(null);
    api.createInvite(id).then(setLinks).catch((e) => setError(errorMessage(e)));
  }, [id]);

  const copy = async (what: "link" | "code") => {
    if (!links) return;
    await navigator.clipboard.writeText(what === "link" ? links.link : links.code);
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
        <Send size={17} aria-hidden /> Uygulamayla davet et
        <span className={styles.recommended}>Önerilen</span>
      </h3>
      <p className={styles.hint}>
        Arkadaşın bu uygulamayı kurup linke tıklar; modem ayarı gerekmez ve dünyan Minecraft'taki sunucu listesine
        kendiliğinden eklenir. Bağlantı mümkünse doğrudan kurulur.
      </p>
      <div className={styles.buttons}>
        <Button size="sm" variant="primary" icon={copied === "link" ? Check : Link2} disabled={!links} onClick={() => copy("link")}>
          {copied === "link" ? "Kopyalandı" : "Linki kopyala"}
        </Button>
        <Button size="sm" icon={copied === "code" ? Check : Copy} disabled={!links} onClick={() => copy("code")}>
          {copied === "code" ? "Kopyalandı" : "Kodu kopyala"}
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={!links} onClick={() => setConfirmReset(true)}>
          Daveti yenile
        </Button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {confirmReset && (
        <Dialog
          title="Daveti yenile"
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                Vazgeç
              </Button>
              <Button variant="danger" onClick={reset}>
                Yenile
              </Button>
            </>
          }
        >
          <p>
            Daha önce gönderdiğin linkler ve kodlar çalışmaz olur; bu dünyaya katılmış olanlar da giremez. Girmesini
            istediklerine yeni linki göndermen gerekir.
          </p>
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
    <Sheet open={open && !!instance} title="Bağlantı" subtitle={instance?.name} onClose={() => openSheet(null)}>
      {view && (
        <div className={styles.scroll}>
          {id && <InviteSection id={id} />}

          <section className={styles.section}>
            <h3>
              <Home size={17} aria-hidden /> Aynı evdeyseniz
            </h3>
            {view.lan ? <Address address={view.lan} /> : <p className={styles.hint}>Yerel ağ adresi bulunamadı.</p>}
            <p className={styles.hint}>Aynı modeme bağlı arkadaşın Minecraft'ta Çok Oyunculu › Sunucu Ekle'ye bunu yazar.</p>
          </section>

          <section className={styles.section}>
            <h3>
              <Globe size={17} aria-hidden /> İnternetten
            </h3>
            <Toggle
              checked={view.internet}
              onChange={setInternet}
              disabled={busy}
              label="İnternete aç"
              description="Arkadaşın başka bir evden de girebilsin."
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
                    <p className={styles.hint}>Dünyayı başlattığında modemde port açılır ve adres burada görünür.</p>
                  )}

                  {openToEveryone && (
                    <div className={styles.warn}>
                      <AlertTriangle size={15} aria-hidden />
                      <span>
                        Beyaz liste kapalı: adresi bilen her premium oyuncu girebilir.{" "}
                        <button type="button" className={styles.link} onClick={() => openSheet("players")}>
                          Beyaz listeyi aç
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
