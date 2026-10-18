/**
 * Ana site (`/`): ilk ekran Cubby'nin Oyna ekranı gibi (kapak, büyük ad, bilgi şeridi, sağ altta
 * İndir), aşağısı görselli yan yana anlatım. Sunucuda iki dilde üretilir; betik yok (SSS `details`).
 * Görseller `public/site/` altında, uygulamanın gerçek ekranlarından.
 */

import { DOWNLOAD_PATH, escapeHtml } from "./html.js";
import type { Lang } from "./i18n.js";
import { formatSize, type LatestRelease } from "./release.js";

const REPO_URL = "https://github.com/firatmio/cubby";

const TEXT = {
  tr: {
    title: "Cubby — Arkadaşlarınla kendi Minecraft dünyan",
    desc: "Cubby, Minecraft sunucunu kurar, açar ve arkadaşlarını 6 karakterlik bir kodla bağlar. Modem ayarı yok, kiralık sunucu yok.",
    nav: ["Ana sayfa", "Özellikler", "SSS"],
    caption: "Minecraft sunucu yöneticisi · Windows",
    ready: "Arkadaşlarınla oynamaya hazır",
    readyMore: "modem ayarı yok, kiralık sunucu yok",
    dock: [
      ["Kurulum", "Bir dakika"],
      ["Arkadaşını davet et", ""],
      ["Hızlandırıcı", "Açık"],
    ],
    download: "İndir",
    downloadLong: "Windows için indir",
    meta: (r: LatestRelease | null) =>
      ["Ücretsiz", "Windows 10 / 11", r && formatSize(r.size), r && `v${r.version}`].filter(Boolean).join(" · "),
    codeEyebrow: "6 karakter, hepsi bu",
    codeTitle: "Port açmak yok, IP ezberlemek yok",
    codeText:
      "Arkadaşın kodu Cubby'de Katıl'a yazar ya da linke tıklar. Farklı şehirde, farklı internette olsa da doğrudan bağlanır.",
    rows: [
      {
        img: "kesfet",
        size: [1200, 720],
        eyebrow: "Keşfet",
        title: "Mod, shader, kaynak paketi. Tek tık.",
        text: "Modrinth'in tamamı uygulamanın içinde. Dünyanın sürümüne uyanı, gerektirdikleriyle birlikte kurar.",
        points: ["Mod paketinden tek tıkla yeni dünya", "Arkadaşın gereken modları kendiliğinden alır", "Güncellemeler tek düğmeyle"],
      },
      {
        img: "davet",
        size: [560, 484],
        eyebrow: "Arkadaşını davet et",
        title: "Kodu at, gelsinler",
        text: "Davet linki dünyanın kapağıyla açılır; arkadaşın dünyanın açık olup olmadığını, kimin çağırdığını görür.",
        points: ["WhatsApp ve Discord'da kapaklı önizleme", "Cubby'si yoksa üç adımda kurar", "Kodu yenileyince eski davet geçersiz"],
      },
      {
        img: "performans",
        size: [560, 660],
        eyebrow: "Hızlandırıcı",
        title: "Zayıf bilgisayarda da akıcı",
        text: "Oyunun davranışını değiştirmeden sunucuyu hızlandırır; saf Minecraft dünyalarında da çalışır.",
        points: ["Dünya hazırlama 1,5 kat daha hızlı (ölçtük)", "Sunucu zorlanırsa söyler ve çözüm önerir", "Arkadaşın hiçbir şey kurmaz"],
      },
      {
        img: "oyuncular",
        size: [560, 618],
        eyebrow: "Oyuncular",
        title: "Kim girer, sen seçersin",
        text: "Beyaz liste, yöneticiler ve atma tek ekranda. Premium olmayan (TLauncher) arkadaşlar da güvenle girer.",
        points: ["Girmeye çalışana tek tıkla izin", "Yalnız eklediğin isimler girer", "Kimin oyunda olduğu her an belli"],
      },
    ],
    faqTitle: "Sık sorulanlar",
    faq: [
      [
        "Windows uyarı veriyor, güvenli mi?",
        "Cubby henüz kod imzası almadığı için Windows \"bilinmeyen yayımcı\" diyebilir. \"Ek bilgi\" › \"Yine de çalıştır\" ile açılır. Kaynak kodu GitHub'da incelenebilir.",
      ],
      ["Ücretsiz mi?", "Evet. Sunucu senin bilgisayarında çalışır; kiralık sunucu ya da abonelik yok."],
      [
        "Arkadaşımın da Cubby'si olmalı mı?",
        "Kodla katılmak için evet; ücretsiz ve bir dakikada kurulur, gereken modlar da kendiliğinden gelir. Aynı evdeysen ya da modemden internete açtıysan Cubby'siz adresle de girebilir.",
      ],
      ["Mac ya da Linux'ta çalışır mı?", "Şimdilik yalnız Windows 10 ve 11."],
      [
        "Bilgisayarım kapanınca ne olur?",
        "Dünya senin bilgisayarında durur; sen açınca arkadaşların girebilir. Kapalıyken davet sayfası \"Şu an kapalı\" der.",
      ],
      [
        "TLauncher ile oynayan arkadaşım girebilir mi?",
        "Evet. Premium olmayanlar için beyaz liste açık tutulur, yalnız eklediğin isimler girer.",
      ],
    ],
    finalTitle: "Hadi, dünyanı kur.",
    footer: ["GitHub", "Sürüm notları", "Katıl"],
    rights: "Mojang ya da Microsoft ile bağlantılı değildir.",
  },
  en: {
    title: "Cubby — Your own Minecraft world with your friends",
    desc: "Cubby sets up and runs your Minecraft server and connects your friends with a 6-character code. No port forwarding, no rented server.",
    nav: ["Home", "Features", "FAQ"],
    caption: "Minecraft server manager · Windows",
    ready: "Ready to play with your friends",
    readyMore: "no port forwarding, no rented server",
    dock: [
      ["Setup", "One minute"],
      ["Invite a friend", ""],
      ["Booster", "On"],
    ],
    download: "Download",
    downloadLong: "Download for Windows",
    meta: (r: LatestRelease | null) =>
      ["Free", "Windows 10 / 11", r && formatSize(r.size), r && `v${r.version}`].filter(Boolean).join(" · "),
    codeEyebrow: "6 characters, that's it",
    codeTitle: "No port forwarding, no IPs to remember",
    codeText:
      "Your friend types the code into Join in Cubby or clicks the link. Different city, different internet: they still connect directly.",
    rows: [
      {
        img: "kesfet",
        size: [1200, 720],
        eyebrow: "Discover",
        title: "Mods, shaders, resource packs. One click.",
        text: "All of Modrinth inside the app. It installs what fits your world's version, along with everything it needs.",
        points: ["A new world from a modpack in one click", "Friends get the mods they need automatically", "Updates with one button"],
      },
      {
        img: "davet",
        size: [560, 484],
        eyebrow: "Invite a friend",
        title: "Send the code, they're in",
        text: "The invite link opens on your world's cover; friends see whether it's open and who's inviting them.",
        points: ["Cover previews in WhatsApp and Discord", "No Cubby yet? Three steps to install", "Renew the code and old invites stop working"],
      },
      {
        img: "performans",
        size: [560, 660],
        eyebrow: "Booster",
        title: "Smooth even on a weak PC",
        text: "Speeds up the server without changing how the game plays; works on vanilla worlds too.",
        points: ["World pre-generation 1.5× faster (we measured)", "Tells you when the server struggles, with fixes", "Friends install nothing"],
      },
      {
        img: "oyuncular",
        size: [560, 618],
        eyebrow: "Players",
        title: "You choose who gets in",
        text: "Whitelist, operators and kicking on one screen. Non-premium (TLauncher) friends can join safely too.",
        points: ["Allow someone who tried to join in one click", "Only names you add can join", "Always see who's online"],
      },
    ],
    faqTitle: "FAQ",
    faq: [
      [
        "Windows shows a warning. Is it safe?",
        "Cubby isn't code-signed yet, so Windows may say \"unknown publisher\". Click \"More info\" › \"Run anyway\". The source code can be reviewed on GitHub.",
      ],
      ["Is it free?", "Yes. The server runs on your computer; no rented server, no subscription."],
      [
        "Does my friend need Cubby too?",
        "To join with a code, yes; it's free, installs in a minute and the mods they need come automatically. On the same home network, or if you opened it to the internet, they can also join by address without Cubby.",
      ],
      ["Does it run on Mac or Linux?", "For now, only Windows 10 and 11."],
      [
        "What happens when my computer is off?",
        "The world lives on your computer; friends can join once you open it. While it's closed, the invite page says \"Closed right now\".",
      ],
      ["Can a friend who plays with TLauncher join?", "Yes. The whitelist stays on for non-premium players, so only names you add can join."],
    ],
    finalTitle: "Go on, build your world.",
    footer: ["GitHub", "Release notes", "Join"],
    rights: "Not affiliated with Mojang or Microsoft.",
  },
} as const;

