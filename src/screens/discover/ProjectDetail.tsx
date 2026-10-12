import { AlertTriangle, Check, Download, ExternalLink, Info } from "lucide-react";
import { mediaUrl, openExternal, type ModDetail, type ModHit } from "../../lib/api";
import { useT } from "../../i18n";
import { compactCount } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Progress } from "../../ui/Progress";
import { Sheet } from "../../ui/Sheet";
import { ModIcon, plainText } from "./parts";
import styles from "./Discover.module.css";

type Props = {
  /** Tıklanan kart: ayrıntı gelene kadar başlık ve görsel ondan. */
  hit: ModHit | null;
  detail: ModDetail | null;
  plugin: boolean;
  installing: boolean;
  disabled: boolean;
  onClose: () => void;
  onInstall: (projectId: string) => void;
};

/** Kartın ayrıntısı: sağdan açılan panel. Ayrıntı yüklenirken kartın bilgileri hemen görünür. */
export function ProjectDetail({ hit, detail, plugin, installing, disabled, onClose, onInstall }: Props) {
  const t = useT().mods;
  const title = detail?.title ?? hit?.title ?? "";
  const blocked = !!detail?.error || (detail?.conflicts.length ?? 0) > 0;
  const installed = detail?.installed ?? hit?.installed ?? false;
  const projectId = detail?.projectId ?? hit?.projectId ?? "";

  return (
    <Sheet open={!!hit} title={title} subtitle={detail?.description ?? hit?.description} onClose={onClose} width={560}>
      {hit && (
        <div className={styles.detail}>
          {hit.image && (
            <div className={styles.detailArt} style={{ "--tint": hit.color ?? "#3d3d3d" } as React.CSSProperties}>
              <img src={mediaUrl(hit.image)} alt="" draggable={false} decoding="async" />
            </div>
          )}
          <div className={styles.detailHead}>
            <ModIcon icon={detail?.icon ?? hit.icon} plugin={plugin} size={56} />
            <p className={styles.cardMeta}>
              {t.downloads(compactCount(detail?.downloads ?? hit.downloads))}
              {detail?.license ? ` · ${detail.license}` : ""}
            </p>
            <div className={styles.detailActions}>
              {detail && (
                <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => openExternal(detail.url)}>
                  {t.openModrinth}
                </Button>
              )}
              {installed ? (
                <span className={styles.installed}>
                  <Check size={15} aria-hidden /> {t.installed}
                </span>
              ) : (
                <Button
                  variant="primary"
                  icon={Download}
                  loading={installing}
                  disabled={!detail || blocked || disabled}
                  onClick={() => onInstall(projectId)}
                >
                  {t.install}
                </Button>
              )}
            </div>
          </div>

          {!detail ? (
            <Progress value={null} />
          ) : (
            <>
              <ul className={styles.facts}>
                {detail.versionNumber && (
                  <li>
                    {t.versionToInstall} <b>{detail.versionNumber}</b>
                    {detail.unstable && <Badge tone="warning">{t.unstable}</Badge>}
                  </li>
                )}
                {detail.with.length > 0 && (
                  <li>
                    {t.alsoInstalls} <b>{detail.with.map((w) => w.title).join(", ")}</b>
                  </li>
                )}
                {detail.clientNeed === "required" && (
                  <li className={styles.warn}>
                    <AlertTriangle size={15} aria-hidden /> {t.clientRequired}
                  </li>
                )}
                {detail.clientNeed === "recommended" && (
                  <li>
                    <Info size={15} aria-hidden /> {t.clientRecommended}
                  </li>
                )}
                {detail.clientNeed === "none" && (
                  <li>
                    <Check size={15} aria-hidden /> {t.clientNone}
                  </li>
                )}
                {detail.missing.length > 0 && (
                  <li className={styles.warn}>
                    <AlertTriangle size={15} aria-hidden /> {t.missingDeps}{" "}
                    {detail.missing.map((m) => m.title).join(", ")}
                  </li>
                )}
                {detail.conflicts.length > 0 && (
                  <li className={styles.warn}>
                    <AlertTriangle size={15} aria-hidden /> {t.conflicts}{" "}
                    {detail.conflicts.map((m) => m.title).join(", ")}
                  </li>
                )}
                {detail.error && (
                  <li className={styles.warn}>
                    <AlertTriangle size={15} aria-hidden /> {detail.error}
                  </li>
                )}
              </ul>
              {detail.body && <p className={styles.body}>{plainText(detail.body)}</p>}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
