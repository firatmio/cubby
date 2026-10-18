/**
 * Özellikler sayfasındaki uygulama görünümleri: ekran görüntüsü yerine Cubby'nin arayüzü HTML/CSS ile
 * yeniden kurulur (Keşfet, Arkadaşını davet et, Hızlandırıcı, Oyuncular). Metinler uygulamanınkiyle
 * aynı; küçük etkileşimler betikte (`UI_SCRIPT`). Keşfet'in görselleri Modrinth'ten, küçültülmüş
 * (`public/site/modrinth/`).
 */

import { escapeHtml as e } from "./html.js";
import type { Lang } from "./i18n.js";

const TEXT = {
  tr: {
    world: "Modlu dünya",
    featured: "Öne çıkan",
    installed: "Kurulu",
    install: "Kur",
    installing: "Kuruluyor…",
    details: "Ayrıntı",
    popular: "Popüler",
    seeAll: "Tümünü gör",
    downloads: (n: string) => `${n} indirme`,
    million: "Mn",
    prev: "Önceki",
    next: "Sonraki",
    invite: "Arkadaşını davet et",
    inviteHint:
      "Arkadaşın Cubby'de Katıl'a bu kodu yazar ya da linke tıklar. Modem ayarı gerekmez; dünyan Minecraft'taki sunucu listesine kendiliğinden eklenir.",
    copyCode: "Kodu kopyala",
    copyLink: "Linki kopyala",
    copied: "Kopyalandı",
    resetInvite: "Kodu yenile",
    withoutCubby: "Arkadaşında Cubby yok mu?",
    withoutCubbyText: "Minecraft'ta Sunucu Ekle'ye yazacağı adres",
    worldSettings: "Dünya ayarları",
    performance: "Performans",
    boostTitle: "Hızlandırıcı",
    boostText:
      "Oyunun davranışını değiştirmeden sunucuyu hızlandırır. Modlar yalnız sunucuda çalışır; arkadaşların bir şey kurmaz.",
    roles: [
      "Oyun mantığı: varlıklar, redstone, yapay zekâ",
      "Chunk üretimi · 8 çekirdekte",
      "Işık hesabı",
      "Bellek kullanımı",
      "Açılış süresi ve bellek",
    ],
    boostOnStart: "Modlar dünya açılırken kurulur.",
    boostJava: "Java ayarları (çöp toplayıcı) her dünyada açık.",
    players: "Oyuncular",
    nowPlaying: "Şu an oyunda",
    worldOff: "Dünya kapalı.",
    whoCanJoin: "Kimler girebilir",
    whitelistOnly: "Sadece listedekiler (beyaz liste)",
    whitelistForced: "Premium olmayanlar girebildiği için açık kalmalı: adresi bilen biri adını taklit edebilir.",
    playerName: "Oyuncu adı",
    add: "Ekle",
    op: "Yetkili",
    makeOp: "Yetkili yap",
    remove: "Çıkar",
    offlineOn: "Premium olmayanlar (TLauncher) de girebilir.",
    changeInWorld: "Dünya ayarlarından değiştir",
    close: "Kapat",
  },
  en: {
    world: "Modded world",
    featured: "Featured",
    installed: "Installed",
    install: "Install",
    installing: "Installing…",
    details: "Details",
    popular: "Popular",
    seeAll: "See all",
    downloads: (n: string) => `${n} downloads`,
    million: "M",
    prev: "Previous",
    next: "Next",
    invite: "Invite a friend",
    inviteHint:
      "Your friend types this code into Join in Cubby or clicks the link. No router settings needed; your world is added to their Minecraft server list automatically.",
    copyCode: "Copy code",
    copyLink: "Copy link",
    copied: "Copied",
    resetInvite: "Reset code",
    withoutCubby: "Your friend doesn't have Cubby?",
    withoutCubbyText: "The address to type in Minecraft's Add Server",
    worldSettings: "World settings",
    performance: "Performance",
    boostTitle: "Booster",
    boostText:
      "Speeds up the server without changing how the game plays. The mods run only on the server; your friends don't install anything.",
    roles: ["Game logic: entities, redstone, AI", "Chunk generation · on 8 cores", "Lighting", "Memory use", "Startup time and memory"],
    boostOnStart: "The mods are installed when the world starts.",
    boostJava: "Java settings (garbage collector) are on for every world.",
    players: "Players",
    nowPlaying: "Playing now",
    worldOff: "World is offline.",
    whoCanJoin: "Who can join",
    whitelistOnly: "Only listed players (whitelist)",
    whitelistForced: "Must stay on because non-premium players can join: anyone who knows the address could fake a name.",
    playerName: "Player name",
    add: "Add",
    op: "Operator",
    makeOp: "Make operator",
    remove: "Remove",
    offlineOn: "Non-premium players (TLauncher) can join too.",
    changeInWorld: "Change in World settings",
    close: "Close",
  },
} as const;

