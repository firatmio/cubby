import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Copy, Globe, Home, Loader2, Router } from "lucide-react";
import { api, errorMessage, type AccessView, type Route } from "../../lib/api";
import { rise } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
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
              Yakında: arkadaşın da bu uygulamayı kurarsa modem ayarına gerek kalmadan doğrudan bağlanabileceksiniz.
            </li>
          </ul>
        </>
      )}
    </div>
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
