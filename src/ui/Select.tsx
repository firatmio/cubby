import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import styles from "./Select.module.css";

type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

const GAP = 6;
const MARGIN = 8;
/** Menü en fazla bu kadar uzar; fazlası kayar. */
const MAX_HEIGHT = 260;

type Place = { left: number; width: number; top?: number; bottom?: number; up: boolean };

/**
 * Hap görünümlü açılır liste. Menü pencereye sabit (portal): kaydırılan tablolarda ve panellerde
 * kesilmez; aşağıda yer yoksa yukarı açılır. Klavye: ↑/↓ gezinir, Enter/boşluk seçer, Esc kapatır,
 * harfe basınca o harfle başlayana atlar. Kaydırma ya da pencere boyutu değişince kapanır.
 */
export function Select({ options, value, onChange, disabled, className, "aria-label": ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const current = options[selected];

  const measure = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const need = Math.min(MAX_HEIGHT, options.length * 34 + 8);
    const up = below < need && above > below;
    setPlace({
      left: r.left,
      width: r.width,
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
      up,
    });
  };

  const show = () => {
    if (disabled) return;
    setActive(selected);
    measure();
    setOpen(true);
  };

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };

  const pick = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close();
  };

  // Dışarı tıklama, kaydırma ve pencere boyutu menüyü kapatır.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const scroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close(false);
    };
    const resize = () => close(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  // Etkin seçenek görünür olsun. `scrollIntoView` değil: o, sayfayı da kaydırıp menüyü kapatıyordu.
  useLayoutEffect(() => {
    const m = menu.current;
    const el = m?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!open || !m || !el) return;
    if (el.offsetTop < m.scrollTop) m.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > m.scrollTop + m.clientHeight)
      m.scrollTop = el.offsetTop + el.offsetHeight - m.clientHeight;
  }, [open, active, place]);

  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(active);
        break;
      case "Escape":
        // Yalnız menü kapansın; panel (Sheet) Esc'i pencerede dinliyor.
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (e.key.length === 1) {
          const ch = e.key.toLocaleLowerCase();
          const start = (active + 1) % options.length;
          const order = [...options.slice(start), ...options.slice(0, start)];
          const hit = order.find((o) => o.label.toLocaleLowerCase().startsWith(ch));
          if (hit) setActive(options.indexOf(hit));
        }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={[styles.trigger, open && styles.open, className].filter(Boolean).join(" ")}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
      >
        <span className={styles.value}>{current?.label ?? value}</span>
        <ChevronDown size={14} className={styles.chevron} aria-hidden />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && place && (
            <motion.div
              ref={menu}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              className={styles.menu}
              style={{
                left: place.left,
                width: place.width,
                top: place.top,
                bottom: place.bottom,
                maxHeight: MAX_HEIGHT,
                transformOrigin: place.up ? "bottom center" : "top center",
              }}
              initial={{ opacity: 0, scale: 0.96, y: place.up ? 4 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: place.up ? 4 : -4 }}
              transition={{ duration: 0.12, ease: [0.2, 0.9, 0.3, 1] }}
              onKeyDown={onKey}
            >
              {options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  data-index={i}
                  aria-selected={i === selected}
                  className={[styles.option, i === active && styles.active].filter(Boolean).join(" ")}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  <span className={styles.optionLabel}>{o.label}</span>
                  {i === selected && <Check size={14} className={styles.check} aria-hidden />}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