/** Keşfet'in öne çıkan rafı: Modrinth'teki gerçek adlar, açıklamalar ve indirme sayıları. */
const PROJECTS = [
  {
    id: "comp-reimagined",
    title: "Complementary Shaders - Reimagined",
    desc: "Preserving the elements of Minecraft with exceptional quality, detail, and performance.",
    downloads: 71_582_758,
    installed: true,
  },
  {
    id: "comp-unbound",
    title: "Complementary Shaders - Unbound",
    desc: "Transforming the visuals of Minecraft with exceptional quality, detail, and performance.",
    downloads: 46_469_152,
    installed: true,
  },
  {
    id: "bsl",
    title: "BSL Shaders",
    desc: "Shaderpack for Minecraft: Java Edition. It's bright, colorful, and distinct.",
    downloads: 31_380_925,
    installed: false,
  },
  {
    id: "photon",
    title: "Photon Shaders",
    desc: "A gameplay-focused shader pack with a semi-realistic style",
    downloads: 28_921_445,
    installed: false,
  },
  {
    id: "solas",
    title: "Solas Shader",
    desc: "A modern fantasy stylized shaderpack with colored lighting and stunning visuals",
    downloads: 18_392_483,
    installed: false,
  },
  {
    id: "bliss",
    title: "Bliss Shaders",
    desc: "A well performing fantasy styled shaderpack with emphasis on scene variation and customization",
    downloads: 15_613_483,
    installed: false,
  },
];

const BOOST_MODS = ["Lithium", "C2ME", "ScalableLux", "FerriteCore", "ModernFix"];
const PLAYERS: [string, boolean][] = [
  ["Ali", false],
  ["firatmio", true],
  ["Zeynep", false],
];

