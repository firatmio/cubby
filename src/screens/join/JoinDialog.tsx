import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { api, errorMessage, type InvitePreview, type JoinStatus, type ModItem } from "../../lib/api";
import { getT, useT } from "../../i18n";
import { LOADER_LABELS, formatBytesMb, isModded, kindLabel } from "../../lib/format";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Progress } from "../../ui/Progress";
import { Toggle } from "../../ui/Toggle";
import styles from "./JoinDialog.module.css";

function hostLine(s: JoinStatus): { ok: boolean; text: string } {
  const t = getT().join;
  if (s.error) return { ok: false, text: s.error };
  if (s.reachable === false) return { ok: false, text: t.unreachable };
  if (!s.running) return { ok: true, text: t.worldClosed };
  return { ok: true, text: s.path === "relay" ? t.openRelay : t.openDirect };
}

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? styles.ok : styles.warn}>
      {ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
      <span>{children}</span>
    </li>
  );
}

function ModList({ items }: { items: ModItem[] }) {
  return (
    <ul className={styles.mods}>
      {items.map((m) => (
        <li key={m.title}>
          {m.title}
          <span>{formatBytesMb(m.size)} MB</span>
        </li>
      ))}
    </ul>
  );
}

/** Davet kodu/linkiyle katılma: önce ne yapılacağını gösterir, onay olmadan hiçbir dosyaya dokunmaz. */
export function JoinDialog() {
  const initial = useAppStore((s) => s.joinDialog);
  const openJoin = useAppStore((s) => s.openJoin);
  const upsertJoined = useAppStore((s) => s.upsertJoined);
  const openSheet = useAppStore((s) => s.openSheet);

  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withRecommended, setWithRecommended] = useState(true);
  const progress = useAppStore((s) => s.joinProgress);
  const setJoinProgress = useAppStore((s) => s.setJoinProgress);
  const tt = useT();
  const t = tt.join;

  const check = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.previewInvite(value));
    } catch (e) {
      setPreview(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initial === null) return;
    setCode(initial);
    setPreview(null);
    setError(null);
    if (initial) void check(initial);
  }, [initial, check]);

  if (initial === null) return null;
  const close = () => openJoin(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      setJoinProgress(null);
      upsertJoined(await api.joinWorld(code, false, withRecommended));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setJoinProgress(null);
    }
  };

  const denied = !!preview?.status.error;
  const canJoin = !!preview && !preview.own && !denied && !preview.minecraftRunning && !!preview.minecraftDir;

  return (
    <Dialog
      title={preview ? preview.name : t.title}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {t.cancel}
          </Button>
          {preview ? (
            preview.minecraftRunning ? (
              <Button icon={RotateCcw} loading={busy} onClick={() => check(code)}>
                {t.recheck}
              </Button>
            ) : (
              <Button variant="primary" loading={busy} disabled={!canJoin} onClick={join}>
                {t.join}
              </Button>
            )
          ) : (
            <Button variant="primary" loading={busy} disabled={!code.trim()} onClick={() => check(code)}>
              {t.next}
            </Button>
          )}
        </>
      }
    >
      {!preview ? (
        <>
          <p>{t.pasteHint}</p>
          <textarea
            className={styles.code}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            placeholder="cubby://join?d=…"
            rows={3}
            autoFocus
            spellCheck={false}
          />
          {busy && (
            <p className={styles.checking}>
              <Loader2 size={15} className={styles.spin} aria-hidden /> {t.reaching}
            </p>
          )}
        </>
      ) : (
        <>
          <p className={styles.caption}>
            {tt.kind.caption(kindLabel(preview.loader), preview.mcVersion)}
          </p>
          {preview.own ? (
            <ul className={styles.list}>
              <Item ok={false}>{t.own}</Item>
            </ul>
          ) : (
            <ul className={styles.list}>
              <Item ok={hostLine(preview.status).ok}>{hostLine(preview.status).text}</Item>
              {preview.minecraftDir ? (
                <Item ok>
                  {preview.alreadyJoined ? t.listUpdate : t.listAdd} <b>{preview.name}</b>
                </Item>
              ) : (
                <Item ok={false}>
                  {t.noMcDir}{" "}
                  <button type="button" className={styles.link} onClick={() => openSheet("settings")}>
                    {t.pickInSettings}
                  </button>
                </Item>
              )}
              {!isModded(preview.loader) &&
                (preview.versionInstalled ? (
                  <Item ok>{t.versionInstalled(preview.requiredVersion)}</Item>
                ) : (
                  <Item ok={false}>{t.versionDownload(preview.mcVersion)}</Item>
                ))}
              {isModded(preview.loader) && preview.mods && (
                <>
                  {preview.mods.required.length > 0 && (
                    <Item ok={false}>
                      {t.requiredMods}
                      <ModList items={preview.mods.required} />
                    </Item>
                  )}
                  {preview.mods.recommended.length > 0 && (
                    <li className={styles.optional}>
                      <Toggle
                        checked={withRecommended}
                        onChange={setWithRecommended}
                        label={t.recommendedMods(preview.mods.recommended.length)}
                        description={t.recommendedText}
                      />
                      {withRecommended && <ModList items={preview.mods.recommended} />}
                    </li>
                  )}
                  {(preview.mods.required.length > 0 || (withRecommended && preview.mods.recommended.length > 0)) && (
                    <Item ok>
                      {preview.mods.launcher === "tLauncher"
                        ? t.loaderTLauncher(`${LOADER_LABELS[preview.loader]} ${preview.loaderVersion ?? ""}`.trim())
                        : t.loaderProfile(`${LOADER_LABELS[preview.loader]} ${preview.loaderVersion ?? ""}`.trim(), preview.name)}
                    </Item>
                  )}
                  {preview.mods.required.length === 0 && preview.mods.recommended.length === 0 && (
                    <Item ok>{t.modsInstalled}</Item>
                  )}
                </>
              )}
              {isModded(preview.loader) && !preview.mods && (
                <Item ok={false}>
                  {preview.modsError ? t.modsError(preview.modsError) : t.modsLater}
                </Item>
              )}
              {preview.minecraftRunning && (
                <Item ok={false}>{t.mcRunning}</Item>
              )}
            </ul>
          )}
          {busy && progress && (
            <div className={styles.installing}>
              <Progress value={progress.count ? (progress.index - 1) / progress.count : null} />
              <span>
                {progress.index === 0
                  ? t.installingLong(progress.title)
                  : t.installingStep(progress.title, progress.index, progress.count)}
              </span>
            </div>
          )}
          <p className={styles.note}>{t.keepOpen}</p>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </Dialog>
  );
}