const STYLE = `
:root{color-scheme:dark;--bg:#161616;--glass:rgba(36,36,36,.62);--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.16);
--text:#f2f2f2;--text-2:#a8a8a8;--text-3:#6b6b6b;--accent:#6cc04a;--mono:"Cascadia Mono","JetBrains Mono",ui-monospace,monospace}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font-family:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{display:block;max-width:100%}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:54px;padding:0 30px;border:1px solid var(--line-strong);border-radius:999px;
background:rgba(255,255,255,.06);color:var(--text);font-size:16px;font-weight:600;white-space:nowrap}
.btn.primary{border-color:transparent;background:#fff;color:#151515}
.btn.primary:hover{background:#e9e9e9}
.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.glass{border:1px solid var(--line);border-radius:24px;background:var(--glass);backdrop-filter:blur(18px) saturate(1.2);box-shadow:0 12px 40px rgba(0,0,0,.28)}
.cells{display:inline-flex;align-items:center;gap:.3em;font-family:var(--mono);font-weight:700}
.cells span{display:grid;place-items:center;width:1.5em;height:1.85em;border:1px solid var(--line-strong);border-radius:.32em;background:rgba(255,255,255,.06)}
.cells i{width:.45em;height:2px;background:var(--text-3)}
.eyebrow{margin:0;color:var(--accent);font-size:13px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
h2{margin:10px 0 14px;font-size:clamp(30px,4vw,42px);font-weight:650;line-height:1.1;letter-spacing:-.03em}
.lead{margin:0;color:var(--text-2);font-size:18px}

/* İlk ekran: Cubby'nin Oyna ekranı */
.screen{position:relative;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;overflow:hidden}
.screen .cover{position:absolute;inset:0;z-index:-2;background:url(/site/kapak.webp) center/cover no-repeat;transform:scale(1.03);animation:drift 30s ease-in-out infinite alternate}
@keyframes drift{to{transform:scale(1.08) translate(-.6%,-.4%)}}
@media (prefers-reduced-motion:reduce){.screen .cover{animation:none}}
.screen .scrim{position:absolute;inset:0;z-index:-1;background:linear-gradient(to top,rgba(22,22,22,.97) 0%,rgba(22,22,22,.6) 40%,rgba(22,22,22,.2) 70%,rgba(22,22,22,.55) 100%),
linear-gradient(to right,rgba(22,22,22,.75),rgba(22,22,22,0) 60%)}
.bar{position:relative;display:flex;align-items:center;height:68px;padding:0 32px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700}
.brand img{width:28px;height:28px;border-radius:8px}
.pills{position:absolute;left:50%;display:flex;gap:4px;padding:4px;border-radius:999px;background:rgba(255,255,255,.08);transform:translateX(-50%)}
.pills a{padding:7px 18px;border-radius:999px;color:var(--text-2);font-size:14px;font-weight:600}
.pills a:first-child{background:#fff;color:#151515}
.pills a:not(:first-child):hover{color:var(--text)}
.bar .gh{margin-left:auto;color:var(--text-2);font-size:14px}
.bar .gh:hover{color:var(--text)}
.stage{flex:1;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:32px;padding:24px 64px 56px}
.caption{margin:0;color:var(--text-2);font-size:19px;font-weight:500}
.name{margin:4px 0 26px;font-size:clamp(72px,11vw,136px);font-weight:650;line-height:1;letter-spacing:-.05em;text-shadow:0 2px 24px rgba(0,0,0,.35)}
.status{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0;font-size:18px;font-weight:500}
.status .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(108,192,74,.2)}
.status .more{color:var(--text-2);font-weight:400}
.dock{display:flex;width:max-content;max-width:100%;margin-top:30px;padding:8px}
.item{display:flex;align-items:center;gap:14px;padding:12px 22px 12px 12px}
.item+.item{border-left:1px solid var(--line)}
.icon{display:grid;flex:none;place-items:center;width:42px;height:42px;border-radius:13px;background:rgba(255,255,255,.07);color:var(--text-2)}
.icon svg{width:20px;height:20px}
.item small{display:block;color:var(--text-2);font-size:13px}
.item b{font-size:17px}
.item .cells{font-size:14px}
.play{display:flex;flex-direction:column;align-items:flex-end;gap:12px}
.play .btn{height:66px;padding:0 44px;font-size:19px}
.play .meta{color:var(--text-2);font-size:13px}

/* Gövde */
main{width:min(1180px,100% - 48px);margin:0 auto}
section{padding:120px 0 0}
.band{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:56px;padding:64px}
.band .cells{font-size:clamp(28px,4.4vw,52px)}
.row{display:grid;grid-template-columns:1fr 1.25fr;align-items:center;gap:64px}
.row.flip{grid-template-columns:1.25fr 1fr}
.row.flip .text{order:2}
.shot{overflow:hidden;border:1px solid var(--line-strong);border-radius:18px;box-shadow:0 30px 70px rgba(0,0,0,.5)}
/* Yalnız panelin görüntüsü: gerçek boyutunda, sütunda ortalı (yazılar okunur kalsın). */
.shot.narrow{justify-self:center;width:min(100%,560px);border-radius:28px}
.points{margin:22px 0 0;padding:0;list-style:none;color:var(--text-2)}
.points li{display:flex;gap:10px;padding:5px 0}
.points li::before{content:"";flex:none;width:8px;height:8px;margin-top:9px;border-radius:50%;background:var(--accent)}
.faq{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:36px}
.faq details{padding:22px 24px}
.faq summary{cursor:pointer;font-size:17px;font-weight:600;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";float:right;color:var(--text-3);font-weight:400}
.faq details[open] summary::after{content:"−"}
.faq p{margin:10px 0 0;color:var(--text-2)}
.final{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;margin-top:120px;padding:48px 56px}
.final h2{margin:0}
.final p{margin:6px 0 0;color:var(--text-2)}
footer{display:flex;flex-wrap:wrap;gap:24px;margin-top:80px;padding:36px 0 56px;border-top:1px solid var(--line);color:var(--text-3);font-size:14px}
footer nav{display:flex;gap:20px;margin-left:auto}
footer a:hover{color:var(--text)}

@media (max-width:960px){
.bar{padding:0 20px}.pills{display:none}
.stage{grid-template-columns:1fr;padding:16px 20px 32px}
.play{align-items:stretch}.play .meta{text-align:center}
.dock{flex-direction:column;width:100%}.item+.item{border-left:none;border-top:1px solid var(--line)}
.band,.row,.row.flip{grid-template-columns:1fr;gap:32px}.band{padding:36px 28px}.row.flip .text{order:0}
.faq{grid-template-columns:1fr}.final{padding:36px 28px}
.band .cells{font-size:min(7vw,30px)}.status .more{display:none}
section{padding-top:88px}
}
`;

