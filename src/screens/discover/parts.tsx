import { useEffect, useState } from "react";
import { AlertTriangle, Check, Plug, Puzzle, RotateCcw } from "lucide-react";
import { api, mediaUrl, type ClientNeed } from "../../lib/api";
import { useT } from "../../i18n";
import { formatBytesMb } from "../../lib/format";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Progress } from "../../ui/Progress";
import styles from "./Discover.module.css";

/** Oyuncunun da kurması gerekip gerekmediğini gösteren kısa rozet. */
export function NeedBadge({ need }: { need: ClientNeed | null }) {
  const t = useT().mods;
  if (need === "required") return <Badge tone="warning">{t.needRequired}</Badge>;
  if (need === "recommended") return <Badge>{t.needRecommended}</Badge>;
  return null;
}

export function ModIcon({ icon, plugin, size = 44 }: { icon: string | null; plugin: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  const Fallback = plugin ? Plug : Puzzle;
  return (
    <span className={styles.icon} style={{ width: size, height: size }}>
      {icon && !failed ? (
        <img src={mediaUrl(icon)} alt="" draggable={false} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <Fallback size={Math.round(size * 0.45)} aria-hidden />
      )}
    </span>
  );
}

/** Süren indirme: sayfanın altında küçük bir çubuk; sayfa değişse de iş sürer. */
export function InstallToast() {
  const p = useAppStore((s) => s.modProgress);
  const t = useT().mods;
  return (
    <div className={styles.toast}>
      <Progress value={p?.total ? p.downloaded / p.total : null} />
      {p && (
        <span>{t.downloading(p.title, formatBytesMb(p.downloaded), p.total ? formatBytesMb(p.total) : null)}</span>
      )}
    </div>
  );
}

/** Kendi Minecraft'ına mod eşitlemesinin durumu (yalnız modlu dünyalar). */
export function ClientLine({ id }: { id: string }) {
  const status = useAppStore((s) => s.clientStatus[id]);
  const setClientStatus = useAppStore((s) => s.setClientStatus);
  const [busy, setBusy] = useState(false);
  const tt = useT();
  const t = tt.mods;

  useEffect(() => {
    api
      .clientStatus(id)
      .then((st) => setClientStatus(id, st))
      .catch(console.error);
  }, [id, setClientStatus]);

  if (!status || status.state === "off" || status.state === "") return null;
  const retry = async () => {
    setBusy(true);
    try {
      await api.clientResync(id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={[styles.clientLine, status.state === "error" && styles.clientError].filter(Boolean).join(" ")}>
      {status.state === "working" && <span>{t.clientWorking}</span>}
      {status.state === "ok" && (
        <span>
          <Check size={15} aria-hidden />{" "}
          {status.launcher === "tLauncher" ? t.clientOkTL(status.pick ?? "") : t.clientOk(status.pick ?? "")}
          {status.blocked.length > 0 && t.clientBlocked(status.blocked.join(", "))}
        </span>
      )}
      {status.state === "error" && (
        <>
          <span>
            <AlertTriangle size={15} aria-hidden /> {t.clientError(status.message ?? "")}
          </span>
          <Button size="sm" icon={RotateCcw} loading={busy} onClick={retry}>
            {tt.common.retry}
          </Button>
        </>
      )}
    </div>
  );
}

/** Markdown'u sade metne indirger (görseller ve HTML atılır, linkler metin olarak kalır). */
export function plainText(md: string): string {
  return md
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
