import { useCallback, useRef } from "react";

/**
 * Kaydırılabilen bir alanın kenarlarında yumuşak solma: yukarıda ya da aşağıda gizli içerik varsa o
 * kenar solar (`data-fade="top bottom"`, stil `global.css`'te). İçerik değişince (liste yüklendi,
 * bölüm açıldı) ve boyut değişince yeniden hesaplanır.
 */
export function useScrollFade<T extends HTMLElement = HTMLDivElement>() {
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;

    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      el.dataset.fade = [top && "top", bottom && "bottom"].filter(Boolean).join(" ");
    };
    const resize = new ResizeObserver(update);
    const watch = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of Array.from(el.children)) resize.observe(child);
      update();
    };
    const mutations = new MutationObserver(watch);
    mutations.observe(el, { childList: true, subtree: true });
    el.addEventListener("scroll", update, { passive: true });
    watch();

    cleanup.current = () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);
}