const ICONS = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`,
};

const cells = (code: string) =>
  `<span class="cells" aria-label="${code.slice(0, 3)}-${code.slice(3)}">${[...code]
    .map((c, i) => (i === 3 ? `<i></i>` : "") + `<span>${c}</span>`)
    .join("")}</span>`;

export function sitePage(lang: Lang, origin: string, release: LatestRelease | null): string {
  const t = TEXT[lang];
  const e = escapeHtml;
  const shot = (name: string) => `/site/${name}-${lang}.webp`;
  const download = (label: string) => `<a class="btn primary" href="${DOWNLOAD_PATH}">${ICONS.download}${e(label)}</a>`;
  const rows = t.rows
    .map(
      (r, i) => `<section class="row${i % 2 ? " flip" : ""}">
<div class="text"><p class="eyebrow">${e(r.eyebrow)}</p><h2>${e(r.title)}</h2><p class="lead">${e(r.text)}</p>
<ul class="points">${r.points.map((p) => `<li>${e(p)}</li>`).join("")}</ul></div>
<div class="shot${r.size[0] < 1000 ? " narrow" : ""}"><img src="${shot(r.img)}" alt="${e(r.title)}" loading="lazy" width="${r.size[0]}" height="${r.size[1]}"></div>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(t.title)}</title>
<meta name="description" content="${e(t.desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Cubby">
<meta property="og:title" content="${e(t.title)}">
<meta property="og:description" content="${e(t.desc)}">
<meta property="og:url" content="${e(origin)}/">
<meta property="og:image" content="${e(origin)}/site/kapak.webp">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#161616">
<link rel="icon" href="/icon.png">
<link rel="preload" as="image" href="/site/kapak.webp">
<style>${STYLE}</style>
</head>
<body>
<div class="screen" id="top">
<div class="cover"></div><div class="scrim"></div>
<header class="bar">
<a class="brand" href="#top"><img src="/icon.png" alt=""> Cubby</a>
<nav class="pills"><a href="#top">${e(t.nav[0])}</a><a href="#ozellikler">${e(t.nav[1])}</a><a href="#sss">${e(t.nav[2])}</a></nav>
<a class="gh" href="${REPO_URL}" rel="noopener">GitHub</a>
</header>
<div class="stage">
<div>
<p class="caption">${e(t.caption)}</p>
<h1 class="name">Cubby</h1>
<p class="status"><span class="dot"></span>${e(t.ready)} <span class="more">· ${e(t.readyMore)}</span></p>
<div class="dock glass">
<div class="item"><span class="icon">${ICONS.globe}</span><span><small>${e(t.dock[0][0])}</small><b>${e(t.dock[0][1])}</b></span></div>
<div class="item"><span class="icon">${ICONS.send}</span><span><small>${e(t.dock[1][0])}</small><b>${cells("K7M2QX")}</b></span></div>
<div class="item"><span class="icon">${ICONS.zap}</span><span><small>${e(t.dock[2][0])}</small><b>${e(t.dock[2][1])}</b></span></div>
</div>
</div>
<div class="play">${download(t.download)}<span class="meta">${e(t.meta(release))}</span></div>
</div>
</div>
<main>
<section id="ozellikler"><div class="band glass">${cells("K7M2QX")}<div><p class="eyebrow">${e(t.codeEyebrow)}</p><h2>${e(t.codeTitle)}</h2><p class="lead">${e(t.codeText)}</p></div></div></section>
${rows}
<section id="sss"><h2>${e(t.faqTitle)}</h2>
<div class="faq">${t.faq.map(([q, a]) => `<details class="glass"><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join("")}</div>
</section>
<div class="final glass"><div><h2>${e(t.finalTitle)}</h2><p>${e(t.meta(release))}</p></div>${download(t.downloadLong)}</div>
<footer><span>© Cubby · ${e(t.rights)}</span><nav><a href="${REPO_URL}" rel="noopener">${e(t.footer[0])}</a><a href="${REPO_URL}/releases" rel="noopener">${e(t.footer[1])}</a><a href="/join">${e(t.footer[2])}</a></nav></footer>
</main>
</body>
</html>`;
}
