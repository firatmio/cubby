/**
 * Sunucuda üretilen sayfalar: davet, bulunamadı ve 404. Görsel dil uygulamanınki: arkada dünyanın
 * kapağı (yoksa vurgu renginde ışıltı), sol altta büyük ad, cam kartlar, beyaz hap düğmeler. Dış kaynak
 * yok; stil satır içi, betik yalnız davet sayfasında ve nonce'lu.
 */

import { formatCode } from "./code.js";
import { TEXT, type Lang } from "./i18n.js";
import type { StatusView } from "./meta.js";
import type { SharedView } from "./shared.js";

export const DOWNLOAD_URL = "https://github.com/firatmio/cubby/releases/latest";
/** En son kurulum dosyasına yönlendiren kendi adresimiz (`/api/download`). */
export const DOWNLOAD_PATH = "/download";
export const APP_SCHEME = "cubby";

/** Paylaşılan davet linki (uygulamadaki `short_invite::web_link` ile aynı). */
export const joinUrl = (origin: string, code: string) => `${origin}/join/${code}`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
:root{color-scheme:dark;--bg:#161616;--glass:rgba(36,36,36,.62);--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.16);
--text:#f2f2f2;--text-2:#a8a8a8;--text-3:#6b6b6b;--accent:#6cc04a;--warn:#f0b44c;--mono:"Cascadia Mono","JetBrains Mono",ui-monospace,monospace}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;background:var(--bg);color:var(--text);font-family:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.5;
-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
a{color:inherit}
.bg{position:fixed;inset:0;z-index:-2;background:var(--bg) center/cover no-repeat}
.bg.glow{background:radial-gradient(ellipse 55% 60% at 80% 0%,rgba(108,192,74,.26),transparent 70%),
radial-gradient(ellipse 45% 50% at 0% 100%,rgba(108,192,74,.12),transparent 70%),linear-gradient(#1e1e1e,#151515)}
.scrim{position:fixed;inset:0;z-index:-1;background:linear-gradient(to top,rgba(22,22,22,.97) 0%,rgba(22,22,22,.6) 42%,rgba(22,22,22,.22) 72%,rgba(22,22,22,.55) 100%),
linear-gradient(to right,rgba(22,22,22,.72),rgba(22,22,22,0) 62%)}
.bar{display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 32px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none}
.brand img{width:28px;height:28px;border-radius:8px}
.bar .link{color:var(--text-2);font-size:14px;text-decoration:none}
.bar .link:hover{color:var(--text)}
.page{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 380px;align-items:end;gap:48px;padding:24px 64px 56px}
.page.single{grid-template-columns:minmax(0,760px)}
.eyebrow{margin:0;color:var(--text-2);font-size:19px;font-weight:500}
h1{margin:6px 0 10px;font-size:clamp(40px,7vw,88px);font-weight:650;line-height:1.02;letter-spacing:-.04em;overflow-wrap:anywhere;
text-shadow:0 2px 24px rgba(0,0,0,.35)}
.tech{margin:0;color:var(--text-2);font-size:16px}
.status{display:flex;align-items:center;gap:10px;margin:14px 0 0;font-size:17px;font-weight:500}
.status .dot{width:9px;height:9px;border-radius:50%;background:var(--text-3)}
.status.open .dot{background:var(--accent);box-shadow:0 0 0 4px rgba(108,192,74,.2)}
.status.closed{color:var(--text-2)}
.lede{max-width:560px;margin:10px 0 0;color:var(--text-2);font-size:17px}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:54px;padding:0 28px;border:1px solid var(--line-strong);
border-radius:999px;background:rgba(255,255,255,.06);color:var(--text);font:inherit;font-size:16px;font-weight:600;text-decoration:none;cursor:pointer;
backdrop-filter:blur(14px)}
.btn:hover{background:rgba(255,255,255,.12)}
.btn.primary{border-color:transparent;background:#fff;color:#151515}
.btn.primary:hover{background:#e9e9e9}
.btn.small{height:40px;padding:0 18px;font-size:14px}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.btn small{color:var(--text-3);font-weight:500}
.mods{max-width:560px;margin:18px 0 0;color:var(--text-2);font-size:14px}
.panel{display:grid;gap:22px;padding:24px;border:1px solid var(--line);border-radius:24px;background:var(--glass);backdrop-filter:blur(18px) saturate(1.2);
box-shadow:0 12px 40px rgba(0,0,0,.3)}
.panel small{display:block;margin-bottom:10px;color:var(--text-2);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.cells{display:flex;align-items:center;gap:7px;margin-bottom:14px;font-family:var(--mono);font-size:26px;font-weight:700}
.cells span{display:grid;place-items:center;width:44px;height:54px;border:1px solid var(--line-strong);border-radius:12px;background:rgba(255,255,255,.06)}
.cells i{width:12px;height:2px;background:var(--text-3)}
.guide{padding-top:20px;border-top:1px solid var(--line)}
.guide b{font-size:16px}
.guide ol{margin:10px 0 0;padding-left:20px;color:var(--text-2);font-size:14px}
.guide li{padding:3px 0}
.guide .alert{display:none;margin:12px 0 0;padding:10px 12px;border-radius:12px;background:rgba(240,180,76,.14);color:var(--warn);font-size:14px}
.guide.missing .alert{display:block}
.guide.missing b{color:var(--warn)}
.mobile{display:none;margin:0 0 18px;padding:12px 14px;border-radius:14px;background:rgba(240,180,76,.14);color:var(--warn);font-size:15px}
.only-mobile{display:none}
@media (max-width:900px){.page{grid-template-columns:1fr;align-items:start;gap:28px;padding:16px 20px 32px}.bar{padding:0 20px}
.hero{padding-top:18vh}.eyebrow{font-size:16px}}
@media (pointer:coarse),(max-width:720px){.mobile{display:block}.only-desktop{display:none}.only-mobile{display:inline-flex}}
@media (max-width:420px){.cells{font-size:22px}.cells span{width:38px;height:48px}.btn{width:100%}}
`;

type Head = {
  title: string;
  desc: string;
  url: string;
  /** Link önizlemesinin görseli (mutlak adres). */
  image: string;
  /** Büyük görselli önizleme (kapak varsa). */
  large?: boolean;
  /** Arama motorları dizinlemesin. */
  noindex?: boolean;
};

type Shell = {
  /** Arka plan görseli (kapak); yoksa ışıltı. */
  background?: string | null;
  /** Satır içi betik ve nonce'u. */
  script?: { nonce: string; code: string };
  /** Sağ üstteki bağlantı ("Cubby nedir?"). */
  topLink?: string;
};

function layout(lang: Lang, head: Head, shell: Shell, body: string): string {
  const e = escapeHtml;
  const bg = shell.background
    ? `<div class="bg" style="background-image:url('${e(shell.background)}')"></div>`
    : `<div class="bg glow"></div>`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(head.title)}</title>
<meta name="description" content="${e(head.desc)}">${head.noindex ? `
<meta name="robots" content="noindex">` : ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cubby">
<meta property="og:title" content="${e(head.title)}">
<meta property="og:description" content="${e(head.desc)}">
<meta property="og:url" content="${e(head.url)}">
<meta property="og:image" content="${e(head.image)}">${head.large ? `
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">` : ""}
<meta name="twitter:card" content="${head.large ? "summary_large_image" : "summary"}">
<meta name="theme-color" content="#161616">
<link rel="icon" href="/icon.png">
<style>${STYLE}</style>
</head>
<body>
${bg}
<div class="scrim"></div>
<header class="bar">
<a class="brand" href="/"><img src="/icon.png" alt=""> Cubby</a>
${shell.topLink ? `<a class="link" href="/">${e(shell.topLink)}</a>` : ""}
</header>
${body}${shell.script ? `
<script nonce="${shell.script.nonce}">${shell.script.code}</script>` : ""}
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
  /** Davet edenin oyundaki adı. */
  host: string | null;
  /** Kapağın adresi (göreli) ya da yok. */
  cover: string | null;
  status: StatusView | null;
  /** Ortak dünyaysa: kim açık, kim açabilir. */
  shared: SharedView | null;
  /** Oyuncuda gereken mod sayısı (0 ya da bilinmiyorsa gösterilmez). */
  mods: number;
  /** "12 MB"; bilinmiyorsa boş. */
  downloadSize: string;
  nonce: string;
}

/**
 * Durum satırı ("Açık · 2 oyuncu oyunda"). Ortak dünyada kimin açtığı ya da kimlerin açabileceği de
 * yazar; en güncel hâl birinde kaldıysa onu bekler. Bilinmiyorsa null.
 */
export function statusLine(
  lang: Lang,
  status: StatusView | null,
  shared: SharedView | null,
): { state: "open" | "closed"; text: string } | null {
  const t = TEXT[lang];
  if (status?.state === "open") {
    if (shared?.host) return { state: "open", text: t.sharedOpen(shared.host, status.players) };
    return { state: "open", text: status.players > 0 ? t.statusOpenPlayers(status.players) : t.statusOpenEmpty };
  }
  if (shared?.waitFor) return { state: "closed", text: t.sharedWait(shared.waitFor) };
  if (shared && shared.names.length > 0) return { state: "closed", text: t.sharedCanOpen(shared.names) };
  if (status?.state === "closed") return { state: "closed", text: t.statusClosed };
  return null;
}

/** Kod hücreleri: K 7 M – 2 Q X. */
function cells(code: string): string {
  const c = [...code].map((ch) => `<span>${escapeHtml(ch)}</span>`);
  return `<div class="cells" aria-label="${escapeHtml(formatCode(code))}">${c.slice(0, 3).join("")}<i></i>${c.slice(3).join("")}</div>`;
}

/** Kopyala düğmeleri ve "Cubby açılmadı mı?" algısı. */
function inviteScript(code: string, copied: string): string {
  return `(()=>{const code=${JSON.stringify(formatCode(code))},done=${JSON.stringify(copied)};
const copy=async(b,text)=>{try{await navigator.clipboard.writeText(text);if(b){const o=b.textContent;b.textContent=done;setTimeout(()=>b.textContent=o,1600)}}catch(e){}};
const $=(id)=>document.getElementById(id);
$("copy")?.addEventListener("click",(e)=>copy(e.currentTarget,code));
$("copy-link")?.addEventListener("click",(e)=>copy(e.currentTarget,location.href));
$("download")?.addEventListener("click",()=>copy(null,code));
let t;const stop=()=>clearTimeout(t);
$("open")?.addEventListener("click",()=>{stop();t=setTimeout(()=>{if(!document.hidden&&document.hasFocus()){const g=$("guide");g.classList.add("missing");g.scrollIntoView({behavior:"smooth",block:"nearest"})}},1600)});
addEventListener("blur",stop);document.addEventListener("visibilitychange",()=>document.hidden&&stop());})();`;
}

export function invitePage(v: InviteView): string {
  const t = TEXT[v.lang];
  const e = escapeHtml;
  const deep = `${APP_SCHEME}://join?c=${v.code}`;
  const coverUrl = v.cover ? `${v.origin}${v.cover}` : null;
  const line = statusLine(v.lang, v.status, v.shared);
  const status = line ? `<p class="status ${line.state}"><span class="dot"></span>${e(line.text)}</p>` : "";
  const size = v.downloadSize ? ` <small>${e(v.downloadSize)}</small>` : "";
  return layout(
    v.lang,
    {
      title: v.host ? `${v.world} — ${t.hostInvites(v.host)}` : t.inviteTitle(v.world),
      desc: t.inviteDesc(v.tech),
      url: joinUrl(v.origin, v.code),
      image: coverUrl ?? `${v.origin}/icon.png`,
      large: !!coverUrl,
      // Davetler arkadaşlar arası; aramada çıkmasın.
      noindex: true,
    },
    { background: v.cover, script: { nonce: v.nonce, code: inviteScript(v.code, t.copied) }, topLink: t.whatIsCubby },
    `<main class="page">
<section class="hero">
<p class="mobile">${e(t.desktopOnly)}</p>
<p class="eyebrow">${e(v.host ? t.hostInvites(v.host) : t.eyebrow)}</p>
<h1>${e(v.world)}</h1>
<p class="tech">${e(v.tech)}</p>
${status}
<div class="actions">
<a class="btn primary only-desktop" id="open" href="${e(deep)}">${e(t.open)}</a>
<a class="btn only-desktop" id="download" href="${DOWNLOAD_PATH}">${e(t.download)}${size}</a>
<button class="btn primary only-mobile" id="copy-link" type="button">${e(t.copyLink)}</button>
</div>
${v.mods > 0 ? `<p class="mods">${e(t.modsNote(v.mods))}</p>` : ""}
</section>
<aside class="panel">
<div>
<small>${e(t.codeLabel)}</small>
${cells(v.code)}
<button class="btn small" id="copy" type="button">${e(t.copyCode)}</button>
</div>
<div class="guide" id="guide">
<b>${e(t.guideTitle)}</b>
<ol>
<li>${e(t.guide1(v.downloadSize))}</li>
<li>${e(t.guide2)}</li>
<li>${e(t.guide3)}</li>
</ol>
<p class="alert">${e(t.notDetected)}</p>
</div>
</aside>
</main>`,
  );
}

/** Tek mesajlı sayfa (davet bulunamadı, çok deneme). `retry`: sitedeki Katıl'a dönüp başka kod yazılabilir. */
export function messagePage(lang: Lang, origin: string, title: string, text: string, retry = false): string {
  const t = TEXT[lang];
  const e = escapeHtml;
  return layout(
    lang,
    { title, desc: text, url: origin, image: `${origin}/icon.png`, noindex: true },
    { topLink: t.whatIsCubby },
    `<main class="page single">
<section class="hero">
<h1>${e(title)}</h1>
<p class="lede">${e(text)}</p>
<div class="actions">${
      retry
        ? `<a class="btn primary" href="/#join">${e(t.tryAnother)}</a><a class="btn" href="${DOWNLOAD_PATH}">${e(t.download)}</a>`
        : `<a class="btn primary" href="${DOWNLOAD_PATH}">${e(t.download)}</a><a class="btn" href="/">${e(t.backHome)}</a>`
    }</div>
</section>
</main>`,
  );
}

/** Bilinmeyen her adres (404). */
export function notFoundPage(lang: Lang, origin: string): string {
  const t = TEXT[lang];
  const e = escapeHtml;
  return layout(
    lang,
    { title: `${t.pageNotFoundTitle} — Cubby`, desc: t.pageNotFoundText, url: origin, image: `${origin}/icon.png`, noindex: true },
    {},
    `<main class="page single">
<section class="hero">
<p class="eyebrow">404</p>
<h1>${e(t.pageNotFoundTitle)}</h1>
<p class="lede">${e(t.pageNotFoundText)}</p>
<div class="actions"><a class="btn primary" href="/">${e(t.backHome)}</a><a class="btn" href="${DOWNLOAD_PATH}">${e(t.download)}</a></div>
</section>
</main>`,
  );
}
