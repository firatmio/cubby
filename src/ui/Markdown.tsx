import { memo, useEffect, useMemo, useRef, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useT } from "../i18n";
import { openExternal } from "../lib/api";
import styles from "./Markdown.module.css";

/** Video gömmeleri (YouTube vb.) yerine bağlantı: uygulama içinde iframe çalışmaz. */
function replaceEmbeds(html: string, label: string): string {
  return html.replace(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, (_, src: string) => {
    const url = src.replace(/^\/\//, "https://").replace("youtube.com/embed/", "youtube.com/watch?v=");
    return `<p><a href="${url}">${label} ↗</a></p>`;
  });
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") ?? "";
    if (!src.startsWith("https://")) node.removeAttribute("src");
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
    node.removeAttribute("width");
    node.removeAttribute("height");
  }
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!/^https?:\/\//.test(href)) node.removeAttribute("href");
  }
});

/** Modrinth'in eski `<center>` etiketi: ortalanmış bir kutuya çevrilir. */
function centerToDiv(html: string): string {
  return html.replace(/<center>/gi, '<div data-center="">').replace(/<\/center>/gi, "</div>");
}

function render(source: string, videoLabel: string): string {
  const raw = marked.parse(source, { gfm: true, breaks: false, async: false }) as string;
  return DOMPurify.sanitize(centerToDiv(replaceEmbeds(raw, videoLabel)), {
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe", "video", "audio", "object", "embed"],
    FORBID_ATTR: ["style", "class", "id"],
    ADD_ATTR: ["data-center"],
  });
}

/**
 * Mod açıklamaları: Markdown (içinde HTML de olabilir) → temizlenmiş HTML.
 * Betik, olay öznitelikleri ve iframe atılır; bağlantılar tarayıcıda açılır, uygulamada gezinme olmaz.
 */
export const Markdown = memo(function Markdown({ source }: { source: string }) {
  const t = useT().common;
  const html = useMemo(() => render(source, t.openVideo), [source, t.openVideo]);
  const ref = useRef<HTMLDivElement>(null);

  // Yüklenemeyen görseller (ölü bağlantılar) boşluk bırakmasın. `error` olayı kabarcıklanmaz ve
  // içeriği React çizmediği için yakalama aşamasında yerel dinleyiciyle tutulur.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onError = (e: Event) => {
      const img = e.target as HTMLElement;
      if (img.tagName === "IMG") img.style.display = "none";
    };
    el.addEventListener("error", onError, true);
    return () => el.removeEventListener("error", onError, true);
  }, []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href");
    if (href) openExternal(href);
  };

  return (
    <div
      ref={ref}
      className={styles.md}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