const svg = (body: string, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const I = {
  copy: svg(`<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
  link: svg(
    `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  ),
  reset: svg(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`),
  down: svg(`<path d="m6 9 6 6 6-6"/>`),
  left: svg(`<path d="m15 18-6-6 6-6"/>`),
  right: svg(`<path d="m9 18 6-6-6-6"/>`),
  x: svg(`<path d="M18 6 6 18M6 6l12 12"/>`),
  clock: svg(`<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`),
  check: svg(`<path d="M20 6 9 17l-5-5"/>`, 2.6),
  info: svg(`<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`),
  plus: svg(`<path d="M5 12h14M12 5v14"/>`),
  install: svg(`<path d="M12 15V3M7 10l5 5 5-5M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>`),
  crown: svg(
    `<path d="M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.3l4.27-3.66a.5.5 0 0 1 .8.52l-2.83 10.24a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.96-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.66a1 1 0 0 0 1.52-.3z"/><path d="M5 21h14"/>`,
  ),
};

const img = (id: string, kind: "400" | "960" | "icon" | "blur") => `/site/modrinth/${id}-${kind}.webp`;

export const UI_STYLE = `
/* Uygulama görünümleri: Cubby'nin renkleri ve ölçüleri */
.ui{min-width:0;--u-bg:#262626;--u-card:#2b2b2b;--u-inner:#333;--u-field:#303030;--u-2:#a0a0a0;--u-3:#6e6e6e;color:var(--text);font-size:14px;line-height:1.45;text-align:left;user-select:none}
:where(.ui) button{font:inherit;color:inherit;cursor:pointer}
.ui svg{width:18px;height:18px;flex:none}
.sheet{justify-self:center;width:min(100%,560px);padding:24px;border:1px solid var(--line);border-radius:28px;background:var(--u-bg);box-shadow:0 30px 70px rgba(0,0,0,.5)}
.sh-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}
.sh-head h3{margin:0;font-size:24px;font-weight:650;letter-spacing:-.02em}
.sh-head p{margin:4px 0 0;color:var(--u-2);font-size:13px}
.sh-x{display:grid;place-items:center;width:32px;height:32px;margin:-4px -6px 0 0;color:var(--u-2)}
.sh-x svg{width:16px;height:16px}
.card{padding:20px;border-radius:22px;background:var(--u-card)}
.card+.card{margin-top:12px}
.card h4{margin:0 0 6px;font-size:15px;font-weight:650}
.muted{margin:0;color:var(--u-2);font-size:13px}
.pill{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;height:42px;padding:0 20px;border:0;border-radius:999px;background:var(--u-inner);font-size:15px;font-weight:600;transition:background .2s,transform .15s}
.pill:hover{background:#3b3b3b}
.pill:active{transform:scale(.97)}
.pill.white{background:#fff;color:#151515}
.pill.white:hover{background:#e8e8e8}
.ui button:focus-visible,.ui input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Anahtar */
.sw{position:relative;flex:none;width:46px;height:28px;padding:0;border:0;border-radius:999px;background:#4a4a4a;transition:background .25s}
.sw i{position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:#151515;transition:transform .35s var(--ease)}
.sw[aria-checked=true]{background:#fff}
.sw[aria-checked=true] i{transform:translateX(18px)}
.sw.locked{background:#969696;cursor:not-allowed}

/* Davet */
.inv{padding:30px 24px 22px;text-align:center}
.icells{display:flex;align-items:center;justify-content:center;gap:clamp(4px,1.2vw,8px);perspective:600px}
.icells span{display:grid;place-items:center;width:clamp(36px,9.4vw,50px);height:clamp(48px,12vw,64px);border:1px solid #1d1d1d;border-radius:12px;background:#222;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);font-family:var(--mono);font-size:clamp(20px,5.2vw,28px);font-weight:700}
.icells span.flip{animation:flip .5s var(--ease) both}
@keyframes flip{0%{transform:rotateX(0)}45%{transform:rotateX(90deg)}55%{transform:rotateX(-90deg)}100%{transform:rotateX(0)}}
.icells i{width:clamp(8px,2vw,14px);height:2px;margin:0 clamp(2px,1vw,8px);background:var(--u-3)}
.inv p{max-width:400px;margin:18px auto 20px;color:var(--u-2);font-size:13px}
.inv-btns{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.inv-btns .pill{min-width:160px}
.inv-reset{display:inline-flex;align-items:center;gap:6px;margin-top:16px;padding:4px 8px;border:0;border-radius:8px;background:none;color:var(--u-3);font-size:13px;transition:color .2s}
.inv-reset:hover{color:var(--text)}
.inv-reset svg{width:14px;height:14px;transition:transform .5s var(--ease)}
.inv-reset:hover svg{transform:rotate(-120deg)}
.crow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.crow b{font-size:15px}
.crow p{margin:2px 0 0;color:var(--u-2);font-size:13px}
.crow svg{color:var(--u-2)}

/* Hızlandırıcı */
.boost{padding:18px 18px 16px;border-radius:18px;background:var(--u-inner);transition:opacity .3s}
.boost-top{display:flex;align-items:center;gap:20px}
.boost-top b{font-size:16px}
.boost-top p{margin:4px 0 0;color:var(--u-2);font-size:13px}
.bmods{margin:16px 0 0;padding:0;list-style:none;transition:opacity .35s,filter .35s}
.bmods li{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px}
.bmods svg{width:15px;height:15px;color:var(--u-2)}
.bmods span{color:var(--u-2)}
.boost .muted{margin-top:12px}
.boost:not(.on) .bmods{opacity:.35;filter:grayscale(1)}

/* Oyuncular */
.wl{display:flex;align-items:center;gap:16px;margin-top:10px}
.wl b{color:var(--u-2);font-size:15px;font-weight:600}
.wl p{margin:2px 0 0;color:var(--u-3);font-size:13px}
.addp{display:flex;gap:10px;margin:16px 0 8px}
.addp input{flex:1;min-width:0;height:44px;padding:0 18px;border:1px solid transparent;border-radius:999px;background:var(--u-field);color:var(--text);font:inherit;font-size:15px;outline:none;transition:border-color .2s}
.addp input:focus{border-color:rgba(255,255,255,.18)}
.addp input::placeholder{color:var(--u-3)}
.addp input.bad{border-color:#d0574e;animation:shake .35s}
@keyframes shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.addp .pill{height:44px;padding:0 18px;background:#2f2f2f;color:var(--u-2)}
.addp .pill:hover{color:var(--text)}
.plist{margin:0;padding:0;list-style:none}
.plist li{display:grid;grid-template-rows:1fr;transition:grid-template-rows .35s var(--ease),opacity .3s}
.plist li.gone{grid-template-rows:0fr;opacity:0}
.plist li.new{animation:pin .4s var(--ease)}
@keyframes pin{from{opacity:0;transform:translateY(-6px)}}
.prow{display:flex;align-items:center;gap:14px;min-height:0;overflow:hidden;padding:0 4px}
.prow>*{margin:9px 0}
.av{display:grid;flex:none;place-items:center;width:30px;height:30px;border-radius:50%;background:#3e3c3b;font-size:13px;font-weight:700}
.prow b{flex:1;min-width:0;overflow:hidden;font-size:15px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.chip{padding:3px 10px;border-radius:999px;background:#3d3d3d;color:var(--u-2);font-size:12px;font-weight:600;opacity:0;transform:scale(.8);transition:opacity .25s,transform .3s var(--ease)}
.op .chip{opacity:1;transform:none}
.ib{display:grid;flex:none;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:none;color:var(--u-3);transition:color .2s,background .2s,transform .3s var(--ease)}
.ib:hover{background:rgba(255,255,255,.07);color:var(--text)}
.ib svg{width:16px;height:16px}
.op .crown{color:#e8b64c}
.op .crown svg{fill:rgba(232,182,76,.25)}
.crown:active{transform:scale(1.25)}
.foot p{margin:0;color:var(--u-2);font-size:13px}
.foot u{color:var(--text);text-underline-offset:3px}

/* Keşfet */
.disc{--u-r:24px;padding:16px;border:1px solid var(--line-strong);border-radius:24px;background:#1a1a1a;box-shadow:0 30px 70px rgba(0,0,0,.5)}
.feat{position:relative;display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1fr);min-height:260px;overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:var(--u-r);background:#2a2421}
.feat-bg{position:absolute;inset:0;background-position:center;background-size:cover;transform:scale(1.1)}
.feat-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(20,16,14,0) 30%,rgba(20,16,14,.45) 60%,rgba(20,16,14,.55))}
.feat-img{position:relative;width:100%;height:100%;object-fit:cover;-webkit-mask-image:linear-gradient(90deg,#000 62%,transparent);mask-image:linear-gradient(90deg,#000 62%,transparent)}
.feat-body{position:relative;display:flex;flex-direction:column;justify-content:center;padding:28px 40px 56px 28px}
.feat-body,.feat-img{transition:opacity .25s ease}
.feat.swap .feat-body,.feat.swap .feat-img{opacity:0}
.feat-eyebrow{margin:0 0 10px;color:rgba(255,255,255,.55);font-size:13px;font-weight:600}
.feat-title{display:flex;align-items:center;gap:12px}
.feat-title img{width:44px;height:44px;border-radius:11px}
.feat-title b{font-size:clamp(18px,2.2vw,24px);font-weight:700;line-height:1.15}
.feat-desc{margin:12px 0 4px;color:rgba(255,255,255,.72);font-size:13px}
.feat-dl{margin:0;color:rgba(255,255,255,.4);font-size:12px}
.feat-act{display:flex;align-items:center;gap:14px;margin-top:18px}
.ghost{display:inline-flex;align-items:center;gap:7px;height:36px;padding:0 12px;border:0;border-radius:999px;background:none;color:rgba(255,255,255,.75);font-size:14px;font-weight:600}
.ghost:hover{background:rgba(255,255,255,.08)}
.ghost svg{width:16px;height:16px}
.inst{color:#7ccf55;cursor:default}
.inst:hover{background:none}
.feat-act .pill{height:36px;padding:0 16px;font-size:14px}
.spin{width:15px;height:15px;border:2px solid rgba(0,0,0,.2);border-top-color:#151515;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.feat-nav{position:absolute;right:20px;bottom:18px;display:flex;align-items:center;gap:10px}
.feat-nav button{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.35);color:#fff;transition:background .2s}
.feat-nav button:hover{background:rgba(0,0,0,.55)}
.feat-nav svg{width:16px;height:16px}
.dots{display:flex;gap:5px}
.dots i{width:6px;height:6px;border-radius:999px;background:rgba(255,255,255,.4);transition:width .35s var(--ease),background .35s}
.dots i.on{width:18px;background:#fff}
.shelf-head{display:flex;align-items:center;justify-content:space-between;margin:22px 4px 14px}
.shelf-head b{font-size:17px}
.shelf-head span{display:flex;align-items:center;gap:2px;color:var(--u-2);font-size:13px}
.shelf-head svg{width:14px;height:14px}
.shelf{display:flex;gap:16px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}
.tile{flex:0 0 200px;width:200px;min-width:0;padding:0;border:0;background:none;text-align:left}
.tile-img{position:relative;display:block;height:125px;border-radius:16px;background:#222 center/cover no-repeat;transition:transform .3s var(--ease),box-shadow .3s}
.tile:hover .tile-img{transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.45)}
.tile.sel .tile-img{box-shadow:0 0 0 2px #fff}
.tile-ic{position:absolute;left:12px;bottom:-16px;width:34px;height:34px;border:2px solid #1a1a1a;border-radius:10px}
.tick{position:absolute;top:8px;right:8px;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#4caf50;color:#fff;opacity:0;transform:scale(.5);transition:opacity .25s,transform .35s var(--ease)}
.tick svg{width:14px;height:14px}
.tile.has .tick{opacity:1;transform:none}
.tile b{display:block;margin:24px 4px 0;overflow:hidden;font-size:15px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.tile small{display:block;margin:2px 4px 0;color:var(--u-2);font-size:12px}
@media (max-width:700px){
.disc{padding:10px}
.feat{grid-template-columns:1fr;min-height:0}
.feat-img{height:170px;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}
.feat-body{padding:4px 18px 60px}
.feat-desc{display:none}
.shelf{overflow-x:auto;scrollbar-width:none;-webkit-mask-image:none;mask-image:none}
.tile{flex-basis:150px;width:150px}.tile-img{height:94px}
.sheet{padding:18px;border-radius:24px}.card{padding:16px}
.inv-btns{flex-direction:column}.inv-btns .pill{width:100%}
}
@media (prefers-reduced-motion:reduce){.icells span.flip,.addp input.bad,.plist li.new{animation:none}}
`;

/** Gezinmeyle aynı betiğin sonuna eklenir (aynı nonce). */
export const UI_SCRIPT = `
(()=>{
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const flash=(b,html,ms=1500)=>{const old=b.innerHTML;b.innerHTML=html;b.disabled=true;setTimeout(()=>{b.innerHTML=old;b.disabled=false;},ms);};
// Davet: kopyala, kodu yenile (hücreler sırayla döner)
const inv=$("[data-inv]");
if(inv){
  const T=JSON.parse(inv.dataset.t),cells=$$(".icells span",inv);
  const code=()=>cells.map((c)=>c.textContent).join("");
  const copy=(text,b)=>{(navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).catch(()=>{});flash(b,T.check+T.copied);};
  $("[data-copy]",inv).addEventListener("click",(ev)=>{const c=code();copy(c.slice(0,3)+"-"+c.slice(3),ev.currentTarget);});
  $("[data-link]",inv).addEventListener("click",(ev)=>copy(location.origin+"/join/"+code(),ev.currentTarget));
  $("[data-reset]",inv).addEventListener("click",()=>{
    const A="23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    cells.forEach((c,i)=>setTimeout(()=>{
      c.classList.remove("flip");void c.offsetWidth;c.classList.add("flip");
      setTimeout(()=>{c.textContent=A[Math.floor(Math.random()*A.length)];},220);
    },i*60));
  });
}
// Hızlandırıcı anahtarı
$$("[data-boost] .sw").forEach((sw)=>sw.addEventListener("click",()=>{
  const on=sw.getAttribute("aria-checked")!=="true";
  sw.setAttribute("aria-checked",on);sw.closest("[data-boost]").classList.toggle("on",on);
}));
// Oyuncular: ekle, çıkar, yetkili yap
const pl=$("[data-players]");
if(pl){
  const list=$(".plist",pl),input=$("input",pl),tpl=$("template",pl);
  const wire=(li)=>{
    $(".crown",li).addEventListener("click",(ev)=>{const op=!li.classList.contains("op");li.classList.toggle("op",op);ev.currentTarget.setAttribute("aria-pressed",op);});
    $(".rm",li).addEventListener("click",()=>{li.classList.add("gone");li.inert=true;setTimeout(()=>li.remove(),380);});
  };
  $$("li",list).forEach(wire);
  const add=()=>{
    const n=input.value.trim();
    const taken=$$("li:not(.gone) b",list).some((b)=>b.textContent.toLowerCase()===n.toLowerCase());
    if(!/^[A-Za-z0-9_]{3,16}$/.test(n)||taken){input.classList.remove("bad");void input.offsetWidth;input.classList.add("bad");return;}
    input.classList.remove("bad");
    const li=tpl.content.firstElementChild.cloneNode(true);
    $(".av",li).textContent=n[0].toUpperCase();$("b",li).textContent=n;li.classList.add("new");
    list.append(li);wire(li);input.value="";
  };
  $(".pill",pl).addEventListener("click",add);
  input.addEventListener("keydown",(ev)=>{if(ev.key==="Enter")add();});
  input.addEventListener("input",()=>input.classList.remove("bad"));
}
// Keşfet: öne çıkanlar arasında gezinme, rafta seçme, kurma
const disc=$("[data-disc]");
if(disc){
  const P=JSON.parse(disc.dataset.p),T=JSON.parse(disc.dataset.t),feat=$(".feat",disc),tiles=$$(".tile",disc),dots=$$(".dots i",disc);
  let cur=0,busy=false;
  const act=(p)=>p.installed?'<button type="button" class="ghost inst" tabindex="-1">'+T.check+T.installed+'</button>':'<button type="button" class="pill white" data-install>'+T.installIcon+T.install+'</button>';
  function fill(i){
    const p=P[i];
    $(".feat-img",feat).src="/site/modrinth/"+p.id+"-960.webp";
    $(".feat-bg",feat).style.backgroundImage="url(/site/modrinth/"+p.id+"-blur.webp)";
    $(".feat-title img",feat).src="/site/modrinth/"+p.id+"-icon.webp";
    $(".feat-title b",feat).textContent=p.title;
    $(".feat-desc",feat).textContent=p.desc;
    $(".feat-dl",feat).textContent=p.dl;
    $(".feat-act",feat).innerHTML=act(p)+'<button type="button" class="ghost">'+T.info+T.details+'</button>';
    dots.forEach((d,j)=>d.classList.toggle("on",j===i));
    tiles.forEach((t,j)=>t.classList.toggle("sel",j===i));
  }
  function show(i){
    i=(i+P.length)%P.length;if(i===cur||busy)return;busy=true;
    const pre=new Image();pre.src="/site/modrinth/"+P[i].id+"-960.webp";
    feat.classList.add("swap");
    Promise.all([pre.decode().catch(()=>{}),new Promise((r)=>setTimeout(r,250))]).then(()=>{
      cur=i;fill(i);requestAnimationFrame(()=>{feat.classList.remove("swap");busy=false;});
    });
  }
  $("[data-prev]",disc).addEventListener("click",()=>show(cur-1));
  $("[data-next]",disc).addEventListener("click",()=>show(cur+1));
  // Masaüstünde raf kaydırılmaz (taşan kutucuk yarım görünür): odaklanınca kaymış olabilir, geri al.
  const shelf=$(".shelf",disc);
  tiles.forEach((t,j)=>t.addEventListener("click",()=>{show(j);if(getComputedStyle(shelf).overflowX==="hidden")shelf.scrollLeft=0;}));
  shelf.addEventListener("focusin",()=>{if(getComputedStyle(shelf).overflowX==="hidden")requestAnimationFrame(()=>{shelf.scrollLeft=0;});});
  feat.addEventListener("click",(ev)=>{
    const b=ev.target.closest("[data-install]");if(!b)return;
    const i=cur;b.innerHTML='<span class="spin"></span>'+T.installing;b.disabled=true;
    setTimeout(()=>{P[i].installed=true;tiles[i].classList.add("has");if(cur===i)$(".feat-act",feat).firstElementChild.outerHTML=act(P[i]);},1100);
  });
}
})();`;

export function uiText(lang: Lang) {
  return TEXT[lang];
}

function formatDownloads(lang: Lang, n: number): string {
  const t = TEXT[lang];
  const v = (n / 1_000_000).toLocaleString(lang === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 1 });
  return t.downloads(`${v} ${t.million}`);
}

const head = (title: string, sub: string, close: string) =>
  `<div class="sh-head"><div><h3>${e(title)}</h3><p>${e(sub)}</p></div><span class="sh-x" role="img" aria-label="${e(close)}">${I.x}</span></div>`;

export function discoverUI(lang: Lang, label: string): string {
  const t = TEXT[lang];
  const projects = PROJECTS.map((p) => ({ ...p, dl: formatDownloads(lang, p.downloads) }));
  const first = projects[0];
  const data = e(JSON.stringify(projects.map(({ id, title, desc, dl, installed }) => ({ id, title, desc, dl, installed }))));
  const T = e(
    JSON.stringify({
      installed: t.installed,
      install: t.install,
      installing: t.installing,
      details: t.details,
      check: I.check,
      info: I.info,
      installIcon: I.install,
    }),
  );
  const tiles = projects
    .map(
      (p, i) =>
        `<button type="button" class="tile${p.installed ? " has" : ""}${i === 0 ? " sel" : ""}"><span class="tile-img" style="background-image:url(${img(p.id, "400")})"><img class="tile-ic" src="${img(p.id, "icon")}" alt="" width="34" height="34" decoding="async"><span class="tick">${I.check}</span></span><b>${e(p.title)}</b><small>${e(p.dl)}</small></button>`,
    )
    .join("");
  return `<div class="ui disc" data-disc data-p="${data}" data-t="${T}" role="group" aria-label="${e(label)}">
<div class="feat">
<div class="feat-bg" style="background-image:url(${img(first.id, "blur")})"></div>
<img class="feat-img" src="${img(first.id, "960")}" alt="" width="960" height="540" decoding="async">
<div class="feat-body">
<p class="feat-eyebrow">${e(t.featured)}</p>
<div class="feat-title"><img src="${img(first.id, "icon")}" alt="" width="44" height="44"><b>${e(first.title)}</b></div>
<p class="feat-desc">${e(first.desc)}</p>
<p class="feat-dl">${e(first.dl)}</p>
<div class="feat-act"><button type="button" class="ghost inst" tabindex="-1">${I.check}${e(t.installed)}</button><button type="button" class="ghost">${I.info}${e(t.details)}</button></div>
</div>
<div class="feat-nav"><button type="button" data-prev aria-label="${e(t.prev)}">${I.left}</button><span class="dots">${projects.map((_, i) => `<i${i === 0 ? ` class="on"` : ""}></i>`).join("")}</span><button type="button" data-next aria-label="${e(t.next)}">${I.right}</button></div>
</div>
<div class="shelf-head"><b>${e(t.popular)}</b><span>${e(t.seeAll)}${I.right}</span></div>
<div class="shelf">${tiles}</div>
</div>`;
}

export function inviteUI(lang: Lang): string {
  const t = TEXT[lang];
  const T = e(JSON.stringify({ copied: t.copied, check: I.check }));
  const cells = [..."K7M2QX"].map((c, i) => (i === 3 ? "<i></i>" : "") + `<span>${c}</span>`).join("");
  return `<div class="ui sheet" data-inv data-t="${T}" role="group" aria-label="${e(t.invite)}">
${head(t.invite, t.world, t.close)}
<div class="card inv">
<div class="icells" aria-live="polite">${cells}</div>
<p>${e(t.inviteHint)}</p>
<div class="inv-btns"><button type="button" class="pill white" data-copy>${I.copy}${e(t.copyCode)}</button><button type="button" class="pill" data-link>${I.link}${e(t.copyLink)}</button></div>
<button type="button" class="inv-reset" data-reset>${I.reset}${e(t.resetInvite)}</button>
</div>
<div class="card crow"><div><b>${e(t.withoutCubby)}</b><p>${e(t.withoutCubbyText)}</p></div>${I.down}</div>
</div>`;
}

export function boosterUI(lang: Lang): string {
  const t = TEXT[lang];
  const mods = BOOST_MODS.map((m, i) => `<li>${I.clock}<b>${m}</b><span>${e(t.roles[i])}</span></li>`).join("");
  return `<div class="ui sheet" role="group" aria-label="${e(t.boostTitle)}">
${head(t.worldSettings, t.world, t.close)}
<div class="card"><h4>${e(t.performance)}</h4>
<div class="boost on" data-boost>
<div class="boost-top"><div><b>${e(t.boostTitle)}</b><p>${e(t.boostText)}</p></div><button type="button" class="sw" role="switch" aria-checked="true" aria-label="${e(t.boostTitle)}"><i></i></button></div>
<ul class="bmods">${mods}</ul>
<p class="muted">${e(t.boostOnStart)}</p>
<p class="muted">${e(t.boostJava)}</p>
</div>
</div>
</div>`;
}

export function playersUI(lang: Lang): string {
  const t = TEXT[lang];
  const row = (name: string, op: boolean) =>
    `<li${op ? ` class="op"` : ""}><div class="prow"><span class="av">${e(name[0].toUpperCase())}</span><b>${e(name)}</b><span class="chip">${e(t.op)}</span><button type="button" class="ib crown" aria-pressed="${op}" aria-label="${e(t.makeOp)}">${I.crown}</button><button type="button" class="ib rm" aria-label="${e(t.remove)}">${I.x}</button></div></li>`;
  return `<div class="ui sheet" data-players role="group" aria-label="${e(t.players)}">
${head(t.players, t.world, t.close)}
<div class="card"><h4>${e(t.nowPlaying)}</h4><p class="muted">${e(t.worldOff)}</p></div>
<div class="card"><h4>${e(t.whoCanJoin)}</h4>
<div class="wl"><div><b>${e(t.whitelistOnly)}</b><p>${e(t.whitelistForced)}</p></div><span class="sw locked" role="switch" aria-checked="true" aria-disabled="true" aria-label="${e(t.whitelistOnly)}"><i></i></span></div>
<div class="addp"><input type="text" placeholder="${e(t.playerName)}" aria-label="${e(t.playerName)}" maxlength="16" spellcheck="false" autocomplete="off"><button type="button" class="pill">${I.plus}${e(t.add)}</button></div>
<ul class="plist">${PLAYERS.map(([n, op]) => row(n, op)).join("")}</ul>
<template>${row("x", false)}</template>
</div>
<div class="card foot"><p>${e(t.offlineOn)} <u>${e(t.changeInWorld)}</u></p></div>
</div>`;
}
