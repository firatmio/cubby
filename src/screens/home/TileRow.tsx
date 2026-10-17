import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LogIn, Plus, Users } from "lucide-react";
import { mediaUrl, type Instance, type JoinedView } from "../../lib/api";
import { KIND_COLORS } from "../../lib/format";
import { useT } from "../../i18n";
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
        animate={{ scale: selected ? 1 : 0.88 }}
        whileHover={{ scale: selected ? 1.02 : 0.92 }}
        whileTap={{ scale: selected ? 0.97 : 0.86 }}
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
  const t = useT().home;

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [selected]);

  return (
    <div className={styles.slot}>
      <motion.button
        ref={ref}
        type="button"
        aria-label={t.friendsWorldAria(view.world.name)}
        aria-pressed={selected}
        className={[styles.tile, selected && styles.selected].filter(Boolean).join(" ")}
        style={{ "--kind": KIND_COLORS[view.world.loader] } as React.CSSProperties}
        animate={{ scale: selected ? 1 : 0.88 }}
        whileHover={{ scale: selected ? 1.02 : 0.92 }}
        whileTap={{ scale: selected ? 0.97 : 0.86 }}
        transition={spring}
        onClick={() => select(joinKey(view.world.id))}
      >
        {view.world.cover ? (
          <img
            src={mediaUrl(`joinedthumb/${view.world.id}`, view.world.cover.version)}
            alt=""
            className={styles.thumb}
            draggable={false}
          />
        ) : (
          <LoaderLogo kind={view.world.loader} size={40} className={styles.icon} />
        )}
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
  const t = useT().home;

  return (
    <nav className={styles.row} aria-label={t.worlds}>
      {instances.map((i) => (
        <Tile key={i.id} instance={i} selected={i.id === selectedId} />
      ))}
      {joined.map((j) => (
        <JoinedTile key={j.world.id} view={j} selected={joinKey(j.world.id) === selectedId} />
      ))}
      {/* Yeni dünya ve katıl: dünya kutucuğu gibi görünmesin diye ayrı, küçük bir cam kapsül. */}
      <div className={styles.actions}>
        <motion.button
          type="button"
          aria-label={t.newWorld}
          title={t.newWorld}
          className={styles.actionButton}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={spring}
          onClick={() => setView("setup")}
        >
          <Plus size={22} aria-hidden />
        </motion.button>
        <motion.button
          type="button"
          aria-label={t.joinFriend}
          title={t.joinFriend}
          className={styles.actionButton}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          transition={spring}
          onClick={() => openJoin("")}
        >
          <LogIn size={20} aria-hidden />
        </motion.button>
      </div>
    </nav>
  );
}
