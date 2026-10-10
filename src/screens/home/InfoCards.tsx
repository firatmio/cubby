import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { api, type Instance } from "../../lib/api";
import { formatDuration, relativeTime } from "../../lib/format";
import { rise, stagger } from "../../lib/motion";
import { useAppStore, useServer } from "../../store/appStore";
import { usePlayStats } from "./usePlayStats";
import styles from "./InfoCards.module.css";

function InviteCard({ id }: { id: string }) {
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.lanAddress(id).then(setAddress).catch(() => setAddress(null));
  }, [id]);

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <motion.button type="button" className={[styles.card, styles.action].join(" ")} variants={rise} onClick={copy}>
      <span className={styles.label}>Arkadaşını davet et</span>
      <span className={styles.value}>
        {address ?? "Adres bulunamadı"}
        {address && (copied ? <Check size={15} aria-hidden /> : <Copy size={14} aria-hidden />)}
      </span>
      <span className={styles.hint}>{copied ? "Kopyalandı" : "Aynı evdeyseniz bu adresle girer"}</span>
    </motion.button>
  );
}

/** Sol alt: okunur ama ana eylem olmayan bilgiler. */
export function InfoCards({ instance }: { instance: Instance }) {
  const { status, players, rejected } = useServer(instance.id);
  const stats = usePlayStats(instance.id, status);
  const openSheet = useAppStore((s) => s.openSheet);
  const running = status === "running";

  return (
    <motion.div className={styles.cards} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.button
        type="button"
        className={[styles.card, styles.action].join(" ")}
        variants={rise}
        onClick={() => openSheet("players")}
      >
        <span className={styles.label}>Oyuncular</span>
        <span className={styles.value}>
          {!running ? "Dünya kapalı" : players.length === 0 ? "Henüz kimse yok" : players.join(", ")}
        </span>
        {rejected.length > 0 ? (
          <span className={[styles.hint, styles.alert].join(" ")}>{rejected[0]} girmeye çalıştı · izin ver</span>
        ) : (
          <span className={styles.hint}>{running ? `${players.length} kişi oyunda` : "Kimlerin girebileceğini yönet"}</span>
        )}
      </motion.button>

      <InviteCard id={instance.id} />

      <motion.div className={styles.card} variants={rise}>
        <span className={styles.label}>Son oynanma</span>
        <span className={styles.value}>
          {running ? "Şu an" : stats?.lastPlayedAt ? relativeTime(stats.lastPlayedAt) : "Henüz oynanmadı"}
        </span>
        <span className={styles.hint}>
          {running
            ? "Oturum sürüyor"
            : stats && stats.totalMs > 0
              ? `Toplam ${formatDuration(stats.totalMs)}`
              : "İlk macera seni bekliyor"}
        </span>
      </motion.div>
    </motion.div>
  );
}
