import type { Transition, Variants } from "motion/react";

/** Arayüzün tek yay eğrisi: sakin, zıplamasız. */
export const spring: Transition = { type: "spring", stiffness: 260, damping: 30 };

/** Hızlı geri bildirim (basma, odak). */
export const snappy: Transition = { type: "spring", stiffness: 420, damping: 32 };

/** Dünya değişince arka plan çapraz geçişi. */
export const crossfade: Transition = { duration: 0.7, ease: [0.22, 1, 0.36, 1] };

/** İçerik grubunun çocukları 40 ms arayla belirir. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
  exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
};

/** 8px aşağıdan yumuşak belirme. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

/** Ekranlar arası geçiş (ana ekran ↔ kurulum). */
export const screen: Variants = {
  hidden: { opacity: 0, scale: 0.985 },
  show: { opacity: 1, scale: 1, transition: { ...spring, opacity: { duration: 0.25 } } },
  exit: { opacity: 0, scale: 1.01, transition: { duration: 0.2 } },
};

/** Basınca hafif küçülme. */
export const press = { whileTap: { scale: 0.97 }, transition: snappy } as const;

/**
 * Kurulum adımları arasında yatay kayma: yeni sayfa bir yandan girerken eskisi öbür yandan çıkar.
 * `custom` = yön (1 ileri, -1 geri). Pencere sabit olduğundan vw ile ekran dışına tam taşınır.
 */
export const slide: Variants = {
  enter: (dir: number) => ({ x: `${dir * 100}vw` }),
  center: { x: "0vw", transition: { type: "spring", stiffness: 220, damping: 30 } },
  exit: (dir: number) => ({ x: `${-dir * 100}vw`, transition: { type: "spring", stiffness: 220, damping: 30 } }),
};
