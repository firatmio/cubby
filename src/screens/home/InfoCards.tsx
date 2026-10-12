import { useState } from "react";
import { motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import type { Instance } from "../../lib/api";
import { formatDuration, relativeTime } from "../../lib/format";
import { useT } from "../../i18n";
import { rise, stagger } from "../../lib/motion";
import { useAppStore, useServer } from "../../store/appStore";
import { bestInvite, useConnection } from "../connection/useConnection";
import { usePlayStats } from "./usePlayStats";
import styles from "./InfoCards.module.css";

function InviteCard({ id }: { id: string }) {
  const openSheet = useAppStore((s) => s.openSheet);
  const invite = bestInvite(useConnection(id));
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <motion.div className={styles.slot} variants={rise}>
      <button type="button" className={[styles.card, styles.action].join(" ")} onClick={() => openSheet("connection")}>
        <span className={styles.label}>{t.home.invite}</span>
        <span className={[styles.value, styles.withCopy].join(" ")}>{invite?.address ?? t.home.noAddress}</span>
        <span className={styles.hint}>
          {copied ? t.common.copied : invite?.internet ? t.home.viaInternet : t.home.viaLan}
        </span>
      </button>
      {invite && (
        <button type="button" className={styles.copy} aria-label={t.home.copyAddress} onClick={copy}>
          {copied ? <Check size={15} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
      )}
    </motion.div>
  );
}

/** Sol alt: okunur ama ana eylem olmayan bilgiler. */
export function InfoCards({ instance }: { instance: Instance }) {
  const { status, players, rejected } = useServer(instance.id);
  const stats = usePlayStats(instance.id, status);
  const openSheet = useAppStore((s) => s.openSheet);
  const running = status === "running";
  const t = useT().home;

  return (
    <motion.div className={styles.cards} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.button
        type="button"
        className={[styles.card, styles.action].join(" ")}
        variants={rise}
        onClick={() => openSheet("players")}
      >
        <span className={styles.label}>{t.players}</span>
        <span className={styles.value}>
          {!running ? t.worldOff : players.length === 0 ? t.nobodyYet : players.join(", ")}
        </span>
        {rejected.length > 0 ? (
          <span className={[styles.hint, styles.alert].join(" ")}>{t.triedToJoin(rejected[0])}</span>
        ) : (
          <span className={styles.hint}>{running ? t.inGame(players.length) : t.manageAccess}</span>
        )}
      </motion.button>

      <InviteCard id={instance.id} />

      <motion.div className={styles.card} variants={rise}>
        <span className={styles.label}>{t.lastPlayedLabel}</span>
        <span className={styles.value}>
          {running ? t.now : stats?.lastPlayedAt ? relativeTime(stats.lastPlayedAt) : t.neverPlayed}
        </span>
        <span className={styles.hint}>
          {running ? t.sessionOn : stats && stats.totalMs > 0 ? t.total(formatDuration(stats.totalMs)) : t.firstAdventure}
        </span>
      </motion.div>
    </motion.div>
  );
}
