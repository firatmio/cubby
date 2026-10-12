import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Crown, LogOut, Plus, UserPlus, X } from "lucide-react";
import { api, errorMessage, type AccessView } from "../../lib/api";
import { useT } from "../../i18n";
import { rise } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import styles from "./PlayersSheet.module.css";

function Avatar({ name }: { name: string }) {
  return <span className={styles.avatar}>{name.slice(0, 1).toUpperCase()}</span>;
}

/** Kim oyunda, kim girebilir, kim yetkili. Teknik terimsiz. */
export function PlayersSheet() {
  const open = useAppStore((s) => s.sheet === "players");
  const openSheet = useAppStore((s) => s.openSheet);
  const instance = useSelected();
  const { status, players, rejected } = useServer(instance?.id ?? null);
  const running = status === "running";
  const t = useT().players;

  const [view, setView] = useState<AccessView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  const id = instance?.id;

  const load = useCallback(() => {
    if (!id) return;
    api.worldAccess(id).then(setView).catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (open) {
      setError(null);
      load();
    }
  }, [open, load]);

  const run = async (key: string, fn: () => Promise<AccessView | void>) => {
    setBusy(key);
    setError(null);
    try {
      const v = await fn();
      if (v) setView(v);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const add = (player: string) => id && run(`add:${player}`, () => api.whitelistAdd(id, player));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || !id) return;
    await run("add-input", () => api.whitelistAdd(id, n));
    setName("");
  };

  const isOp = (n: string) => view?.ops.some((o) => o.toLowerCase() === n.toLowerCase()) ?? false;
  const inWhitelist = (n: string) => view?.whitelist.some((p) => p.name.toLowerCase() === n.toLowerCase()) ?? false;
  const suggestions = (view?.known ?? []).filter((n) => !inWhitelist(n));

  return (
    <Sheet
      open={open && !!instance}
      title={t.title}
      subtitle={instance?.name}
      onClose={() => openSheet(null)}
      width={560}
    >
      <div className={styles.scroll}>
        {error && <p className={styles.error}>{error}</p>}
        {view?.notice && <p className={styles.notice}>{view.notice}</p>}

        <AnimatePresence>
          {rejected.length > 0 && (
            <motion.section className={styles.section} variants={rise} initial="hidden" animate="show" exit="exit">
              <h3>{t.triedTitle}</h3>
              <p className={styles.hint}>{t.triedHint}</p>
              {rejected.map((n) => (
                <div key={n} className={[styles.row, styles.attention].join(" ")}>
                  <Avatar name={n} />
                  <span className={styles.name}>{n}</span>
                  <Button size="sm" variant="primary" icon={UserPlus} loading={busy === `add:${n}`} onClick={() => add(n)}>
                    {t.allow}
                  </Button>
                </div>
              ))}
            </motion.section>
          )}
        </AnimatePresence>

        <section className={styles.section}>
          <h3>{t.nowPlaying}</h3>
          {!running ? (
            <p className={styles.hint}>{t.worldOff}</p>
          ) : players.length === 0 ? (
            <p className={styles.hint}>{t.nobody}</p>
          ) : (
            players.map((n) => (
              <div key={n} className={styles.row}>
                <Avatar name={n} />
                <span className={styles.name}>{n}</span>
                {isOp(n) && <Badge>{t.op}</Badge>}
                <IconButton
                  icon={Crown}
                  size="sm"
                  variant="ghost"
                  label={isOp(n) ? t.takeOp : t.makeOp}
                  className={isOp(n) ? styles.crownOn : undefined}
                  disabled={busy !== null}
                  onClick={() => id && run(`op:${n}`, () => api.setOp(id, n, !isOp(n)))}
                />
                <IconButton
                  icon={LogOut}
                  size="sm"
                  variant="ghost"
                  label={t.kick}
                  disabled={busy !== null}
                  onClick={() => id && run(`kick:${n}`, () => api.kickPlayer(id, n))}
                />
              </div>
            ))
          )}
        </section>

        {view && (
          <section className={styles.section}>
            <h3>{t.whoCanJoin}</h3>
            <Toggle
              checked={view.whitelistEnabled}
              disabled={busy !== null || (view.offlineMode && view.whitelistEnabled)}
              onChange={(on) => id && run("toggle", () => api.setWhitelistEnabled(id, on))}
              label={t.whitelistOnly}
              description={view.offlineMode ? t.whitelistForced : view.whitelistEnabled ? t.whitelistOn : t.whitelistOff}
            />

            {view.whitelistEnabled && (
              <>
                <form className={styles.addRow} onSubmit={submit}>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.playerName}
                    maxLength={16}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button type="submit" icon={Plus} loading={busy === "add-input"} disabled={!name.trim()}>
                    {t.add}
                  </Button>
                </form>

                {suggestions.length > 0 && (
                  <div className={styles.chips}>
                    <span className={styles.hint}>{t.seenBefore}</span>
                    {suggestions.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={styles.chip}
                        disabled={busy !== null}
                        onClick={() => add(n)}
                      >
                        <Plus size={12} aria-hidden /> {n}
                      </button>
                    ))}
                  </div>
                )}

                {view.whitelist.length === 0 ? (
                  <p className={styles.warn}>{t.emptyList}</p>
                ) : (
                  view.whitelist.map((p) => (
                    <div key={p.name} className={styles.row}>
                      <Avatar name={p.name} />
                      <span className={styles.name}>{p.name}</span>
                      {isOp(p.name) && <Badge>{t.op}</Badge>}
                      <IconButton
                        icon={Crown}
                        size="sm"
                        variant="ghost"
                        label={isOp(p.name) ? t.takeOp : t.makeOp}
                        className={isOp(p.name) ? styles.crownOn : undefined}
                        disabled={busy !== null}
                        onClick={() => id && run(`op:${p.name}`, () => api.setOp(id, p.name, !isOp(p.name)))}
                      />
                      <IconButton
                        icon={X}
                        size="sm"
                        variant="ghost"
                        label={t.removeFromList}
                        disabled={busy !== null}
                        onClick={() => id && run(`rm:${p.name}`, () => api.whitelistRemove(id, p.name))}
                      />
                    </div>
                  ))
                )}
              </>
            )}
          </section>
        )}

        {view && (
          <section className={styles.section}>
            <p className={styles.hint}>
              {view.offlineMode ? t.offlineOn : t.premiumOnly}{" "}
              <button type="button" className={styles.link} onClick={() => openSheet("world")}>
                {t.changeInWorld}
              </button>
            </p>
          </section>
        )}
      </div>
    </Sheet>
  );
}
