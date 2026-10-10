import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { api, errorMessage, type InvitePreview, type JoinStatus } from "../../lib/api";
import { KIND_LABELS } from "../../lib/format";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
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
      upsertJoined(await api.joinWorld(code, false));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
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
            placeholder="mcsm://join?d=…"
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
              {preview.versionInstalled ? (
                <Item ok>Gereken sürüm kurulu ({preview.requiredVersion})</Item>
              ) : preview.loader === "fabric" ? (
                <Item ok={false}>
                  Fabric {preview.loaderVersion} (Minecraft {preview.mcVersion}) kurulu değil. Otomatik kurulum yakında;
                  şimdilik fabricmc.net'ten kurman gerekiyor.
                </Item>
              ) : (
                <Item ok={false}>
                  Minecraft {preview.mcVersion} sürümünü Minecraft Launcher'da bir kez açman gerekiyor.
                </Item>
              )}
              {preview.loader === "fabric" && (
                <Item ok={false}>Modlu dünya: arkadaşının modları sende de kurulu olmalı (otomatik eşitleme yakında).</Item>
              )}
              {preview.minecraftRunning && (
                <Item ok={false}>Minecraft açık. Kapatmazsan eklediğimiz kayıt silinebilir; oyunu kapatıp tekrar kontrol et.</Item>
              )}
            </ul>
          )}
          <p className={styles.note}>Oynarken bu uygulama açık kalmalı; pencereyi kapatınca simge durumunda çalışmaya devam eder.</p>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </Dialog>
  );
}
