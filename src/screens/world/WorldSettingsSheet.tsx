import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { api, errorMessage, type AccessView } from "../../lib/api";
import { useT } from "../../i18n";
import { spring } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Field, Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { Sheet } from "../../ui/Sheet";
import { Slider } from "../../ui/Slider";
import { Toggle } from "../../ui/Toggle";
import { useScrollFade } from "../../ui/useScrollFade";
import { PerformanceSection } from "./PerformanceSection";
import styles from "./WorldSettingsSheet.module.css";

type Form = {
  difficulty: string;
  gamemode: string;
  pvp: boolean;
  maxPlayers: number;
  motd: string;
  viewDistance: number;
  simDistance: number;
  port: string;
};


function fromProps(v: Record<string, string>, fallbackMotd: string): Form {
  const int = (k: string, d: number) => {
    const n = parseInt(v[k] ?? "", 10);
    return Number.isFinite(n) ? n : d;
  };
  return {
    difficulty: v["difficulty"] ?? "easy",
    gamemode: v["gamemode"] ?? "survival",
    pvp: (v["pvp"] ?? "true") === "true",
    maxPlayers: int("max-players", 20),
    motd: v["motd"] ?? fallbackMotd,
    viewDistance: int("view-distance", 10),
    simDistance: int("simulation-distance", 10),
    port: v["server-port"] ?? "25565",
  };
}

function toProps(f: Form): Record<string, string> {
  return {
    difficulty: f.difficulty,
    gamemode: f.gamemode,
    pvp: String(f.pvp),
    "max-players": String(f.maxPlayers),
    motd: f.motd,
    "view-distance": String(f.viewDistance),
    "simulation-distance": String(f.simDistance),
    "server-port": f.port.trim(),
  };
}

