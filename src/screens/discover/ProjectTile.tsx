import { memo, useRef, useState } from "react";
import { Check, Download } from "lucide-react";
import { mediaUrl, type ModHit } from "../../lib/api";
import { useT } from "../../i18n";
import { compactCount } from "../../lib/format";
import { Button } from "../../ui/Button";
import { ModIcon, NeedBadge } from "./parts";
import styles from "./Discover.module.css";

/** Fare bir kutucukta bu kadar durursa ayrıntısı önden çekilir. */
const PREFETCH_HOVER_MS = 250;

/** Kutucuğun görseli: galeri resmi ya da projenin renginde zemin + büyük ikon. */
export function TileArt({ hit, plugin, iconSize = 64 }: { hit: ModHit; plugin: boolean; iconSize?: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasImage = !!hit.image && !failed;
  return (
    <span className={styles.art} style={{ "--tint": hit.color ?? "#3d3d3d" } as React.CSSProperties}>
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
          <ModIcon icon={hit.icon} plugin={plugin} size={iconSize} />
        </span>
      )}
    </span>
  );
}

type Props = {
  hit: ModHit;
  plugin: boolean;
  installed: boolean;
  selected: boolean;
  /** Izgarada altta küçük "Kur" düğmesi; rafta yok. */
  quickInstall?: { installing: boolean; disabled: boolean; onInstall: (projectId: string) => void };
  onOpen: (hit: ModHit) => void;
  onPrefetch: (projectId: string) => void;
};

/**
 * Raf ve ızgaradaki kutucuk. Açıklama yok (önizlemede); kutucuk hafif kalır, raflar ferah görünür.
 * Üzerine gelince Oyna'daki dünya kutucukları gibi hafifçe büyür, seçiliyse beyaz çerçeve alır.
 */
export const ProjectTile = memo(function ProjectTile({
  hit,
  plugin,
  installed,
  selected,
  quickInstall,
  onOpen,
  onPrefetch,
}: Props) {
  const t = useT().mods;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  return (
    <div
      className={[styles.tile, selected && styles.tileSelected].filter(Boolean).join(" ")}
      data-project={hit.projectId}
    >
      <button
        type="button"
        className={styles.tileMain}
        aria-pressed={selected}
        onClick={() => onOpen(hit)}
        onMouseEnter={() => {
          timer.current = setTimeout(() => onPrefetch(hit.projectId), PREFETCH_HOVER_MS);
        }}
        onMouseLeave={() => clearTimeout(timer.current)}
      >
        <TileArt hit={hit} plugin={plugin} />
        {hit.image && (
          <span className={styles.tileIcon}>
            <ModIcon icon={hit.icon} plugin={plugin} size={34} />
          </span>
        )}
        {installed && (
          <span className={styles.tileCheck} aria-label={t.installed}>
            <Check size={14} aria-hidden />
          </span>
        )}
        <span className={styles.tileBody}>
          <span className={styles.tileTitle}>{hit.title}</span>
          <span className={styles.tileMeta}>
            {t.downloads(compactCount(hit.downloads))}
            <NeedBadge need={hit.clientNeed} />
          </span>
        </span>
      </button>
      {quickInstall && !installed && (
        <Button
          size="sm"
          icon={Download}
          className={styles.tileInstall}
          loading={quickInstall.installing}
          disabled={quickInstall.disabled}
          onClick={() => quickInstall.onInstall(hit.projectId)}
        >
          {t.install}
        </Button>
      )}
    </div>
  );
});

/** Yüklenirken aynı boyda yer tutucu. */
export function SkeletonTile() {
  return (
    <div className={[styles.tile, styles.skeleton].join(" ")} aria-hidden>
      <span className={styles.art} />
      <span className={styles.tileBody}>
        <span className={styles.line} style={{ width: "70%" }} />
        <span className={styles.line} style={{ width: "45%" }} />
      </span>
    </div>
  );
}
