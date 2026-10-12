import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Users } from "lucide-react";
import { mediaUrl, type LoaderKind } from "../../lib/api";
import { useT } from "../../i18n";
import { LOADER_LABELS } from "../../lib/format";
import { spring } from "../../lib/motion";
import { joinKey, useAppStore } from "../../store/appStore";
import { LoaderLogo } from "../../ui/LoaderLogo";
import styles from "./Discover.module.css";

type Entry = {
  key: string;
  name: string;
  loader: LoaderKind;
  mc: string;
  thumb: string | null;
  friend: boolean;
};

function Thumb({ e, size }: { e: Entry; size: number }) {
  return (
    <span className={styles.thumb} style={{ width: size, height: size }}>
      {e.thumb ? <img src={e.thumb} alt="" draggable={false} /> : <LoaderLogo kind={e.loader} size={size * 0.6} />}
      {e.friend && (
        <span className={styles.thumbBadge}>
          <Users size={10} aria-hidden />
        </span>
      )}
    </span>
  );
}

/** Keşfet hangi dünya için: Oyna'daki seçimle ortak. Tıklayınca bütün dünyalar listelenir. */
export function WorldPicker() {
  const instances = useAppStore((s) => s.instances);
  const joined = useAppStore((s) => s.joined);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const entries: Entry[] = [
    ...instances.map((i) => ({
      key: i.id,
      name: i.name,
      loader: i.loader,
      mc: i.mcVersion,
      thumb: i.cover ? mediaUrl(`thumb/${i.id}`, i.cover.version) : null,
      friend: false,
    })),
    ...joined.map((j) => ({
      key: joinKey(j.world.id),
      name: j.world.name,
      loader: j.world.loader,
      mc: j.world.mcVersion,
      thumb: null,
      friend: true,
    })),
  ];
  const current = entries.find((e) => e.key === selectedId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!current) return null;
  const caption = (e: Entry) =>
    `${e.friend ? `${t.discover.friendsWorld} · ` : ""}${LOADER_LABELS[e.loader]} ${e.mc}`;

  return (
    <div ref={ref} className={styles.picker}>
      <button
        type="button"
        className={styles.pickerButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Thumb e={current} size={40} />
        <span className={styles.pickerText}>
          <span className={styles.pickerName}>{current.name}</span>
          <span className={styles.pickerCaption}>{caption(current)}</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={spring} className={styles.pickerChevron}>
          <ChevronDown size={18} aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.pickerMenu}
            role="listbox"
            aria-label={t.discover.pickWorld}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={spring}
          >
            {entries.map((e) => (
              <button
                key={e.key}
                type="button"
                role="option"
                aria-selected={e.key === selectedId}
                className={styles.pickerItem}
                onClick={() => {
                  select(e.key);
                  setOpen(false);
                }}
              >
                <Thumb e={e} size={32} />
                <span className={styles.pickerText}>
                  <span className={styles.pickerName}>{e.name}</span>
                  <span className={styles.pickerCaption}>{caption(e)}</span>
                </span>
                {e.key === selectedId && <Check size={16} aria-hidden className={styles.pickerCheck} />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
