import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Download, ExternalLink, Info, Plus, Users, X } from "lucide-react";
import { mediaUrl, openExternal, type ContentKind, type ModHit, type ModInfo, type PackPlan } from "../../lib/api";
import { useT } from "../../i18n";
import { LOADER_LABELS, compactCount, formatBytesMb } from "../../lib/format";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Markdown } from "../../ui/Markdown";
import { SelectList } from "../../ui/SelectList";
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
  const { hit, info, plan, pack, close } = preview;
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

        {kind === "modpack" ? (
          <PackFacts hit={hit} info={info} pack={pack} onPickVersion={preview.pickVersion} />
        ) : (
        <>
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
        </>
        )}

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

type PackProps = {
  hit: ModHit;
  info: ModInfo | null;
  pack: PackPlan | null;
  onPickVersion: (versionId: string) => void;
};

/** Mod paketi: nasıl bir dünya kurulacağı, sürüm seçimi ve "Yeni dünya olarak kur". */
function PackFacts({ hit, info, pack, onPickVersion }: PackProps) {
  const startModpackSetup = useAppStore((s) => s.startModpackSetup);
  const tt = useT();
  const t = tt.mods;
  const d = tt.discover;
  const [versionsOpen, setVersionsOpen] = useState(false);

  useEffect(() => setVersionsOpen(false), [hit.projectId]);
  const ready = !!pack && !pack.error && !!pack.versionId && !!pack.mc && !!pack.loader;

  const start = () => {
    if (!ready) return;
    startModpackSetup({
      projectId: hit.projectId,
      versionId: pack.versionId!,
      title: hit.title,
      icon: info?.icon ?? hit.icon,
      mc: pack.mc!,
      loader: pack.loader!,
      loaderVersion: pack.loaderVersion,
      ramMb: pack.ramMb,
    });
  };

  return (
    <>
      <div className={styles.previewActions}>
        <Button variant="primary" icon={Plus} loading={!pack} disabled={!ready} onClick={start}>
          {pack ? d.installAsWorld : tt.common.preparing}
        </Button>
        {info && (
          <Button variant="ghost" icon={ExternalLink} onClick={() => openExternal(info.url)}>
            {t.openModrinth}
          </Button>
        )}
      </div>
      <ul className={styles.facts}>
        {!pack ? (
          <>
            <li className={styles.line} style={{ width: "60%" }} />
            <li className={styles.line} style={{ width: "85%" }} />
            <li className={styles.line} style={{ width: "50%" }} />
          </>
        ) : (
          <>
            {pack.versionNumber && (
              <li>
                {d.packVersion} <b>{pack.versionNumber}</b>
                {pack.unstable && <Badge tone="warning">{t.unstable}</Badge>}
                {pack.versions.length > 1 && (
                  <button type="button" className={styles.factLink} onClick={() => setVersionsOpen((v) => !v)}>
                    {d.otherVersion}
                    <ChevronDown size={14} aria-hidden style={{ rotate: versionsOpen ? "180deg" : "0deg" }} />
                  </button>
                )}
              </li>
            )}
            {versionsOpen && (
              <li className={styles.factList}>
                <SelectList
                  maxHeight={200}
                  value={pack.versionId}
                  onSelect={(id) => {
                    setVersionsOpen(false);
                    if (id !== pack.versionId) onPickVersion(id);
                  }}
                  items={pack.versions.map((v) => ({
                    key: v.id,
                    label: v.number,
                    meta: `${LOADER_LABELS[v.loader]} · ${v.mc}`,
                    badges: v.unstable ? <Badge tone="warning">{t.unstable}</Badge> : undefined,
                  }))}
                />
              </li>
            )}
            {pack.mc && pack.loader && (
              <li>
                <Check size={15} aria-hidden />
                Minecraft <b>{pack.mc}</b> · {LOADER_LABELS[pack.loader]}
                {pack.loaderVersion ? ` ${pack.loaderVersion}` : ""}
              </li>
            )}
            {!pack.error && (
              <li>
                <Check size={15} aria-hidden />
                {d.packMods(pack.serverMods, pack.clientMods)} · {d.packSize(formatBytesMb(pack.size))}
              </li>
            )}
            {pack.error && (
              <li className={styles.warn}>
                <AlertTriangle size={15} aria-hidden />
                {pack.error}
              </li>
            )}
          </>
        )}
        <li>
          <Info size={15} aria-hidden />
          {d.modpackInfo}
        </li>
        <li>
          <Users size={15} aria-hidden />
          {d.packFriends}
        </li>
      </ul>
    </>
  );
}
