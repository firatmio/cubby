import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { api, errorMessage, type InvitePreview, type JoinStatus, type ModItem } from "../../lib/api";
import { KIND_LABELS, LOADER_LABELS, formatBytesMb, isModded } from "../../lib/format";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Progress } from "../../ui/Progress";
import { Toggle } from "../../ui/Toggle";
import styles from "./JoinDialog.module.css";

function hostLine(s: JoinStatus): { ok: boolean; text: string } {
  if (s.error) return { ok: false, text: s.error };
  if (s.reachable === false)
    return { ok: false, text: "Arkadaşının bilgisayarına şu an ulaşılamıyor. Yine de ekleyebilirsin; uygulaması açılınca bağlanır." };
  if (!s.running) return { ok: true, text: "Arkadaşının uygulaması açık, dünyası şu an kapalı. Açınca girebilirsin." };
  return {
    ok: true,
    text: s.path === "relay" ? "Dünya açık · aracı sunucu üzerinden bağlanılacak" : "Dünya açık · doğrudan bağlanılacak",
  };
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
      title={preview ? preview.name : "Arkadaşının dünyasına katıl"}
      actions={
        <>
          <Button variant="ghost" onClick={close}>
            İptal
          </Button>
          {preview ? (
            preview.minecraftRunning ? (
              <Button icon={RotateCcw} loading={busy} onClick={() => check(code)}>
                Tekrar kontrol et
              </Button>
            ) : (
              <Button variant="primary" loading={busy} disabled={!canJoin} onClick={join}>
                Katıl
              </Button>
            )
          ) : (
            <Button variant="primary" loading={busy} disabled={!code.trim()} onClick={() => check(code)}>
              Devam
            </Button>
          )}
        </>
      }
    >
      {!preview ? (
        <>
          <p>Arkadaşının gönderdiği davet linkini ya da kodunu yapıştır.</p>
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
              <Loader2 size={15} className={styles.spin} aria-hidden /> Arkadaşının bilgisayarına ulaşılıyor…
            </p>
          )}
        </>
      ) : (
        <>
          <p className={styles.caption}>
            {KIND_LABELS[preview.loader]} dünya · Minecraft {preview.mcVersion}
          </p>
          {preview.own ? (
            <ul className={styles.list}>
              <Item ok={false}>Bu senin kendi dünyan; davet arkadaşın için.</Item>
            </ul>
          ) : (
            <ul className={styles.list}>
              <Item ok={hostLine(preview.status).ok}>{hostLine(preview.status).text}</Item>
              {preview.minecraftDir ? (
                <Item ok>
                  Minecraft'ın Çok Oyunculu listesine {preview.alreadyJoined ? "güncellenecek" : "eklenecek"}: <b>{preview.name}</b>
                </Item>
              ) : (
                <Item ok={false}>
                  Minecraft klasörü bulunamadı.{" "}
                  <button type="button" className={styles.link} onClick={() => openSheet("settings")}>
                    Ayarlar'dan seç
                  </button>
                </Item>
              )}
              {!isModded(preview.loader) &&
                (preview.versionInstalled ? (
                  <Item ok>Gereken sürüm kurulu ({preview.requiredVersion})</Item>
                ) : (
                  <Item ok={false}>Minecraft {preview.mcVersion} sürümünü Launcher bir kez indirecek; ilk açılış biraz sürebilir.</Item>
                ))}
              {isModded(preview.loader) && preview.mods && (
                <>
                  {preview.mods.required.length > 0 && (
                    <Item ok={false}>
                      Bu dünyaya girmek için şu modlar gerekiyor, Katıl'a basınca kurulacak:
                      <ModList items={preview.mods.required} />
                    </Item>
                  )}
                  {preview.mods.recommended.length > 0 && (
                    <li className={styles.optional}>
                      <Toggle
                        checked={withRecommended}
                        onChange={setWithRecommended}
                        label={`Önerilen modları da kur (${preview.mods.recommended.length})`}
                        description="Sunucuda en iyi deneyim için önerilir: ekranlar, tuşlar ya da tarif listesi gibi özellikler ancak sende de kuruluysa görünür. Kurmadan da girebilirsin."
                      />
                      {withRecommended && <ModList items={preview.mods.recommended} />}
                    </li>
                  )}
                  {(preview.mods.required.length > 0 || (withRecommended && preview.mods.recommended.length > 0)) && (
                    <Item ok>
                      {LOADER_LABELS[preview.loader]} {preview.loaderVersion} kurulacak
                      {preview.mods.launcher === "tLauncher"
                        ? "; modlar TLauncher'ın mods klasörüne konacak"
                        : ` ve Launcher'da "${preview.name} · Cubby" profili oluşturulacak`}
                      .
                    </Item>
                  )}
                  {preview.mods.required.length === 0 && preview.mods.recommended.length === 0 && (
                    <Item ok>Gereken modlar sende zaten kurulu.</Item>
                  )}
                </>
              )}
              {isModded(preview.loader) && !preview.mods && (
                <Item ok={false}>
                  {preview.modsError
                    ? `Mod listesi alınamadı: ${preview.modsError}`
                    : "Modlar, arkadaşının uygulamasına ulaşılınca kontrol edilecek."}
                </Item>
              )}
              {preview.minecraftRunning && (
                <Item ok={false}>Minecraft açık. Kapatmazsan eklediğimiz kayıt silinebilir; oyunu kapatıp tekrar kontrol et.</Item>
              )}
            </ul>
          )}
          {busy && progress && (
            <div className={styles.installing}>
              <Progress value={progress.count ? (progress.index - 1) / progress.count : null} />
              <span>
                {progress.index === 0
                  ? `${progress.title} kuruluyor; birkaç dakika sürebilir…`
                  : `${progress.title} kuruluyor · ${progress.index}/${progress.count}`}
              </span>
            </div>
          )}
          <p className={styles.note}>Oynarken bu uygulama açık kalmalı; pencereyi kapatınca simge durumunda çalışmaya devam eder.</p>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </Dialog>
  );
}
