import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./HelpTip.module.css";

const GAP = 10;
const MARGIN = 8;

/**
 * Soru işareti ve açıklama balonu. Balon pencereye sabitlenir (portal): kaydırılan tabloların ya da
 * panellerin kenarında kesilmez. Sağda yer varsa sağa, yoksa sola açılır; üzerine gelince ya da
 * klavyeyle odaklanınca görünür.
 */
export function HelpTip({ text, label }: { text: string; label?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = button.current?.getBoundingClientRect();
    const t = tip.current?.getBoundingClientRect();
    if (!b || !t) return;
    const right = b.right + GAP;
    const left = right + t.width + MARGIN <= window.innerWidth ? right : Math.max(MARGIN, b.left - GAP - t.width);
    const top = Math.min(
      Math.max(MARGIN, b.top + b.height / 2 - t.height / 2),
      window.innerHeight - t.height - MARGIN,
    );
    setPos({ left, top });
  }, [open, text]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-label={label ?? text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            className={styles.tip}
            style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: "hidden" }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
