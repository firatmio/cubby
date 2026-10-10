import { motion } from "motion/react";
import type { Instance } from "../../lib/api";
import { kindCaption, relativeTime } from "../../lib/format";
import { rise, stagger } from "../../lib/motion";
import { useServer } from "../../store/appStore";
import { STATUS_LABELS } from "../../ui/Badge";
import { usePlayStats } from "./usePlayStats";
import styles from "./Hero.module.css";

/** Seçili dünyanın kimliği: tür, büyük isim, tek satır durum. Dünya değişince kademeli belirir. */
export function Hero({ instance }: { instance: Instance }) {
  const { status, players } = useServer(instance.id);
  const stats = usePlayStats(instance.id, status);

  const detail =
    status === "running"
      ? players.length > 0
        ? `${players.length} oyuncu bağlı`
        : "Arkadaşın katılabilir"
      : status === "crashed"
        ? "Ayrıntılar Gelişmiş > Konsol'da"
        : status === "stopped" && stats?.lastPlayedAt
          ? `Son oynanma ${relativeTime(stats.lastPlayedAt)}`
          : null;

  return (
    <motion.div className={styles.hero} variants={stagger} initial="hidden" animate="show" exit="exit">
      <motion.p className={styles.caption} variants={rise}>
        {kindCaption(instance)}
      </motion.p>
      <motion.h1 className={styles.name} variants={rise}>
        {instance.name}
      </motion.h1>
      <motion.p className={[styles.status, styles[status]].join(" ")} variants={rise}>
        {STATUS_LABELS[status]}
        {detail && <span className={styles.detail}>{detail}</span>}
      </motion.p>
    </motion.div>
  );
}
