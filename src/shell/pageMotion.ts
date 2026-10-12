import { motionValue } from "motion/react";

/**
 * Oyna ↔ Keşfet şeridinin yatay konumu (piksel). Sayfalar da arka planları da bu değeri kullanır;
 * böylece dünyanın kapağı Oyna ile birlikte kayıp gider, Keşfet kendi zemininle gelir.
 */
export const pageX = motionValue(0);