/** Oyunun kuralları: zorluk, oyun modu, PvP... ve kimlerin girebileceği (premium / TLauncher). */
export function WorldSettingsSheet() {
  const fade = useScrollFade();
  const open = useAppStore((s) => s.sheet === "world");
  const openSheet = useAppStore((s) => s.openSheet);
  const focus = useAppStore((s) => s.worldFocus);
  const clearFocus = useAppStore((s) => s.clearWorldFocus);
  const instance = useSelected();
  const { status } = useServer(instance?.id ?? null);
  const active = status === "starting" || status === "running" || status === "stopping";
  const id = instance?.id;
  const tt = useT();
  const t = tt.world;
  const difficulties = [
    { id: "peaceful", label: t.peaceful },
    { id: "easy", label: t.easy },
    { id: "normal", label: t.normal },
    { id: "hard", label: t.hard },
  ];
  const gamemodes = [
    { id: "survival", label: t.survival },
    { id: "creative", label: t.creative },
    { id: "adventure", label: t.adventure },
  ];

  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [access, setAccess] = useState<AccessView | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "mode" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedWhileRunning, setSavedWhileRunning] = useState(false);

  const load = useCallback(() => {
    if (!id || !instance) return;
    setError(null);
    setSavedWhileRunning(false);
    Promise.all([api.getProperties(id), api.worldAccess(id)])
      .then(([p, a]) => {
        const f = fromProps(p.values, instance.name);
        setInitial(f);
        setForm(f);
        setAccess(a);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const changes = useMemo(() => {
    if (!form || !initial) return {};
    const a = toProps(form);
    const b = toProps(initial);
    return Object.fromEntries(Object.entries(a).filter(([k, v]) => b[k] !== v));
  }, [form, initial]);
  const dirty = Object.keys(changes).length > 0;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  // "Sunucu zorlanıyor" hapından gelindiyse Performans bölümüne kaydır.
  useEffect(() => {
    if (!open || !form || focus !== "performance") return;
    const timer = setTimeout(() => {
      document.getElementById("world-performance")?.scrollIntoView({ behavior: "smooth", block: "start" });
      clearFocus();
    }, 350);
    return () => clearTimeout(timer);
  }, [open, form, focus, clearFocus]);

  const save = async () => {
    if (!id || !form) return;
    setBusy("save");
    setError(null);
    try {
      await api.updateProperties(id, changes);
      setInitial(form);
      setSavedWhileRunning(active);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const setOffline = async (offline: boolean) => {
    if (!id) return;
    setBusy("mode");
    setError(null);
    try {
      setAccess(await api.setOfflineMode(id, offline));
    } catch (e) {
      setError(errorMessage(e));
      api.worldAccess(id).then(setAccess).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const restart = async () => {
    if (!id) return;
    setBusy("restart");
    try {
      await api.stopServer(id);
      await api.startServer(id);
      setSavedWhileRunning(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={open && !!instance}
      title={t.title}
      subtitle={instance?.name}
      onClose={() => openSheet(null)}
      width={560}
    >
      <div ref={fade} className={styles.scroll}>
        {error && <p className={styles.error}>{error}</p>}
        <AnimatePresence>
          {savedWhileRunning && (
            <motion.div
              className={styles.restart}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
            >
              <span>{t.savedRestart}</span>
              <Button size="sm" variant="primary" icon={RotateCcw} loading={busy === "restart"} onClick={restart}>
                {t.restartNow}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {form && (
          <>
            <section className={styles.section}>
              <Field label={t.difficulty}>
                <PillTabs
                  tabs={difficulties}
                  active={form.difficulty}
                  onChange={(v) => set("difficulty", v)}
                />
              </Field>
              <Field label={t.gamemode}>
                <PillTabs
                  tabs={gamemodes}
                  active={form.gamemode}
                  onChange={(v) => set("gamemode", v)}
                />
              </Field>
              <Toggle
                checked={form.pvp}
                onChange={(v) => set("pvp", v)}
                label={t.pvp}
                description={t.pvpText}
              />
              <Slider
                label={t.maxPlayers}
                valueLabel={String(form.maxPlayers)}
                value={form.maxPlayers}
                min={1}
                max={30}
                step={1}
                onChange={(v) => set("maxPlayers", v)}
              />
              <Field label={t.motd}>
                <Input value={form.motd} maxLength={120} onChange={(e) => set("motd", e.target.value)} />
              </Field>
            </section>

            {id && (
              <PerformanceSection
                id={id}
                view={form.viewDistance}
                sim={form.simDistance}
                onPreset={(view, sim) => setForm((f) => (f ? { ...f, viewDistance: view, simDistance: sim } : f))}
              />
            )}

            {access && (
              <section className={styles.section}>
                <Toggle
                  checked={access.offlineMode}
                  disabled={busy !== null || active}
                  onChange={setOffline}
                  label={t.offline}
                  description={active ? t.stopFirst : t.offlineText}
                />
                {access.offlineMode && (
                  <p className={styles.warn}>
                    <AlertTriangle size={15} aria-hidden />
                    {t.offlineWarn}
                  </p>
                )}
              </section>
            )}

            <button type="button" className={styles.disclosure} onClick={() => setAdvancedOpen((v) => !v)}>
              {t.advanced}
              <motion.span animate={{ rotate: advancedOpen ? 180 : 0 }} transition={spring}>
                <ChevronDown size={16} aria-hidden />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {advancedOpen && (
                <motion.section
                  className={styles.advanced}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring}
                >
                  <div className={styles.section}>
                    <Slider
                      label={t.viewDistance}
                      valueLabel={String(form.viewDistance)}
                      value={form.viewDistance}
                      min={2}
                      max={32}
                      step={1}
                      onChange={(v) => set("viewDistance", v)}
                    />
                    <Slider
                      label={t.simDistance}
                      valueLabel={String(form.simDistance)}
                      value={form.simDistance}
                      min={2}
                      max={32}
                      step={1}
                      onChange={(v) => set("simDistance", v)}
                    />
                    <Field label={t.port} hint={t.portHint}>
                      <Input
                        value={form.port}
                        inputMode="numeric"
                        maxLength={5}
                        onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))}
                      />
                    </Field>
                    <p className={styles.hint}>{t.otherSettings}</p>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {form && (
        <footer className={styles.footer}>
          {active && dirty && <span className={styles.hint}>{t.appliesOnRestart}</span>}
          <Button variant="primary" disabled={!dirty} loading={busy === "save"} onClick={save}>
            {tt.common.save}
          </Button>
        </footer>
      )}
    </Sheet>
  );
}
