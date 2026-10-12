import { useEffect, useState } from "react";
import { AlertTriangle, Check, Download, ExternalLink, Info, X } from "lucide-react";
import { mediaUrl, openExternal, type ContentKind } from "../../lib/api";
import { useT } from "../../i18n";
import { compactCount } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Markdown } from "../../ui/Markdown";
import { Toggle } from "../../ui/Toggle";
import { ModIcon } from "./parts";
import { TileArt } from "./ProjectTile";
import type { ContentActions, PreviewState } from "./useBrowse";
import styles from "./Discover.module.css";

type Props = {
  preview: PreviewState;
  kind: ContentKind;
  plugin: boolean;
  /** Kendi dünyan mı (zorunlu kaynak paketi yalnız orada). */
  own: boolean;
  actions: ContentActions;
};

/**
 * Sağdaki odak paneli (modal değil): galeri, bilgi, kurulum ve gerçek biçimiyle açıklama.
 * Kutucuğun bilgileriyle hemen açılır; galeri/açıklama ve sürüm planı arkadan dolar.
 */
export function Preview({ preview, kind, plugin, own, actions }: Props) {
  const { hit, info, plan, close } = preview;
  const tt = useT();
  const t = tt.mods;
  const d = tt.discover;
  const [shot, setShot] = useState(0);

  useEffect(() => setShot(0), [hit?.projectId]);
  if (!hit) return null;

  const gallery = info?.gallery.length ? info.gallery : hit.image ? [hit.image] : [];
  const current = gallery[Math.min(shot, gallery.length - 1)];
  const installed = actions.isInstalled(hit);
  const blocked = !!plan?.error || (plan?.conflicts.length ?? 0) > 0;
  const mine = actions.installed?.find((m) => m.projectId === hit.projectId);

  return (
    <aside className={styles.preview} aria-label={hit.title}>
      <div className={styles.previewScroll}>
        <div className={styles.previewTop}>
          <IconButton icon={X} label={tt.common.close} size="sm" variant="ghost" onClick={close} />
        </div>

        <div className={styles.previewArt} style={{ "--tint": hit.color ?? "#3d3d3d" } as React.CSSProperties}>
          {current ? (
            <img key={current} src={mediaUrl(current)} alt="" draggable={false} decoding="async" />
          ) : (
            <TileArt hit={hit} plugin={plugin} iconSize={84} />
          )}
        </div>
        {gallery.length > 1 && (
          <div className={styles.thumbs}>
            {gallery.slice(0, 6).map((g, n) => (
              <button
                key={g}
                type="button"
                className={n === shot ? styles.thumbOn : undefined}
                aria-label={d.galleryImage(n + 1)}
                onClick={() => setShot(n)}
              >
                <img src={mediaUrl(g)} alt="" draggable={false} loading="lazy" decoding="async" />
              </button>
            ))}
          </div>
        )}

        <div className={styles.previewHead}>
          <ModIcon icon={info?.icon ?? hit.icon} plugin={plugin} size={52} />
          <div className={styles.previewName}>
            <h2>{hit.title}</h2>
            <span className={styles.tileMeta}>
              {hit.author && d.by(hit.author)}
              {hit.author && " · "}
              {t.downloads(compactCount(info?.downloads ?? hit.downloads))}
              {info?.license ? ` · ${info.license}` : ""}
            </span>
          </div>
        </div>

        <div className={styles.previewActions}>
          {installed ? (
            <span className={styles.installed}>
              <Check size={15} aria-hidden /> {mine?.active ? d.activeShader : t.installed}
            </span>
          ) : (
            <Button
              variant="primary"
              icon={Download}
              loading={actions.busy === `install:${hit.projectId}` || (!plan && !blocked)}
              disabled={!plan || blocked || actions.busy !== null}
              onClick={() => actions.install(hit.projectId)}
            >
              {plan ? t.install : tt.common.preparing}
            </Button>
          )}
          {kind === "shader" && installed && mine && !mine.active && (
            <Button variant="secondary" disabled={actions.busy !== null} onClick={() => actions.activateShader(mine.file)}>
              {d.useShader}
            </Button>
          )}
          {info && (
            <Button variant="ghost" icon={ExternalLink} onClick={() => openExternal(info.url)}>
              {t.openModrinth}
            </Button>
          )}
        </div>

        {kind === "resourcePack" && own && mine && (
          <div className={styles.facts}>
            <Toggle
              checked={!!mine.forced}
              disabled={actions.busy !== null}
              onChange={(on) => actions.forcePack(on ? mine.file : null)}
              label={d.forcePack}
              description={d.forcePackText}
            />
          </div>
        )}

        <ul className={styles.facts}>
          {!plan ? (
            <>
              <li className={styles.line} style={{ width: "60%" }} />
              <li className={styles.line} style={{ width: "85%" }} />
            </>
          ) : (
            <>
              {plan.versionNumber && (
                <li>
                  {t.versionToInstall} <b>{plan.versionNumber}</b>
                  {plan.unstable && <Badge tone="warning">{t.unstable}</Badge>}
                </li>
              )}
              {plan.with.length > 0 && (
                <li>
                  {t.alsoInstalls} <b>{plan.with.map((w) => w.title).join(", ")}</b>
                </li>
              )}
              {plan.missing.length > 0 && (
                <li className={styles.warn}>
                  <AlertTriangle size={15} aria-hidden />
                  {t.missingDeps} {plan.missing.map((m) => m.title).join(", ")}
                </li>
              )}
              {plan.conflicts.length > 0 && (
                <li className={styles.warn}>
                  <AlertTriangle size={15} aria-hidden />
                  {t.conflicts} {plan.conflicts.map((m) => m.title).join(", ")}
                </li>
              )}
              {plan.error && (
                <li className={styles.warn}>
                  <AlertTriangle size={15} aria-hidden />
                  {plan.error}
                </li>
              )}
            </>
          )}
          {kind === "mod" && hit.clientNeed === "required" && (
            <li className={styles.warn}>
              <AlertTriangle size={15} aria-hidden />
              {t.clientRequired}
            </li>
          )}
          {kind === "mod" && hit.clientNeed === "recommended" && (
            <li>
              <Info size={15} aria-hidden />
              {t.clientRecommended}
            </li>
          )}
          {kind === "mod" && hit.clientNeed === "none" && (
            <li>
              <Check size={15} aria-hidden />
              {t.clientNone}
            </li>
          )}
          {kind !== "mod" && (
            <li>
              <Info size={15} aria-hidden />
              {kind === "resourcePack" ? d.packInfo : kind === "shader" ? d.shaderInfo : d.dataPackInfo}
            </li>
          )}
        </ul>

        {info ? (
          info.body ? <Markdown source={info.body} /> : <p className={styles.previewDesc}>{info.description}</p>
        ) : (
          <>
            <p className={styles.previewDesc}>{hit.description}</p>
            <div className={styles.bodySkeleton}>
              <span className={styles.line} />
              <span className={styles.line} style={{ width: "92%" }} />
              <span className={styles.line} style={{ width: "76%" }} />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
