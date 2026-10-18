import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, House, Loader2, RotateCcw } from "lucide-react";
import { api, errorMessage, type InvitePreview, type JoinStatus, type ModItem } from "../../lib/api";
import { getT, useT } from "../../i18n";
import { LOADER_LABELS, formatBytesMb, isModded, kindLabel } from "../../lib/format";
import { CODE_LEN, extractCode } from "../../lib/inviteCode";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Progress } from "../../ui/Progress";
import { Toggle } from "../../ui/Toggle";
import { CodeInput } from "./CodeInput";
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

/**
 * Davet koduyla katılma: önce ne yapılacağını gösterir, onay olmadan hiçbir dosyaya dokunmaz.
 * Kod iki üçlü kutuya yazılır; davet sayfasındaki "Cubby'de aç" kodla açar.
 */
export function JoinDialog() {
  const initial = useAppStore((s) => s.joinDialog);
  const openJoin = useAppStore((s) => s.openJoin);
  const upsertJoined = useAppStore((s) => s.upsertJoined);
  const openSheet = useAppStore((s) => s.openSheet);
  const instances = useAppStore((s) => s.instances);

  const [code, setCode] = useState("");
  /** Eski uzun davet linkiyle (`cubby://join?d=…`) açıldıysa: kutular yerine bu kullanılır. */
  const [legacy, setLegacy] = useState<string | null>(null);
  const checking = useRef(false);
  /** Kutuların başlangıç değeri; `key` değişince kutular bu kodla yeniden kurulur. */
  const [seed, setSeed] = useState({ key: 0, code: "" });
  const [fromClipboard, setFromClipboard] = useState(false);
  const typed = useRef(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withRecommended, setWithRecommended] = useState(true);
  const progress = useAppStore((s) => s.joinProgress);
  const setJoinProgress = useAppStore((s) => s.setJoinProgress);
  const tt = useT();
  const t = tt.join;

  const check = useCallback(async (value: string) => {
    if (!value.trim() || checking.current) return;
    checking.current = true;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.previewInvite(value));
    } catch (e) {
      setPreview(null);
      setError(errorMessage(e));
    } finally {
      checking.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initial === null) return;
    // Davet sayfasından (`cubby://join?c=`) kodla gelinir; eski uzun linkler de çalışsın.
    const fromLink = initial ? extractCode(initial) : null;
    setCode(fromLink ?? "");
    setSeed((s) => ({ key: s.key + 1, code: fromLink ?? "" }));
    setLegacy(initial && !fromLink ? initial : null);
    setPreview(null);
    setError(null);
    setFromClipboard(false);
    typed.current = false;
    if (initial) {
      void check(fromLink ?? initial);
      return;
    }
    // Elle açıldıysa: panoda kod ya da davet linki varsa kutular dolar ve önizleme açılır.
    let live = true;
    api
      .clipboardInviteCode()
      .then((c) => {
        if (!live || !c || typed.current) return;
        setCode(c);
        setSeed((s) => ({ key: s.key + 1, code: c }));
        setFromClipboard(true);
        void check(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [initial, check]);

  if (initial === null) return null;
  const close = () => openJoin(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      setJoinProgress(null);
      upsertJoined(await api.joinWorld(legacy ?? code, false, withRecommended));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setJoinProgress(null);
    }
  };

  // Kendi kodunu girdi: dünyasını Oyna'da seçip açar.
  const goToOwn = (id: string) => {
    const s = useAppStore.getState();
    s.select(id);
    s.setPage("play");
    close();
  };
  const ownWorld = preview?.own && preview.ownWorld && instances.some((i) => i.id === preview.ownWorld) ? preview.ownWorld : null;

  const denied = !!preview?.status.error;
  const canJoin = !!preview && !preview.own && !denied && !preview.minecraftRunning && !!preview.minecraftDir;

  return (
    <Dialog
      title={preview ? preview.name : t.title}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            {preview?.own ? t.close : t.cancel}
          </Button>
          {preview?.own ? (
            ownWorld && (
              <Button variant="primary" icon={ArrowRight} onClick={() => goToOwn(ownWorld)}>
                {t.goToWorld}
              </Button>
            )
          ) : preview ? (
            preview.minecraftRunning ? (
              <Button icon={RotateCcw} loading={busy} onClick={() => check(legacy ?? code)}>
                {t.recheck}
              </Button>
            ) : (
              <Button variant="primary" loading={busy} disabled={!canJoin} onClick={join}>
                {t.join}
              </Button>
            )
          ) : (
            <Button variant="primary" loading={busy} disabled={code.length !== CODE_LEN} onClick={() => check(code)}>
              {t.next}
            </Button>
          )}
        </>
      }
    >
      {!preview ? (
        <>
          <p>{t.pasteHint}</p>
          <CodeInput
            key={seed.key}
            initial={seed.code}
            disabled={busy}
            onChange={(c) => {
              typed.current = true;
              setCode(c);
              setLegacy(null);
              setError(null);
              setFromClipboard(false);
            }}
            onComplete={(c) => void check(c)}
            onEnter={() => code.length === CODE_LEN && void check(code)}
          />
          {fromClipboard && !busy && (
            <p className={styles.clipboard}>
              <ClipboardCheck size={15} aria-hidden /> {t.fromClipboard}
            </p>
          )}
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
            <div className={styles.own}>
              <span className={styles.ownIcon}>
                <House size={20} aria-hidden />
              </span>
              <div>
                <b>{t.ownTitle}</b>
                <p>{t.ownText}</p>
              </div>
            </div>
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
          {!preview.own && <p className={styles.note}>{t.keepOpen}</p>}
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </Dialog>
  );
}
