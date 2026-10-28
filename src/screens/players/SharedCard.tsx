import { useEffect, useState } from "react";
import { api, errorMessage, type Instance, type SharedView } from "../../lib/api";
import { useT } from "../../i18n";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Toggle } from "../../ui/Toggle";
import styles from "./PlayersSheet.module.css";

/** Ortak dünyanın son durumu; 20 sn'de bir tazelenir (ortak değilse ağa gitmez, yalnız yerel kayıt). */
export function useSharedView(instance: Instance | null | undefined) {
  const [view, setView] = useState<SharedView | null>(null);
  const id = instance?.id;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      api
        .sharedView(id)
        .then((v) => alive && setView(v))
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id]);
  return [view, setView] as const;
}

/** Oyuncular panelinde: dünyayı ortak yap, arkadaşlardan kimler açabilir, şu an kimde. */
export function SharedCard({ instance }: { instance: Instance }) {
  const all = useT();
  const t = all.shared;
  const [view, setView] = useSharedView(instance);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askForce, setAskForce] = useState(false);
  if (instance.shared?.role === "member") return null;

  const run = async (key: string, fn: () => Promise<SharedView>) => {
    setBusy(key);
    setError(null);
    try {
      setView(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const enabled = view?.enabled ?? !!instance.shared;
  const members = (view?.friends ?? []).filter((f) => f.member).map((f) => f.device);
  const setMember = (device: string, on: boolean) =>
    run(`m:${device}`, () =>
      api.setShared(instance.id, on ? [...members, device] : members.filter((d) => d !== device)),
    );

  const status = !view
    ? null
    : view.openByMe
      ? t.openByMe
      : view.openBy
        ? t.openBy(view.openBy)
        : t.closed;

  return (
    <section className={styles.section}>
      <h3>{t.title}</h3>
      <Toggle
        checked={enabled}
        disabled={busy !== null}
        onChange={(on) => run("toggle", () => (on ? api.setShared(instance.id, members) : api.disableShared(instance.id)))}
        label={t.toggle}
        description={enabled ? t.on : t.off}
      />
      {error && <p className={styles.error}>{error}</p>}
      {enabled && view && (
        <>
          {status && <p className={styles.hint}>{status}</p>}
          {view.waitingFor && (
            <div className={[styles.row, styles.attention, styles.wrapRow].join(" ")}>
              <span className={styles.wrapText}>{t.waiting(view.waitingFor)}</span>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setAskForce(true)}>
                {t.force}
              </Button>
            </div>
          )}
          <h4 className={styles.subhead}>{t.friendsTitle}</h4>
          {view.friends.length === 0 ? (
            <p className={styles.hint}>{t.noFriends}</p>
          ) : (
            view.friends.map((f) => (
              <Toggle
                key={f.device}
                checked={f.member}
                disabled={busy !== null}
                onChange={(on) => void setMember(f.device, on)}
                label={f.name || "?"}
                description={f.member ? t.canOpen : undefined}
              />
            ))
          )}
        </>
      )}
      {askForce && view?.waitingFor && (
        <Dialog
          title={t.forceTitle}
          actions={
            <>
              <Button variant="ghost" onClick={() => setAskForce(false)}>
                {all.common.cancel}
              </Button>
              <Button
                variant="danger"
                loading={busy === "force"}
                onClick={() => run("force", () => api.forceShared(instance.id)).then(() => setAskForce(false))}
              >
                {t.forceOk}
              </Button>
            </>
          }
        >
          <p>{t.forceText(view.waitingFor)}</p>
        </Dialog>
      )}
    </section>
  );
}
