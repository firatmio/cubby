import { useEffect, useState } from "react";
import { Check, Clock, Zap } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useT } from "../../i18n";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Toggle } from "../../ui/Toggle";
import styles from "./WorldSettingsSheet.module.css";

/**
 * Hızlandırıcı: tek anahtar. Açıkken yalnız sunucuda çalışan hızlandırma modları dünya açılırken
 * kurulur (saf dünyada arka planda Fabric); Java ayarları her dünyada açık.
 */
export function BoosterCard({ id, onChanged }: { id: string; onChanged: () => void }) {
  const boost = useAppStore((s) => s.boost[id]);
  const setBoost = useAppStore((s) => s.setBoost);
  const status = useAppStore((s) => s.servers[id]?.status ?? "stopped");
  const [busy, setBusy] = useState<"toggle" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tt = useT();
  const t = tt.perf;
  const running = status === "running";

  useEffect(() => {
    api
      .boostStatus(id)
      .then((b) => setBoost(id, b))
      .catch((e) => setError(errorMessage(e)));
  }, [id, setBoost]);

  if (!boost) return null;

  const toggle = async (on: boolean) => {
    setBusy("toggle");
    setError(null);
    try {
      setBoost(id, await api.boostSet(id, on));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    setBusy("restart");
    setError(null);
    try {
      await api.stopServer(id);
      await api.startServer(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const javaOnly = boost.mode === "javaOnly";
  const waiting = boost.enabled && !javaOnly && !running && boost.mods.some((m) => !m.active);

  return (
    <div className={styles.pregen}>
      {javaOnly ? (
        <div className={styles.pregenHead}>
          <span className={styles.pregenTitle}>
            <Zap size={15} aria-hidden /> {t.boostTitle}
          </span>
          <span className={styles.hint}>{t.boostPaper}</span>
        </div>
      ) : (
        <Toggle
          checked={boost.enabled}
          onChange={toggle}
          disabled={busy !== null}
          label={t.boostTitle}
          description={boost.mode === "vanillaFabric" ? t.boostTextVanilla : t.boostText}
        />
      )}

      {boost.enabled && !javaOnly && boost.mods.length > 0 && (
        <ul className={styles.boostList}>
          {boost.mods.map((m) => (
            <li key={m.title}>
              {m.active ? (
                <Check size={14} className={styles.ok} aria-label={t.boostActive} />
              ) : (
                <Clock size={14} className={styles.hint} aria-label={t.boostWaiting} />
              )}
              <b>{m.title}</b>
              <span className={styles.hint}>{t.role[m.role](boost.threads)}</span>
            </li>
          ))}
        </ul>
      )}
      {waiting && <p className={styles.hint}>{t.boostOnStart}</p>}
      {boost.enabled && !javaOnly && boost.unavailable.length > 0 && (
        <p className={styles.hint}>{t.boostUnavailable(boost.unavailable.join(", "))}</p>
      )}
      {boost.pendingRestart && (
        <div className={styles.row}>
          <span className={styles.hint}>{tt.world.appliesOnRestart}</span>
          <Button size="sm" variant="primary" loading={busy === "restart"} onClick={restart}>
            {tt.world.restartNow}
          </Button>
        </div>
      )}
      {boost.enabled && boost.lastError && <p className={styles.error}>{t.boostError(boost.lastError)}</p>}
      <p className={styles.hint}>{t.boostJava}</p>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
