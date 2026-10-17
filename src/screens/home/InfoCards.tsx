import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Check, Clock, Copy, Send, Users, type LucideIcon } from "lucide-react";
import type { Instance } from "../../lib/api";
import { formatDuration, relativeTime } from "../../lib/format";
import { formatCode } from "../../lib/inviteCode";
import { useT } from "../../i18n";
import { rise, stagger } from "../../lib/motion";
import { useAppStore, useServer } from "../../store/appStore";
import { usePlayStats } from "./usePlayStats";
import styles from "./InfoCards.module.css";

type ItemProps = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint: ReactNode;
  /** Uyarı tonunda ipucu (ör. girmeye çalışan oyuncu). */
  alert?: boolean;
  /** Değer kod gibi tek tek okunacaksa. */
  mono?: boolean;
  onClick?: () => void;
  /** Sağda küçük bir eylem (kopyala). */
  extra?: ReactNode;
};

/** Dock'ta bir öğe: ikon, küçük başlık, değer ve ipucu. Tıklanabilirse panel açar. */
export function InfoItem({ icon: Icon, label, value, hint, alert, mono, onClick, extra }: ItemProps) {
  const body = (
    <>
      <span className={styles.icon} aria-hidden>
        <Icon size={17} />
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        <span
          className={[styles.value, mono && styles.mono].filter(Boolean).join(" ")}
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </span>
        <span
          className={[styles.hint, alert && styles.alert].filter(Boolean).join(" ")}
          title={typeof hint === "string" ? hint : undefined}
        >
          {hint}
        </span>
      </span>
    </>
  );
  return (
    <motion.div className={styles.item} variants={rise}>
      {onClick ? (
        <button type="button" className={[styles.main, styles.action].join(" ")} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className={styles.main}>{body}</div>
      )}
      {extra}
    </motion.div>
  );
}

/** Sol alttaki cam şerit: öğeler arasında ince ayraç. */
export function InfoDock({ children }: { children: ReactNode }) {
  return (
    <motion.div className={styles.dock} variants={stagger} initial="hidden" animate="show" exit="exit">
      {children}
    </motion.div>
  );
}

/** Öğenin sağındaki küçük kopyalama düğmesi. */
export function CopyButton({ text, label, onCopied }: { text: string; label: string; onCopied?: (on: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    onCopied?.(true);
    setTimeout(() => {
      setCopied(false);
      onCopied?.(false);
    }, 1600);
  };
  return (
    <button type="button" className={styles.copy} aria-label={label} title={label} onClick={copy}>
      {copied ? <Check size={15} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

/** Seçili dünyanın oyuncuları, davet kodu ve son oynanma. */
export function InfoCards({ instance }: { instance: Instance }) {
  const { status, players, rejected } = useServer(instance.id);
  const stats = usePlayStats(instance.id, status);
  const openSheet = useAppStore((s) => s.openSheet);
  const [copied, setCopied] = useState(false);
  const running = status === "running";
  const tt = useT();
  const t = tt.home;
  const code = instance.shortInvite?.code ? formatCode(instance.shortInvite.code) : null;

  return (
    <InfoDock>
      <InfoItem
        icon={Users}
        label={t.players}
        value={!running ? t.worldOff : players.length === 0 ? t.nobodyYet : players.join(", ")}
        hint={rejected.length > 0 ? t.triedToJoin(rejected[0]) : running ? t.inGame(players.length) : t.manageAccess}
        alert={rejected.length > 0}
        onClick={() => openSheet("players")}
      />
      <InfoItem
        icon={Send}
        label={t.invite}
        value={code ?? t.inviteNoCode}
        mono={!!code}
        hint={copied ? tt.common.copied : code ? t.inviteCardHint : t.inviteCardNoCode}
        onClick={() => openSheet("connection")}
        extra={code && <CopyButton text={code} label={t.copyCode} onCopied={setCopied} />}
      />
      <InfoItem
        icon={Clock}
        label={t.lastPlayedLabel}
        value={running ? t.now : stats?.lastPlayedAt ? relativeTime(stats.lastPlayedAt) : t.neverPlayed}
        hint={running ? t.sessionOn : stats && stats.totalMs > 0 ? t.total(formatDuration(stats.totalMs)) : t.firstAdventure}
      />
    </InfoDock>
  );
}
