import { memo, useState } from "react";
import { Check, Download } from "lucide-react";
import { mediaUrl, type ModHit } from "../../lib/api";
import { useT } from "../../i18n";
import { compactCount } from "../../lib/format";
import { Button } from "../../ui/Button";
import { ModIcon, NeedBadge } from "./parts";
import styles from "./Discover.module.css";

type Props = {
  hit: ModHit;
  plugin: boolean;
  installing: boolean;
  disabled: boolean;
  onOpen: (hit: ModHit) => void;
  onInstall: (projectId: string) => void;
};

/**
 * Büyük görselli kart. Görsel Modrinth'in öne çıkan galeri resmi (küçültülüp diskte önbelleklenir);
 * yoksa projenin renginden bir zemin ve ortada büyük ikon.
 */
export const ProjectCard = memo(function ProjectCard({ hit, plugin, installing, disabled, onOpen, onInstall }: Props) {
  const t = useT().mods;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasImage = !!hit.image && !failed;
  const tint = hit.color ?? "#3d3d3d";

  return (
    <article className={styles.card}>
      <button type="button" className={styles.cardMain} onClick={() => onOpen(hit)}>
        <span className={styles.art} style={{ "--tint": tint } as React.CSSProperties}>
          {hasImage ? (
            <img
              src={mediaUrl(hit.image!)}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className={loaded ? styles.artLoaded : undefined}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          ) : (
            <span className={styles.artIcon}>
              <ModIcon icon={hit.icon} plugin={plugin} size={72} />
            </span>
          )}
        </span>
        <span className={styles.cardBody}>
          {hasImage && (
            <span className={styles.cardIcon}>
              <ModIcon icon={hit.icon} plugin={plugin} size={40} />
            </span>
          )}
          <span className={styles.cardTitle}>{hit.title}</span>
          <span className={styles.cardDesc}>{hit.description}</span>
        </span>
      </button>
      <footer className={styles.cardFoot}>
        <span className={styles.cardMeta}>
          {t.downloads(compactCount(hit.downloads))}
          <NeedBadge need={hit.clientNeed} />
        </span>
        {hit.installed ? (
          <span className={styles.installed}>
            <Check size={15} aria-hidden /> {t.installed}
          </span>
        ) : (
          <Button size="sm" icon={Download} loading={installing} disabled={disabled} onClick={() => onInstall(hit.projectId)}>
            {t.install}
          </Button>
        )}
      </footer>
    </article>
  );
});

/** Yüklenirken aynı boyda yer tutucu kart. */
export function SkeletonCard() {
  return (
    <div className={[styles.card, styles.skeleton].join(" ")} aria-hidden>
      <span className={styles.art} />
      <span className={styles.cardBody}>
        <span className={styles.line} style={{ width: "55%" }} />
        <span className={styles.line} />
        <span className={styles.line} style={{ width: "80%" }} />
      </span>
    </div>
  );
}
