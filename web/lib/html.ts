/** Sunucuda üretilen sayfalar: davet, bulunamadı ve ana sayfa. Dış kaynak yok, stil satır içi. */

import { formatCode } from "./code.js";
import { TEXT, type Lang } from "./i18n.js";

export const DOWNLOAD_URL = "https://github.com/firatmio/mc-server-manager/releases/latest";
export const APP_SCHEME = "cubby";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
:root{color-scheme:dark;--bg:#202020;--surface:#2b2b2b;--line:rgba(255,255,255,.08);--text:#f2f2f2;--text-2:#a0a0a0;
--primary:#fff;--on-primary:#151515;--accent:#6cc04a;--warn:#f0b44c}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f4f2;--surface:#fff;--line:rgba(0,0,0,.08);
--text:#1b1b1b;--text-2:#5e5e5e;--primary:#1b1b1b;--on-primary:#fff;--accent:#3f8f2a;--warn:#9a6400}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--text);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.5;
display:grid;place-items:center;min-height:100vh;padding:24px 16px;
background-image:radial-gradient(60rem 30rem at 50% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent)}
main{width:100%;max-width:460px;background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:32px 28px;
box-shadow:0 24px 60px rgba(0,0,0,.25)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;margin-bottom:28px}
.brand img{width:32px;height:32px;border-radius:9px}
.eyebrow{margin:0;color:var(--text-2);font-size:14px}
h1{margin:4px 0 6px;font-size:28px;line-height:1.2;overflow-wrap:anywhere}
.tech{display:inline-block;margin:0 0 24px;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--accent) 16%,transparent);
color:var(--accent);font-size:13px;font-weight:600}
.actions{display:grid;gap:10px}
.btn{display:flex;align-items:center;justify-content:center;height:48px;border-radius:999px;font-weight:600;font-size:15px;
text-decoration:none;border:1px solid var(--line);color:var(--text);background:transparent}
.btn:hover{background:color-mix(in srgb,var(--text) 6%,transparent)}
.btn.primary{background:var(--primary);color:var(--on-primary);border-color:transparent}
.btn.primary:hover{opacity:.9}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.code{margin:28px 0 0;padding:16px;border-radius:16px;background:color-mix(in srgb,var(--text) 5%,transparent);text-align:center}
.code small{display:block;color:var(--text-2);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.code b{display:block;margin:4px 0;font-family:"Cascadia Mono",ui-monospace,monospace;font-size:34px;letter-spacing:.12em}
.code span{color:var(--text-2);font-size:13px}
.note{margin:20px 0 0;color:var(--text-2);font-size:13px}
.mobile{display:none;margin:0 0 20px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--warn) 14%,transparent);
color:var(--warn);font-size:14px}
@media (max-width:720px),(pointer:coarse){.mobile{display:block}}
@media (max-width:420px){main{padding:24px 18px}h1{font-size:24px}.code b{font-size:28px}}
`;

function layout(lang: Lang, head: { title: string; desc: string; url: string; image: string }, body: string): string {
  const h = Object.fromEntries(Object.entries(head).map(([k, v]) => [k, escapeHtml(v)])) as typeof head;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h.title}</title>
<meta name="description" content="${h.desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cubby">
<meta property="og:title" content="${h.title}">
<meta property="og:description" content="${h.desc}">
<meta property="og:url" content="${h.url}">
<meta property="og:image" content="${h.image}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#202020">
<link rel="icon" href="/icon.png">
<style>${STYLE}</style>
</head>
<body>
<main>
<div class="brand"><img src="/icon.png" alt=""> Cubby</div>
${body}
</main>
</body>
</html>`;
}

export interface InviteView {
  lang: Lang;
  origin: string;
  code: string;
  world: string;
  /** "Fabric 0.19.5 · Minecraft 1.21.1" */
  tech: string;
}

export function invitePage(v: InviteView): string {
  const t = TEXT[v.lang];
  const deep = `${APP_SCHEME}://join?c=${v.code}`;
  return layout(
    v.lang,
    {
      title: t.inviteTitle(v.world),
      desc: t.inviteDesc(v.tech),
      url: `${v.origin}/${v.code}`,
      image: `${v.origin}/icon.png`,
    },
    `<p class="mobile">${escapeHtml(t.desktopOnly)}</p>
<p class="eyebrow">${escapeHtml(t.eyebrow)}</p>
<h1>${escapeHtml(v.world)}</h1>
<p class="tech">${escapeHtml(v.tech)}</p>
<div class="actions">
<a class="btn primary" href="${escapeHtml(deep)}">${escapeHtml(t.open)}</a>
<a class="btn" href="${DOWNLOAD_URL}" rel="noopener">${escapeHtml(t.download)}</a>
</div>
<div class="code"><small>${escapeHtml(t.codeLabel)}</small><b>${escapeHtml(formatCode(v.code))}</b><span>${escapeHtml(t.codeHint)}</span></div>
<p class="note">${escapeHtml(t.notInstalled)}</p>`,
  );
}

export function messagePage(lang: Lang, origin: string, title: string, text: string): string {
  const t = TEXT[lang];
  return layout(
    lang,
    { title, desc: text, url: origin, image: `${origin}/icon.png` },
    `<h1>${escapeHtml(title)}</h1>
<p class="eyebrow" style="margin-bottom:24px">${escapeHtml(text)}</p>
<div class="actions"><a class="btn primary" href="${DOWNLOAD_URL}" rel="noopener">${escapeHtml(t.download)}</a></div>`,
  );
}

export function homePage(lang: Lang, origin: string): string {
  const t = TEXT[lang];
  return layout(
    lang,
    { title: t.homeTitle, desc: t.homeDesc, url: origin, image: `${origin}/icon.png` },
    `<h1>${escapeHtml(t.homeHeading)}</h1>
<p class="eyebrow" style="margin-bottom:24px">${escapeHtml(t.homeDesc)}</p>
<div class="actions"><a class="btn primary" href="${DOWNLOAD_URL}" rel="noopener">${escapeHtml(t.download)}</a></div>`,
  );
}
