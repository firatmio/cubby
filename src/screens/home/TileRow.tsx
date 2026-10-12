import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogIn, Plus, Users } from "lucide-react";
import { mediaUrl, type Instance, type JoinedView } from "../../lib/api";
import { KIND_COLORS } from "../../lib/format";
import { spring } from "../../lib/motion";
import { joinKey, useAppStore, useServer } from "../../store/appStore";
import { StatusDot } from "../../ui/Badge";
import { LoaderLogo } from "../../ui/LoaderLogo";
import styles from "./TileRow.module.css";

function Tile({ instance, selected }: { instance: Instance; selected: boolean }) {
  const select = useAppStore((s) => s.select);
  const { status } = useServer(instance.id);
  const ref = useRef<HTMLButtonElement>(null);

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
          <LoaderLogo kind={instance.loader} size={40} className={styles.icon} />
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

/** Arkadaşının dünyası: tür ikonu + "arkadaş" rozeti; açıksa yeşil nokta. */
function JoinedTile({ view, selected }: { view: JoinedView; selected: boolean }) {
  const select = useAppStore((s) => s.select);
  const ref = useRef<HTMLButtonElement>(null);
  const online = view.status.reachable && view.status.running;

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [selected]);

  return (
    <div className={styles.slot}>
      <motion.button
        ref={ref}
        type="button"
        aria-label={`${view.world.name} (arkadaşının dünyası)`}
        aria-pressed={selected}
        className={[styles.tile, selected && styles.selected].filter(Boolean).join(" ")}
        style={{ "--kind": KIND_COLORS[view.world.loader] } as React.CSSProperties}
        animate={{ scale: selected ? 1 : 0.82 }}
        whileHover={{ scale: selected ? 1.02 : 0.86 }}
        whileTap={{ scale: selected ? 0.97 : 0.8 }}
        transition={spring}
        onClick={() => select(joinKey(view.world.id))}
      >
        <LoaderLogo kind={view.world.loader} size={40} className={styles.icon} />
        <span className={styles.friend} aria-hidden>
          <Users size={13} />
        </span>
        {online && (
          <span className={styles.status}>
            <StatusDot status="running" />
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
            {view.world.name}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Üst şerit: dünyalar soldan sağa, sonra arkadaşların dünyaları, sonda "yeni dünya" ve "katıl". */
export function TileRow() {
  const instances = useAppStore((s) => s.instances);
  const joined = useAppStore((s) => s.joined);
  const selectedId = useAppStore((s) => s.selectedId);
  const setView = useAppStore((s) => s.setView);
  const openJoin = useAppStore((s) => s.openJoin);

  return (
    <nav className={styles.row} aria-label="Dünyalar">
      {instances.map((i) => (
        <Tile key={i.id} instance={i} selected={i.id === selectedId} />
      ))}
      {joined.map((j) => (
        <JoinedTile key={j.world.id} view={j} selected={joinKey(j.world.id) === selectedId} />
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
      <div className={styles.slot}>
        <motion.button
          type="button"
          aria-label="Arkadaşının dünyasına katıl"
          title="Arkadaşının dünyasına katıl"
          className={[styles.tile, styles.add].join(" ")}
          animate={{ scale: 0.82 }}
          whileHover={{ scale: 0.86 }}
          whileTap={{ scale: 0.8 }}
          transition={spring}
          onClick={() => openJoin("")}
        >
          <LogIn size={28} aria-hidden />
        </motion.button>
      </div>
    </nav>
  );
}
