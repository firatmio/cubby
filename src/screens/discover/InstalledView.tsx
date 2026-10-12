import { RefreshCw, Trash2 } from "lucide-react";
import type { InstalledMod } from "../../lib/api";
import { useT } from "../../i18n";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { ModIcon, NeedBadge } from "./parts";
import styles from "./Discover.module.css";

type Props = {
  installed: InstalledMod[] | null;
  plugin: boolean;
  busy: string | null;
  onUpdate: (file: string) => void;
  onUpdateAll: () => void;
  onRemove: (file: string) => void;
};

/** Dünyaya kurulu modlar/eklentiler: güncelle, kaldır. */
export function InstalledView({ installed, plugin, busy, onUpdate, onUpdateAll, onRemove }: Props) {
  const t = useT().mods;
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
  if (installed.length === 0) return <p className={styles.empty}>{plugin ? t.emptyPlugins : t.emptyMods}</p>;
  const updates = installed.filter((m) => m.update).length;

  return (
    <div className={styles.rows}>
      {updates > 0 && (
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
        <div key={m.file} className={styles.row}>
          <ModIcon icon={m.icon} plugin={plugin} />
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>
              {m.title}
              {m.dependency && <Badge>{t.dependency}</Badge>}
              {!m.known && <Badge>{t.manual}</Badge>}
              <NeedBadge need={m.clientNeed} />
            </span>
            <span className={styles.cardMeta}>
              {m.versionNumber ?? m.file}
              {m.update && <span className={styles.update}>{t.updateReady(m.update)}</span>}
            </span>
          </span>
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
          <IconButton
            icon={Trash2}
            size="sm"
            variant="ghost"
            label={t.removeToTrash}
            disabled={busy !== null}
            onClick={() => onRemove(m.file)}
          />
        </div>
      ))}
    </div>
  );
}
