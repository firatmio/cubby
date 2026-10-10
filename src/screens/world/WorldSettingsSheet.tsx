import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { api, errorMessage, type AccessView } from "../../lib/api";
import { spring } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Field, Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { Sheet } from "../../ui/Sheet";
import { Slider } from "../../ui/Slider";
import { Toggle } from "../../ui/Toggle";
import styles from "./WorldSettingsSheet.module.css";

type Form = {
  difficulty: string;
  gamemode: string;
  pvp: boolean;
  maxPlayers: number;
  motd: string;
  viewDistance: number;
  port: string;
};

const DIFFICULTIES = [
  { id: "peaceful", label: "Barışçıl" },
  { id: "easy", label: "Kolay" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Zor" },
];

const GAMEMODES = [
  { id: "survival", label: "Hayatta kalma" },
  { id: "creative", label: "Yaratıcı" },
  { id: "adventure", label: "Macera" },
];

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
    "server-port": f.port.trim(),
  };
}

/** Oyunun kuralları: zorluk, oyun modu, PvP... ve kimlerin girebileceği (premium / TLauncher). */
export function WorldSettingsSheet() {
  const open = useAppStore((s) => s.sheet === "world");
  const openSheet = useAppStore((s) => s.openSheet);
  const instance = useSelected();
  const { status } = useServer(instance?.id ?? null);
  const active = status === "starting" || status === "running" || status === "stopping";
  const id = instance?.id;

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
      title="Dünya ayarları"
      subtitle={instance?.name}
      onClose={() => openSheet(null)}
      width={560}
    >
      <div className={styles.scroll}>
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
              <span>Kaydedildi. Dünya yeniden açılınca geçerli olur.</span>
              <Button size="sm" variant="primary" icon={RotateCcw} loading={busy === "restart"} onClick={restart}>
                Şimdi yeniden başlat
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {form && (
          <>
            <section className={styles.section}>
              <Field label="Zorluk">
                <PillTabs
                  tabs={DIFFICULTIES}
                  active={form.difficulty}
                  onChange={(v) => set("difficulty", v)}
                  layoutId="difficulty"
                />
              </Field>
              <Field label="Oyun modu">
                <PillTabs
                  tabs={GAMEMODES}
                  active={form.gamemode}
                  onChange={(v) => set("gamemode", v)}
                  layoutId="gamemode"
                />
              </Field>
              <Toggle
                checked={form.pvp}
                onChange={(v) => set("pvp", v)}
                label="Oyuncular birbirine vurabilsin"
                description="Kapalıyken birbirinize zarar veremezsiniz."
              />
              <Slider
                label="En fazla oyuncu"
                valueLabel={String(form.maxPlayers)}
                value={form.maxPlayers}
                min={1}
                max={30}
                step={1}
                onChange={(v) => set("maxPlayers", v)}
              />
              <Field label="Sunucu listesinde görünen açıklama">
                <Input value={form.motd} maxLength={120} onChange={(e) => set("motd", e.target.value)} />
              </Field>
            </section>

            {access && (
              <section className={styles.section}>
                <Toggle
                  checked={access.offlineMode}
                  disabled={busy !== null || active}
                  onChange={setOffline}
                  label="Premium olmayanlar da girebilsin (TLauncher)"
                  description={
                    active
                      ? "Değiştirmek için önce dünyayı kapat."
                      : "Arkadaşın satın alınmış bir Minecraft hesabı olmadan oynuyorsa aç."
                  }
                />
                {access.offlineMode && (
                  <p className={styles.warn}>
                    <AlertTriangle size={15} aria-hidden />
                    Adresi bilen biri senin ya da arkadaşının adını kullanarak girebilir. Bu yüzden beyaz liste açık
                    tutuluyor; yalnız eklediğin isimler girebilir.
                  </p>
                )}
              </section>
            )}

            <button type="button" className={styles.disclosure} onClick={() => setAdvancedOpen((v) => !v)}>
              Gelişmiş
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
                      label="Görüş mesafesi (chunk)"
                      valueLabel={String(form.viewDistance)}
                      value={form.viewDistance}
                      min={2}
                      max={32}
                      step={1}
                      onChange={(v) => set("viewDistance", v)}
                    />
                    <Field label="Port" hint="Genelde 25565. Aynı anda iki dünya açacaksan farklı olmalı.">
                      <Input
                        value={form.port}
                        inputMode="numeric"
                        maxLength={5}
                        onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))}
                      />
                    </Field>
                    <p className={styles.hint}>Diğer tüm ayarlar Gelişmiş &gt; Tüm ayarlar'da.</p>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {form && (
        <footer className={styles.footer}>
          {active && dirty && <span className={styles.hint}>Yeniden başlatınca geçerli olur</span>}
          <Button variant="primary" disabled={!dirty} loading={busy === "save"} onClick={save}>
            Kaydet
          </Button>
        </footer>
      )}
    </Sheet>
  );
}
