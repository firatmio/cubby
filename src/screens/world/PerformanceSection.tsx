import { useEffect, useState } from "react";
import { AlertTriangle, Pause, Play, Sparkles, X } from "lucide-react";
import { api, errorMessage, type PerfView, type Pregen } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useT } from "../../i18n";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { Progress } from "../../ui/Progress";
import styles from "./WorldSettingsSheet.module.css";

/** Görüş / simülasyon mesafesi hazır ayarları (chunk). */
export const PRESETS = {
  light: { view: 6, sim: 4 },
  balanced: { view: 8, sim: 6 },
  far: { view: 12, sim: 8 },
} as const;
type Preset = keyof typeof PRESETS | "custom";

export function presetOf(view: number, sim: number): Preset {
  const hit = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find(
    (k) => PRESETS[k].view === view && PRESETS[k].sim === sim,
  );
  return hit ?? "custom";
}

/** Önceden hazırlama yükü sürüyor mu: çalışıyor ya da elle duraklatıldı (oyuncu yüzünden değil). */
export const busyWithPregen = (p: Pregen) => p.state === "running" || (p.state === "paused" && !p.autoPaused);

const RADII = [1000, 2000, 4000] as const;
/** Kaba tahminler: dakikada ~4.000 chunk, chunk başına ~6 KB. */
const estimate = (radius: number) => {
  const side = (radius * 2) / 16;
  const chunks = side * side;
  return { chunks, minutes: Math.max(1, Math.round(chunks / 4000)), mb: Math.round((chunks * 6) / 1024) };
};

type Props = {
  id: string;
  view: number;
  sim: number;
  onPreset: (view: number, sim: number) => void;
};

/**
 * Performans: görüş mesafesi hazır ayarı, dünyayı önceden hazırlama (Chunky) ve sunucu
 * zorlanıyorsa öneriler.
 */
export function PerformanceSection({ id, view, sim, onPreset }: Props) {
  const pregen = useAppStore((s) => s.pregen[id]);
  const health = useAppStore((s) => s.health[id]);
  const setPregen = useAppStore((s) => s.setPregen);
  const setHealth = useAppStore((s) => s.setHealth);
  const status = useAppStore((s) => s.servers[id]?.status ?? "stopped");
  const [perf, setPerf] = useState<PerfView | null>(null);
  const [radius, setRadius] = useState<number>(2000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tt = useT();
  const t = tt.perf;
  const running = status === "running";

  const got = (v: PerfView) => {
    setPerf(v);
    setPregen(id, v.pregen);
    setHealth(id, v.overloaded, v.behindMs);
  };

  useEffect(() => {
    // `got` yalnız store ayarlayıcılarını kullanır; dünya değişince yeniden yüklenir.
    api.perfStatus(id).then(got).catch((e) => setError(errorMessage(e)));
  }, [id]);

  const run = async (key: string, fn: () => Promise<PerfView>) => {
    setBusy(key);
    setError(null);
    try {
      got(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const restart = () =>
    run("restart", async () => {
      await api.stopServer(id);
      await api.startServer(id);
      return api.perfStatus(id);
    });

  const preset = presetOf(view, sim);
  const presets: { id: Preset; label: string }[] = [
    { id: "light", label: t.light },
    { id: "balanced", label: t.balanced },
    { id: "far", label: t.far },
    ...(preset === "custom" ? [{ id: "custom" as const, label: t.custom }] : []),
  ];
  const p = pregen ?? perf?.pregen;
  // Hazırlık sürerken (ya da elle duraklatılmışken) gecikme beklenen yük; uyarı gösterilmez.
  const overloaded = !!health?.overloaded && !(p && busyWithPregen(p));
  const est = estimate(radius);

  return (
    <section className={styles.section} id="world-performance">
      <h3 className={styles.sectionTitle}>{t.title}</h3>

      {overloaded && (
        <div className={styles.warn}>
          <AlertTriangle size={15} aria-hidden />
          <span>
            {t.overloaded(health!.behindMs)}{" "}
            {view > PRESETS.balanced.view && (
              <button type="button" className={styles.link} onClick={() => onPreset(PRESETS.balanced.view, PRESETS.balanced.sim)}>
                {t.useBalanced}
              </button>
            )}
          </span>
        </div>
      )}

      <Field label={t.viewLabel} hint={t.presetHint[preset]}>
        <PillTabs
          tabs={presets}
          active={preset}
          onChange={(k) => k !== "custom" && onPreset(PRESETS[k].view, PRESETS[k].sim)}
          layoutId="perf-preset"
        />
      </Field>

      <div className={styles.pregen}>
        <div className={styles.pregenHead}>
          <span className={styles.pregenTitle}>
            <Sparkles size={15} aria-hidden /> {t.pregenTitle}
          </span>
          <span className={styles.hint}>{t.pregenText}</span>
        </div>

        {perf && !perf.supported ? (
          <p className={styles.hint}>{t.notSupported}</p>
        ) : !p || p.state === "idle" || p.state === "done" ? (
          <>
            {p?.state === "done" && (
              <p className={styles.ok}>{t.done(p.radius, p.doneAt ? formatDate(new Date(p.doneAt).toISOString()) : "")}</p>
            )}
            <PillTabs
              tabs={RADII.map((r) => ({ id: String(r), label: t.radius(r) }))}
              active={String(radius)}
              onChange={(r) => setRadius(Number(r))}
              layoutId="pregen-radius"
            />
            <p className={styles.hint}>{t.estimate(est.chunks, est.minutes, est.mb)}</p>
            <div className={styles.row}>
              <Button size="sm" variant="primary" icon={Play} loading={busy === "start"} onClick={() => run("start", () => api.pregenStart(id, radius))}>
                {p?.state === "done" ? t.again : t.start}
              </Button>
            </div>
          </>
        ) : p.state === "pending" ? (
          <>
            <p className={styles.hint}>{running ? t.pendingRestart : t.pendingStart}</p>
            <div className={styles.row}>
              {running ? (
                <Button size="sm" variant="primary" loading={busy === "restart"} onClick={restart}>
                  {tt.world.restartNow}
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={Play} loading={busy === "server"} onClick={() => run("server", async () => {
                  await api.startServer(id);
                  return api.perfStatus(id);
                })}>
                  {t.startWorld}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={X} onClick={() => run("cancel", () => api.pregenCancel(id))}>
                {tt.common.cancel}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Progress value={p.percent / 100} />
            <p className={styles.hint}>
              {t.progress(Math.floor(p.percent), p.chunks, p.etaSecs)}
              {p.state === "paused" && ` · ${p.autoPaused ? t.autoPaused : t.paused}`}
            </p>
            <div className={styles.row}>
              {p.state === "running" ? (
                <Button size="sm" icon={Pause} loading={busy === "pause"} disabled={!running} onClick={() => run("pause", () => api.pregenPause(id))}>
                  {t.pause}
                </Button>
              ) : (
                <Button size="sm" icon={Play} loading={busy === "resume"} disabled={!running} onClick={() => run("resume", () => api.pregenResume(id))}>
                  {t.resume}
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={X} loading={busy === "cancel"} onClick={() => run("cancel", () => api.pregenCancel(id))}>
                {tt.common.cancel}
              </Button>
            </div>
            {!running && <p className={styles.hint}>{t.whenOpen}</p>}
            <p className={styles.hint}>{t.pausesForPlayers}</p>
          </>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
