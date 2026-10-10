import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Box, Plus, Puzzle, Zap, type LucideIcon } from "lucide-react";
import { mediaUrl, type Instance, type LoaderKind } from "../../lib/api";
import { KIND_COLORS } from "../../lib/format";
import { spring } from "../../lib/motion";
import { useAppStore, useServer } from "../../store/appStore";
import { StatusDot } from "../../ui/Badge";
import styles from "./TileRow.module.css";

export const KIND_ICONS: Record<LoaderKind, LucideIcon> = {
  fabric: Puzzle,
  paper: Zap,
  vanilla: Box,
};

function Tile({ instance, selected }: { instance: Instance; selected: boolean }) {
  const select = useAppStore((s) => s.select);
  const { status } = useServer(instance.id);
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = KIND_ICONS[instance.loader];

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [selected]);

  return (
    <div className={styles.slot}>
      <motion.button
        ref={ref}
        type="button"
        aria-label={instance.name}
        aria-pressed={selected}
        className={[styles.tile, selected && styles.selected].filter(Boolean).join(" ")}
        style={{ "--kind": KIND_COLORS[instance.loader] } as React.CSSProperties}
        animate={{ scale: selected ? 1 : 0.82 }}
        whileHover={{ scale: selected ? 1.02 : 0.86 }}
        whileTap={{ scale: selected ? 0.97 : 0.8 }}
        transition={spring}
        onClick={() => select(instance.id)}
      >
        {instance.cover ? (
          <img
            src={mediaUrl(`thumb/${instance.id}`, instance.cover.version)}
            alt=""
            className={styles.thumb}
            draggable={false}
          />
        ) : (
          <Icon size={34} aria-hidden className={styles.icon} />
        )}
        {status !== "stopped" && (
          <span className={styles.status}>
            <StatusDot status={status} />
          </span>
        )}
      </motion.button>
      <AnimatePresence>
        {selected && (
          <motion.span
            className={styles.label}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
          >
            {instance.name}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Üst şerit: dünyalar soldan sağa, sonda "yeni dünya". */
export function TileRow() {
  const instances = useAppStore((s) => s.instances);
  const selectedId = useAppStore((s) => s.selectedId);
  const setView = useAppStore((s) => s.setView);

  return (
    <nav className={styles.row} aria-label="Dünyalar">
      {instances.map((i) => (
        <Tile key={i.id} instance={i} selected={i.id === selectedId} />
      ))}
      <div className={styles.slot}>
        <motion.button
          type="button"
          aria-label="Yeni dünya"
          className={[styles.tile, styles.add].join(" ")}
          animate={{ scale: 0.82 }}
          whileHover={{ scale: 0.86 }}
          whileTap={{ scale: 0.8 }}
          transition={spring}
          onClick={() => setView("setup")}
        >
          <Plus size={30} aria-hidden />
        </motion.button>
      </div>
    </nav>
  );
}
