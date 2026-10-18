import { RefreshCw, Trash2, Zap } from "lucide-react";
import type { ContentKind, InstalledMod } from "../../lib/api";
import { useT } from "../../i18n";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { ModIcon, NeedBadge } from "./parts";
import styles from "./Discover.module.css";

type Props = {
  kind: ContentKind;
  installed: InstalledMod[] | null;
  plugin: boolean;
  busy: string | null;
  onUpdate: (file: string) => void;
  onUpdateAll: () => void;
  onRemove: (file: string) => void;
  /** Modrinth'te tanınan satıra tıklayınca önizleme. */
  onOpen: (mod: InstalledMod) => void;
  /** Shader'larda: bu shader'ı kullan. */
  onActivate: (file: string) => void;
  selectedId: string | null;
};

/** Kurulu olanlar: güncelle, kaldır; shader'larda hangisinin kullanıldığı, kaynak paketlerinde zorunlu olan. */
export function InstalledView({ kind, installed, plugin, busy, onUpdate, onUpdateAll, onRemove, onOpen, onActivate, selectedId }: Props) {
  const tt = useT();
  const t = tt.mods;
  const d = tt.discover;
  const openPerformance = useAppStore((s) => s.openWorldPerformance);
  if (installed === null) {
    return (
      <div className={styles.rows}>
        {[0, 1, 2].map((i) => (
          <div key={i} className={[styles.row, styles.skeleton].join(" ")} aria-hidden>
            <span className={styles.icon} style={{ width: 44, height: 44 }} />
            <span className={styles.line} style={{ width: "40%" }} />
          </div>
        ))}
      </div>
    );
  }
  if (installed.length === 0) {
    return <p className={styles.empty}>{kind !== "mod" ? d.emptyPacks : plugin ? t.emptyPlugins : t.emptyMods}</p>;
  }
  const updates = installed.filter((m) => m.update).length;

  return (
    <div className={styles.rows}>
      {updates > 0 && kind === "mod" && (
        <div className={styles.updateBar}>
          <span>{t.updatesAvailable(updates)}</span>
          <Button
            size="sm"
            variant="primary"
            icon={RefreshCw}
            loading={busy === "update-all"}
            disabled={busy !== null}
            onClick={onUpdateAll}
          >
            {t.updateAll}
          </Button>
        </div>
      )}
      {installed.map((m) => (
        <div
          key={m.file}
          className={[styles.row, m.projectId && m.projectId === selectedId && styles.rowSelected].filter(Boolean).join(" ")}
        >
          <button
            type="button"
            className={styles.rowMain}
            disabled={!m.projectId}
            onClick={() => onOpen(m)}
          >
            <ModIcon icon={m.icon} plugin={plugin} />
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>
                {m.title}
                {m.managed && <Badge tone="accent">{tt.perf.boostTitle}</Badge>}
                {m.dependency && !m.managed && <Badge>{t.dependency}</Badge>}
                {!m.known && <Badge>{t.manual}</Badge>}
                {m.active && <Badge tone="accent">{d.activeShader}</Badge>}
                {m.forced && <Badge tone="warning">{d.forced}</Badge>}
                <NeedBadge need={m.clientNeed} />
              </span>
              <span className={styles.tileMeta}>
                {m.versionNumber ?? m.file}
                {m.update && <span className={styles.update}>{t.updateReady(m.update)}</span>}
              </span>
            </span>
          </button>
          {kind === "shader" && !m.active && (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onActivate(m.file)}>
              {d.useShader}
            </Button>
          )}
          {m.update && (
            <Button
              size="sm"
              icon={RefreshCw}
              loading={busy === `update:${m.file}`}
              disabled={busy !== null}
              onClick={() => onUpdate(m.file)}
            >
              {t.update}
            </Button>
          )}
          {m.managed ? (
            // Hızlandırıcı'nın modu tek tek kaldırılmaz; Performans'tan kapatılır.
            <IconButton icon={Zap} size="sm" variant="ghost" label={d.managedHint} onClick={openPerformance} />
          ) : (
            <IconButton
              icon={Trash2}
              size="sm"
              variant="ghost"
              label={t.removeToTrash}
              disabled={busy !== null}
              onClick={() => onRemove(m.file)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
