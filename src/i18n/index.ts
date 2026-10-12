import { create } from "zustand";
import en from "./en";
import tr, { type Dict } from "./tr";

export type Lang = "tr" | "en";
export type { Dict };

const DICTS: Record<Lang, Dict> = { tr, en };

/** Ayarlar gelene kadar tarayıcının (WebView'ın) diline göre tahmin; sonra Rust'ın etkin dili. */
function guess(): Lang {
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: guess(),
  setLang: (lang) => {
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

/** Bileşenlerde: dil değişince yeniden çizilir. */
export function useT(): Dict {
  return DICTS[useLang((s) => s.lang)];
}

/** Bileşen dışı yerlerde (biçimlendiriciler, olaylar). Kök bileşen dile abone olduğu için ekran yine güncellenir. */
export function getT(): Dict {
  return DICTS[useLang.getState().lang];
}

/** Tarih ve sayı biçimleri için. */
export function locale(): string {
  return useLang.getState().lang === "tr" ? "tr-TR" : "en-US";
}
