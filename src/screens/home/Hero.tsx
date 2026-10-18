import { motion } from "motion/react";
import { AlertTriangle, Sparkles, Zap } from "lucide-react";
import { api, type Instance } from "../../lib/api";
import { kindCaption, relativeTime } from "../../lib/format";
import { rise, stagger } from "../../lib/motion";
import { useAppStore, useServer } from "../../store/appStore";
import { statusLabel } from "../../ui/Badge";
import { Tooltip } from "../../ui/Tooltip";
import { busyWithPregen } from "../world/PerformanceSection";
import { useT } from "../../i18n";
import { usePlayStats } from "./usePlayStats";
import styles from "./Hero.module.css";

/** Seçili dünyanın kimliği: tür, büyük isim, tek satır durum. Dünya değişince kademeli belirir. */
export function Hero({ instance }: { instance: Instance }) {
  const { status, players } = useServer(instance.id);
  const stats = usePlayStats(instance.id, status);
  const pregen = useAppStore((s) => s.pregen[instance.id]);
  const health = useAppStore((s) => s.health[instance.id]);
  const openPerformance = useAppStore((s) => s.openWorldPerformance);
  const boost = useAppStore((s) => s.boost[instance.id]);
  const setBoost = useAppStore((s) => s.setBoost);
  const t = useT().home;
  const live = status === "running";
  const preparing = live && (pregen?.state === "running" || pregen?.state === "paused");
  const overloaded = live && !!health?.overloaded && !(pregen && busyWithPregen(pregen));
  // Hızlandırıcı açıldıktan sonraki ilk açılış çöktü: kapatıp yeniden dene.
  const suspect = status === "crashed" && !!boost?.suspect;
  const retryWithoutBoost = async () => {
    try {
      setBoost(instance.id, await api.boostSet(instance.id, false));
      await api.startServer(instance.id);
    } catch (e) {
      console.error(e);
    }
  };

  const detail =
    status === "running"
      ? players.length > 0
        ? t.playersOnline(players.length)
        : t.friendCanJoin
      : status === "crashed"
        ? t.crashDetails
        : status === "stopped" && stats?.lastPlayedAt
          ? t.lastPlayed(relativeTime(stats.lastPlayedAt))
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
        {statusLabel(status)}
        {detail && <span className={styles.detail}>{detail}</span>}
        {preparing && (
          <button type="button" className={styles.chip} onClick={openPerformance}>
            <Sparkles size={13} aria-hidden />
            {(pregen.state === "paused" ? t.pregenPausedChip : t.pregenChip)(Math.floor(pregen.percent))}
          </button>
        )}
        {suspect && (
          <button type="button" className={[styles.chip, styles.warn].join(" ")} onClick={retryWithoutBoost}>
            <Zap size={13} aria-hidden />
            {t.boostSuspect}
          </button>
        )}
        {overloaded && (
          <Tooltip text={t.overloadedTip(health.behindMs)}>
            <button type="button" className={[styles.chip, styles.warn].join(" ")} onClick={openPerformance}>
              <AlertTriangle size={13} aria-hidden />
              {t.overloadedChip}
            </button>
          </Tooltip>
        )}
      </motion.p>
    </motion.div>
  );
}
