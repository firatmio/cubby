/**
 * Ana site (`/`): uygulamadaki gibi üstteki haplarla yan yana dört sayfa (Ana sayfa, Özellikler,
 * SSS, İndir). Geçişte şerit yay gibi kayar ve hızına göre esner; yerine aşmadan oturur. Her
 * sayfanın kendi arka planı vardır, onunla birlikte kayar. Sunucuda iki dilde üretilir; betik
 * nonce'lu. Görseller `public/site/` altında, uygulamanın gerçek ekranlarından.
 */

import { DOWNLOAD_PATH, escapeHtml } from "./html.js";
import type { Lang } from "./i18n.js";
import { formatSize, type LatestRelease } from "./release.js";

const REPO_URL = "https://github.com/firatmio/cubby";
/** Sayfaların adres çubuğundaki adları (`#features`); sıra şeritteki sıra. */
const PAGES = ["home", "features", "faq", "download"] as const;

const TEXT = {
  tr: {
    title: "Cubby — Arkadaşlarınla kendi Minecraft dünyan",
    desc: "Cubby, Minecraft sunucunu kurar, açar ve arkadaşlarını 6 karakterlik bir kodla bağlar. Modem ayarı yok, kiralık sunucu yok.",
    nav: ["Ana sayfa", "Özellikler", "SSS", "İndir"],
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
        size: [1142, 548],
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
    faqLead: "Cubby hakkında en çok merak edilenler. Bir soruya tıkla, cevabı açılsın.",
    faqCats: [["all", "Tümü"], ["start", "Başlarken"], ["friends", "Arkadaşlarla"]],
    faqAsk: ["Cevabını bulamadın mı?", "GitHub'da sor"],
    faq: [
      ["start", "Ücretsiz mi?", "Evet. Sunucu senin bilgisayarında çalışır; kiralık sunucu ya da abonelik yok."],
      [
        "friends",
        "Arkadaşımın da Cubby'si olmalı mı?",
        "Kodla katılmak için evet; ücretsiz ve bir dakikada kurulur. Aynı evdeysen ya da modemden internete açtıysan Cubby'siz adresle de girebilir.",
      ],
      [
        "start",
        "Windows uyarı veriyor, güvenli mi?",
        "Cubby henüz kod imzası almadığı için Windows \"bilinmeyen yayımcı\" diyebilir. \"Ek bilgi\" › \"Yine de çalıştır\" ile açılır. Kaynak kodu GitHub'da incelenebilir.",
      ],
      [
        "friends",
        "Modlu dünyada arkadaşım modları nasıl kurar?",
        "Kurmaz. Cubby'de katılırken dünyada gereken modlar kendiliğinden iner ve oyun doğru sürümle açılır.",
      ],
      [
        "friends",
        "Bilgisayarım kapanınca ne olur?",
        "Dünya senin bilgisayarında durur; sen açınca arkadaşların girebilir. Kapalıyken davet sayfası \"Şu an kapalı\" der.",
      ],
      [
        "friends",
        "TLauncher ile oynayan arkadaşım girebilir mi?",
        "Evet. Premium olmayanlar için beyaz liste açık tutulur, yalnız eklediğin isimler girer.",
      ],
      ["start", "Mac ya da Linux'ta çalışır mı?", "Şimdilik yalnız Windows 10 ve 11."],
      [
        "start",
        "Cubby nasıl güncellenir?",
        "Kendiliğinden. Yeni sürüm arka planda iner, üst çubukta \"Güncelleme hazır\" görünür; tek tıkla yeniden başlar.",
      ],
    ],
    finalTitle: "Hadi, dünyanı kur.",
    dlEyebrow: "Ücretsiz · Windows 10 / 11",
    dlTitle: "Dünyan bir indirme uzağında",
    dlLead: "Kur, dünyanı seç, kodu arkadaşlarına at. Sunucuyu, modları ve bağlantıyı Cubby halleder.",
    dlMeta: (r: LatestRelease | null) => (r ? `v${r.version} · ${formatSize(r.size)}` : "Son sürüm"),
    trust: ["Kendini günceller", "Reklam yok", "Kaynak kodu GitHub'da"],
    dlNote: "Windows \"bilinmeyen yayımcı\" derse: Ek bilgi › Yine de çalıştır.",
    inviteCard: "Arkadaşını davet et",
    joined: "Ali katıldı",
    joinedMore: "Modlu dünya · 2/10 oyuncu",
    shotAlt: "Cubby'nin Oyna ekranı",
    langLabel: "Dil",
    footer: ["GitHub", "Sürüm notları", "Katıl"],
    rights: "Mojang ya da Microsoft ile bağlantılı değildir.",
  },
  en: {
    title: "Cubby — Your own Minecraft world with your friends",
    desc: "Cubby sets up and runs your Minecraft server and connects your friends with a 6-character code. No port forwarding, no rented server.",
    nav: ["Home", "Features", "FAQ", "Download"],
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
        size: [1142, 548],
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
    faqTitle: "Frequently asked",
    faqLead: "What people ask most about Cubby. Click a question to open the answer.",
    faqCats: [["all", "All"], ["start", "Getting started"], ["friends", "With friends"]],
    faqAsk: ["Didn't find your answer?", "Ask on GitHub"],
    faq: [
      ["start", "Is it free?", "Yes. The server runs on your computer; no rented server, no subscription."],
      [
        "friends",
        "Does my friend need Cubby too?",
        "To join with a code, yes; it's free and installs in a minute. On the same home network, or if you opened it to the internet, they can also join by address without Cubby.",
      ],
      [
        "start",
        "Windows shows a warning. Is it safe?",
        "Cubby isn't code-signed yet, so Windows may say \"unknown publisher\". Click \"More info\" › \"Run anyway\". The source code can be reviewed on GitHub.",
      ],
      [
        "friends",
        "How does my friend install the mods of a modded world?",
        "They don't. When joining through Cubby, the mods the world needs download automatically and the game opens with the right version.",
      ],
      [
        "friends",
        "What happens when my computer is off?",
        "The world lives on your computer; friends can join once you open it. While it's closed, the invite page says \"Closed right now\".",
      ],
      ["friends", "Can a friend who plays with TLauncher join?", "Yes. The whitelist stays on for non-premium players, so only names you add can join."],
      ["start", "Does it run on Mac or Linux?", "For now, only Windows 10 and 11."],
      [
        "start",
        "How does Cubby update?",
        "By itself. New versions download in the background and \"Update ready\" shows in the top bar; one click restarts it.",
      ],
    ],
    finalTitle: "Go on, build your world.",
    dlEyebrow: "Free · Windows 10 / 11",
    dlTitle: "Your world is one download away",
    dlLead: "Install, pick your world, send the code to your friends. Cubby handles the server, the mods and the connection.",
    dlMeta: (r: LatestRelease | null) => (r ? `v${r.version} · ${formatSize(r.size)}` : "Latest version"),
    trust: ["Updates itself", "No ads", "Source on GitHub"],
    dlNote: "If Windows says \"unknown publisher\": More info › Run anyway.",
    inviteCard: "Invite a friend",
    joined: "Ali joined",
    joinedMore: "Modded world · 2/10 players",
    shotAlt: "Cubby's Play screen",
    langLabel: "Language",
    footer: ["GitHub", "Release notes", "Join"],
    rights: "Not affiliated with Mojang or Microsoft.",
  },
} as const;

const STYLE = `
:root{color-scheme:dark;--ease:cubic-bezier(.2,.9,.25,1);--bg:#161616;--glass:rgba(36,36,36,.62);--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.16);
--text:#f2f2f2;--text-2:#a8a8a8;--text-3:#6b6b6b;--accent:#6cc04a;--mono:"Cascadia Mono","JetBrains Mono",ui-monospace,monospace}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden}
body{background:var(--bg);color:var(--text);font-family:"Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
img{display:block;max-width:100%;height:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:54px;padding:0 30px;border:1px solid var(--line-strong);border-radius:999px;
background:rgba(255,255,255,.06);color:var(--text);font-size:16px;font-weight:600;white-space:nowrap}
.btn.primary{border-color:transparent;background:#fff;color:#151515}
.btn.primary:hover{background:#e9e9e9}
.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.glass{border:1px solid var(--line);border-radius:24px;background:var(--glass);box-shadow:0 12px 40px rgba(0,0,0,.28)}
/* Bulanık cam yalnız görselin üstünde: kayarken her karede yeniden hesaplanır, düz koyu zeminde gerekmez. */
.blur{background:rgba(36,36,36,.55);backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2)}
.cells{display:inline-flex;align-items:center;gap:.3em;font-family:var(--mono);font-weight:700}
.cells span{display:grid;place-items:center;width:1.5em;height:1.85em;border:1px solid var(--line-strong);border-radius:.32em;background:rgba(255,255,255,.06)}
.cells i{width:.45em;height:2px;background:var(--text-3)}
.eyebrow{margin:0;color:var(--accent);font-size:13px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
h2{margin:10px 0 14px;font-size:clamp(30px,4vw,42px);font-weight:650;line-height:1.1;letter-spacing:-.03em}
.lead{margin:0;color:var(--text-2);font-size:18px}

/* Üst çubuk: hep yerinde; sayfa kaydırılınca camlaşır. */
.bar{position:fixed;inset:0 0 auto;z-index:10;display:flex;align-items:center;height:68px;padding:0 32px;border-bottom:1px solid transparent;transition:background .2s,border-color .2s}
.bar.solid{background:rgba(22,22,22,.72);border-color:var(--line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700}
.brand svg{width:30px;height:30px}
.pills{position:absolute;left:50%;display:flex;gap:4px;padding:4px;border-radius:999px;background:rgba(255,255,255,.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transform:translateX(-50%)}
.pills .ind{position:absolute;top:4px;bottom:4px;left:0;width:0;border-radius:999px;background:#fff}
.pills a,.ink span{position:relative;padding:7px 18px;border-radius:999px;color:var(--text-2);font-size:14px;font-weight:600;white-space:nowrap}
.pills a:hover{color:var(--text)}
/* Göstergenin üstündeki koyu yazı: göstergeyle aynı yerden kırpılır, kayarken yazı yarı yarıya döner. */
.ink{position:absolute;inset:0;display:flex;gap:4px;padding:4px;pointer-events:none;clip-path:inset(0 100% 0 0)}
.ink span{color:#151515}
.end{display:flex;align-items:center;gap:18px;margin-left:auto}
.gh{color:var(--text-2);font-size:14px}
.gh:hover{color:var(--text)}
.lang{display:flex;padding:3px;border-radius:999px;background:rgba(255,255,255,.08)}
.lang a{padding:4px 10px;border-radius:999px;color:var(--text-2);font-size:12px;font-weight:700;letter-spacing:.04em}
.lang a:hover{color:var(--text)}
.lang a[aria-current]{background:rgba(255,255,255,.16);color:var(--text)}

/* Şerit: sayfalar yan yana; her biri kendi arka planı ve kendi kaydırmasıyla. */
.viewport{position:fixed;inset:0;overflow:hidden}
.strip{display:flex;width:400vw;height:100%;will-change:transform}
.pg{position:relative;flex:0 0 100vw;height:100%;overflow:hidden}
.pg[data-hidden]{visibility:hidden}
.pg:not(.on) .anim{animation-play-state:paused}
.bg{position:absolute;inset:0;will-change:transform}
/* Isıtma: sayfa görünmeden önce bir kez, neredeyse saydam, ekranın üstünde çizilir. */
.pg.warm{z-index:5;opacity:.01;pointer-events:none}
.scroll{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;will-change:transform;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}

/* Ana sayfa: Cubby'nin Oyna ekranı */
.bgimg{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover}
.home .cover{transform:scale(1.03);animation:drift 30s ease-in-out infinite alternate}
@keyframes drift{to{transform:scale(1.08) translate(-.6%,-.4%)}}
.home .scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(22,22,22,.97) 0%,rgba(22,22,22,.6) 40%,rgba(22,22,22,.2) 70%,rgba(22,22,22,.55) 100%),
linear-gradient(to right,rgba(22,22,22,.75),rgba(22,22,22,0) 60%)}
.stage{min-height:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:32px;padding:92px 64px 56px}
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
.meta{color:var(--text-2);font-size:13px}

/* Özellikler ve SSS */
.features .bg{background:radial-gradient(60% 50% at 85% 0%,rgba(108,192,74,.16),transparent 70%),radial-gradient(50% 45% at 0% 40%,rgba(230,160,70,.09),transparent 70%),var(--bg)}
.faqpg .bg{background:radial-gradient(55% 50% at 15% 0%,rgba(90,150,230,.14),transparent 70%),radial-gradient(50% 50% at 100% 100%,rgba(108,192,74,.1),transparent 70%),var(--bg)}
.wrap{width:min(1180px,100% - 48px);margin:0 auto;padding:128px 0 0}
.wrap>section+section{margin-top:120px}
.band{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:56px;padding:64px}
.band .cells{font-size:clamp(28px,4.4vw,52px)}
.row{display:grid;grid-template-columns:1fr 1.15fr;align-items:center;gap:64px}
.row.flip{grid-template-columns:1.15fr 1fr}
.row.flip .text{order:2}
/* Geniş görüntü (Keşfet) küçültülürse okunmaz: yazı üstte, görüntü tam genişlikte. */
.row.wide{grid-template-columns:1fr;gap:40px}
.row.wide .text{display:grid;grid-template-columns:1fr 1fr;gap:12px 64px;align-items:end}
.row.wide .points{margin:0}
.shot{overflow:hidden;border:1px solid var(--line-strong);border-radius:18px;box-shadow:0 30px 70px rgba(0,0,0,.5)}
.shot.narrow{justify-self:center;width:min(100%,560px);border-radius:28px}
.points{margin:22px 0 0;padding:0;list-style:none;color:var(--text-2)}
.points li{display:flex;gap:10px;padding:5px 0}
.points li::before{content:"";flex:none;width:8px;height:8px;margin-top:9px;border-radius:50%;background:var(--accent)}
h1.title{margin:10px 0 12px;font-size:clamp(40px,5vw,60px);font-weight:650;line-height:1.05;letter-spacing:-.04em}
/* SSS: solda başlık (yapışkan), sağda süzgeç ve akordeon. Açılış yüksekliği grid satırıyla yumuşak. */
.faqgrid{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.35fr);align-items:start;gap:72px}
.faqside{position:sticky;top:116px}
.ask{display:flex;align-items:center;gap:14px;margin-top:32px;padding:14px 18px 14px 14px;border-radius:20px;transition:border-color .2s,background .2s}
.ask:hover{border-color:var(--line-strong);background:rgba(44,44,44,.7)}
.ask b{display:block;font-size:15px}
.ask small{color:var(--accent);font-size:13px;font-weight:600}
.ask .arrow{margin-left:auto;color:var(--text-3);transition:transform .3s var(--ease),color .2s}
.ask .arrow svg{width:18px;height:18px}
.ask:hover .arrow{transform:translateX(4px);color:var(--text)}
.chips{position:relative;display:inline-flex;gap:4px;max-width:100%;margin-bottom:22px;padding:4px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.04)}
.chipind{position:absolute;top:4px;bottom:4px;left:0;width:0;border-radius:999px;background:#fff}
.chips.rise{padding-bottom:4px}
.chips.ready .chipind{transition:transform .5s var(--ease),width .5s var(--ease)}
.chips button{position:relative;display:inline-flex;align-items:center;padding:8px 16px;border:0;border-radius:999px;background:none;color:var(--text-2);font:inherit;font-size:14px;font-weight:600;white-space:nowrap;cursor:pointer;transition:color .25s}
.chips button:hover{color:var(--text)}
.chips button[aria-pressed=true]{color:#151515}
.chips button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.chips i{margin-left:6px;font-size:12px;font-style:normal;opacity:.55}
.qa{display:grid;grid-template-rows:1fr;transition:grid-template-rows .45s var(--ease),opacity .3s}
.qa.out{grid-template-rows:0fr;opacity:0}
.qa>div{min-height:0;overflow:hidden}
.rise{padding-bottom:12px;transition:opacity .5s ease-out,transform .6s var(--ease);transition-delay:calc(var(--i,0) * 50ms + 120ms)}
.faqpg[data-hidden] .rise{opacity:0;transform:translateY(22px);transition:none}
.q{border:1px solid var(--line);border-radius:20px;background:rgba(36,36,36,.7);transition:background .25s,border-color .25s}
.q:hover{background:rgba(46,46,46,.78)}
.q.open{border-color:rgba(108,192,74,.38);background:rgba(38,44,36,.86)}
.qh{display:flex;align-items:center;gap:16px;width:100%;padding:19px 20px 19px 22px;border:0;border-radius:20px;background:none;color:var(--text);font:inherit;font-size:17px;font-weight:600;line-height:1.35;text-align:left;cursor:pointer}
.qh:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.num{flex:none;width:24px;color:var(--text-3);font-family:var(--mono);font-size:13px;transition:color .25s}
.open .num{color:var(--accent)}
.qt{flex:1}
.plus{position:relative;flex:none;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.07);transition:transform .45s var(--ease),background .25s}
.plus::before,.plus::after{content:"";position:absolute;top:50%;left:50%;width:12px;height:2px;margin:-1px 0 0 -6px;border-radius:2px;background:var(--text-2);transition:background .25s}
.plus::after{transform:rotate(90deg)}
.q:hover .plus{background:rgba(255,255,255,.12)}
.q.open .plus{transform:rotate(135deg);background:var(--accent)}
.open .plus::before,.open .plus::after{background:#13200d}
.ans{display:grid;grid-template-rows:0fr;transition:grid-template-rows .45s var(--ease)}
.open .ans{grid-template-rows:1fr}
.ans>div{min-height:0;overflow:hidden}
.ans p{margin:0;padding:0 64px 22px 62px;color:var(--text-2);opacity:0;transform:translateY(-8px);transition:opacity .25s,transform .45s var(--ease)}
.open .ans p{opacity:1;transform:none;transition-delay:.08s}
.final{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:24px;margin-top:96px;padding:48px 56px}
.final h2{margin:0}
.final p{margin:6px 0 0;color:var(--text-2)}
footer{display:flex;flex-wrap:wrap;gap:24px;margin-top:80px;padding:36px 0 48px;border-top:1px solid var(--line);color:var(--text-3);font-size:14px}
footer nav{display:flex;gap:20px;margin-left:auto}
footer a:hover{color:var(--text)}

/* İndir: solda yazı, sağda eğik duran gerçek ekran ve üstünde yüzen kartlar */
.dl .bgimg{object-position:center 62%}
.dl .bg::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(22,22,22,.95) 0%,rgba(22,22,22,.82) 34%,rgba(22,22,22,.3) 68%,rgba(22,22,22,.42) 100%),linear-gradient(to top,rgba(22,22,22,.85),rgba(22,22,22,0) 45%)}
.dlgrid{min-height:100%;display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);align-items:center;gap:56px;width:min(1360px,100%);margin:0 auto;padding:110px 64px 64px}
.dl h1{margin:14px 0 16px;font-size:clamp(44px,5vw,72px);font-weight:650;line-height:1.02;letter-spacing:-.045em}
.dl .lead{max-width:480px}
.get{display:flex;flex-wrap:wrap;align-items:center;gap:14px 18px;margin-top:34px}
.get .btn{height:62px;padding:0 36px;font-size:18px}
.trust{display:flex;flex-wrap:wrap;gap:10px 22px;margin:26px 0 0;padding:0;list-style:none;color:var(--text-2);font-size:15px}
.trust li{display:flex;align-items:center;gap:8px}
.trust svg{width:16px;height:16px;color:var(--accent)}
.note{display:flex;align-items:center;gap:12px;max-width:480px;margin-top:28px;padding:14px 18px;border-radius:16px;color:var(--text-2);font-size:14px}
.note svg{flex:none;width:18px;height:18px;color:var(--text-3)}
.device{position:relative;perspective:1800px}
.frame{overflow:hidden;border:1px solid var(--line-strong);border-radius:16px;box-shadow:0 40px 90px rgba(0,0,0,.6);transform:rotateY(-9deg) rotateX(3deg);transform-origin:30% 50%}
.float{position:absolute;display:flex;align-items:center;gap:14px;padding:14px 20px 14px 14px;border-radius:20px;animation:bob 7s ease-in-out infinite alternate}
.float small{display:block;color:var(--text-2);font-size:13px}
.float b{font-size:16px}
.float .cells{font-size:15px;margin-top:4px}
.f-invite{left:-5%;bottom:6%}
.f-toast{right:2%;top:-7%;animation-delay:-3.5s}
.avatar{display:grid;flex:none;place-items:center;width:42px;height:42px;border-radius:50%;background:var(--accent);color:#122;font-weight:700}
.online{display:inline-block;margin-right:6px;vertical-align:1px;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px rgba(108,192,74,.25)}
@keyframes bob{to{transform:translateY(-10px)}}
@media (prefers-reduced-motion:reduce){.anim{animation:none!important}.rise,.qa,.ans,.ans p,.plus,.chipind{transition:none!important}}

@media (max-width:960px){
.bar{padding:0 12px;justify-content:center}.brand span,.gh,.lang a[aria-current]{display:none}.brand{position:absolute;left:10px}.end{position:absolute;right:10px}.lang a{padding:4px 8px}
.pills{position:static;transform:none}.pills a,.ink span{padding:7px 11px;font-size:13px}
.stage{grid-template-columns:1fr;padding:84px 20px 32px}
.play{align-items:stretch}.play .meta{text-align:center}
.dock{flex-direction:column;width:100%}.item+.item{border-left:none;border-top:1px solid var(--line)}
.band,.row,.row.flip,.row.wide .text{grid-template-columns:1fr;gap:28px}.band{padding:36px 28px}.row.flip .text{order:0}
.row.wide .text{gap:0}.row.wide .points{margin-top:18px}
.faqgrid{grid-template-columns:1fr;gap:28px}.faqside{position:static}.ask{margin-top:20px}.qh{gap:12px;padding:16px;font-size:16px}.num{display:none}.ans p{padding:0 16px 18px}.chips{display:flex;overflow-x:auto}
.final{padding:36px 28px}
.band .cells{font-size:min(7vw,30px)}.status .more{display:none}
.wrap{width:calc(100% - 40px);padding-top:100px}.wrap>section+section{margin-top:88px}
.dlgrid{grid-template-columns:1fr;gap:40px;padding:96px 20px 48px}
.dl .bg::after{background:linear-gradient(to bottom,rgba(22,22,22,.9),rgba(22,22,22,.7) 55%,rgba(22,22,22,.9))}
.get .btn{width:100%}
.frame{transform:rotateY(-8deg) rotateX(3deg)}
.float{padding:10px 14px 10px 10px;border-radius:16px}.float b{font-size:14px}.avatar{width:34px;height:34px}
.f-invite{left:-2%;bottom:-12%}.f-toast{right:-2%;top:-14%}
}
@media (max-width:420px){.pills a,.ink span{padding:7px 9px}}
`;

/**
 * Şerit: yay benzeri hareket (kritik sönümün az üstü, yerine aşmadan oturur) ve hıza göre esneme
 * (uygulamadaki gibi en çok %5 genişleme, 2,5° eğilme). Hap göstergesi şeridin konumunu izler.
 * Adres çubuğu (`#features`), geri tuşu ve dokunmatik kaydırma çalışır.
 */
const SCRIPT = `(()=>{
const ids=${JSON.stringify(PAGES)};
const $=(s)=>document.querySelector(s),$$=(s)=>[...document.querySelectorAll(s)];
const strip=$(".strip"),bar=$(".bar"),nav=$(".pills"),ind=$(".pills .ind"),ink=$(".pills .ink");
const pgs=$$(".pg"),scrolls=pgs.map((p)=>p.querySelector(".scroll")),pills=$$(".pills a");
const reduce=matchMedia("(prefers-reduced-motion: reduce)");
const K=240,M=0.9,C=31,MAXV=7000;
let W=innerWidth,idx=0,x=0,v=0,target=0,raf=0,last=0,G=[];
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const raf2=()=>new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const chipsEl=$(".chips"),chips=$$(".chips button"),cind=$(".chipind"),qs=$$(".q");
function chipTo(){
  const c=chips.find((b)=>b.getAttribute("aria-pressed")==="true");
  if(c){cind.style.width=c.offsetWidth+"px";cind.style.transform="translateX("+c.offsetLeft+"px)";}
}
const measure=()=>{G=pills.map((a)=>[a.offsetLeft,a.offsetWidth]);chipTo();};
function paint(){
  strip.style.transform="translate3d("+x+"px,0,0)";
  const s=clamp(v/MAXV,-1,1);
  const tf=Math.abs(s)>.002?"scaleX("+(1+Math.abs(s)*.05)+") skewX("+(-s*2.5)+"deg)":"";
  for(const el of scrolls)el.style.transform=tf;
  const p=clamp(-x/W,0,ids.length-1),i=Math.min(Math.floor(p),ids.length-2),f=p-i,a=G[i],b=G[i+1];
  if(a&&b){
    const l=a[0]+(b[0]-a[0])*f,w=a[1]+(b[1]-a[1])*f;
    ind.style.width=w+"px";ind.style.transform="translateX("+l+"px)";
    ink.style.clipPath="inset(4px "+(nav.clientWidth-l-w)+"px 4px "+l+"px round 999px)";
  }
  const on=Math.round(p);pills.forEach((el,j)=>j===on?el.setAttribute("aria-current","page"):el.removeAttribute("aria-current"));
}
function solid(){bar.classList.toggle("solid",scrolls[idx].scrollTop>8);}
function settle(){pgs.forEach((p,j)=>{if(j===idx)p.removeAttribute("data-hidden");else p.setAttribute("data-hidden","");});solid();}
function step(t){
  const dt=Math.min(.032,(t-last)/1000||.016);last=t;
  v+=((-K*(x-target)-C*v)/M)*dt;x+=v*dt;
  if(Math.abs(x-target)<.5&&Math.abs(v)<15){x=target;v=0;raf=0;paint();settle();return;}
  paint();raf=requestAnimationFrame(step);
}
function go(i,o={}){
  i=clamp(i,0,ids.length-1);
  const changed=i!==idx;idx=i;target=-i*W;
  pgs.forEach((p,j)=>{p.inert=j!==i;p.classList.toggle("on",j===i);p.removeAttribute("data-hidden");});
  if(o.push&&changed)history.pushState(null,"",i?"#"+ids[i]:location.pathname+location.search);
  if(o.instant||reduce.matches){
    cancelAnimationFrame(raf);raf=0;x=target;v=0;paint();settle();
    if(!o.instant&&changed)pgs[i].animate([{opacity:0},{opacity:1}],{duration:200,easing:"ease-out"});
    return;
  }
  if(!raf){last=performance.now();raf=requestAnimationFrame(step);}
}
const fromHash=()=>Math.max(0,ids.indexOf(location.hash.slice(1)));
$$("[data-go]").forEach((a)=>a.addEventListener("click",(e)=>{
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;
  e.preventDefault();go(+a.dataset.go,{push:true});
}));
addEventListener("popstate",()=>go(fromHash()));
addEventListener("hashchange",()=>go(fromHash()));
scrolls.forEach((el)=>el.addEventListener("scroll",solid,{passive:true}));
addEventListener("resize",()=>{W=innerWidth;measure();target=-idx*W;if(!raf){x=target;paint();}});
new ResizeObserver(()=>{measure();paint();}).observe($(".pills"));
// Dokunmatik: yatay sürükleme şeridi parmakla taşır, bırakınca hıza göre komşu sayfaya geçer.
let d=null;
const vp=$(".viewport");
vp.addEventListener("pointerdown",(e)=>{if(e.pointerType==="touch")d={x0:e.clientX,y0:e.clientY,base:x,lock:0,lx:e.clientX,lt:e.timeStamp,vx:0};});
vp.addEventListener("pointermove",(e)=>{
  if(!d)return;
  const dx=e.clientX-d.x0,dy=e.clientY-d.y0;
  if(!d.lock){
    if(Math.hypot(dx,dy)<10)return;
    d.lock=Math.abs(dx)>Math.abs(dy)*1.2?1:-1;
    if(d.lock===1){cancelAnimationFrame(raf);raf=0;d.base=x;pgs.forEach((p)=>p.removeAttribute("data-hidden"));}
  }
  if(d.lock!==1)return;
  const dt=e.timeStamp-d.lt;
  if(dt>0)d.vx=d.vx*.4+((e.clientX-d.lx)/dt*1000)*.6;
  d.lx=e.clientX;d.lt=e.timeStamp;
  const min=-(ids.length-1)*W;let nx=d.base+dx;
  if(nx>0)nx/=3;else if(nx<min)nx=min+(nx-min)/3;
  x=nx;v=d.vx;paint();
});
const up=()=>{
  if(!d)return;const t=d;d=null;
  if(t.lock!==1)return;
  const n=Math.round(-(x+t.vx*.18)/W);
  v=t.vx;go(clamp(n,idx-1,idx+1),{push:true});
};
vp.addEventListener("pointerup",up);vp.addEventListener("pointercancel",up);
// SSS: tek seferde bir cevap açık; süzgeç kategorisi dışındakileri yumuşakça kapatır.
function openQ(q,open){q.classList.toggle("open",open);q.querySelector(".qh").setAttribute("aria-expanded",open);}
qs.forEach((q)=>q.querySelector(".qh").addEventListener("click",()=>{
  const open=!q.classList.contains("open");qs.forEach((o)=>openQ(o,o===q&&open));
}));
chips.forEach((c)=>c.addEventListener("click",()=>{
  chips.forEach((b)=>b.setAttribute("aria-pressed",b===c));chipTo();
  const cat=c.dataset.cat;
  $$(".qa").forEach((el)=>{
    const out=cat!=="all"&&el.dataset.cat!==cat;
    el.classList.toggle("out",out);el.inert=out;
    if(out)openQ(el.querySelector(".q"),false);
  });
}));
// Dil değişince aynı sayfada kalınsın.
$$(".lang a").forEach((a)=>a.addEventListener("click",()=>{a.hash=location.hash;}));
measure();go(fromHash(),{instant:true});
// Açılan sayfa da esnemiş hâliyle bir kez çizilsin: ilk iki kare neredeyse saydam, sonra belirir.
{
  const sc=scrolls[idx];
  sc.style.opacity=".01";sc.style.transform="scaleX(1.03) skewX(-1.5deg)";
  raf2().then(()=>{
    sc.style.transform="";sc.style.opacity="";
    if(!reduce.matches)sc.animate([{opacity:0},{opacity:1}],{duration:450,easing:"ease-out"});
  });
}
requestAnimationFrame(()=>chipsEl.classList.add("ready"));
// Görseller kayma sırasında değil, şimdi çözülsün (yoksa ilk geçişte bir an donar).
// Ekran kartı da her sayfayı ilk kez kayarken değil, şimdi bir kez çizsin: sayfa iki kare boyunca
// %1 saydamlıkla görünen yere alınır (fark edilmez), sonra yerine döner.
async function prepaint(){
  for(let j=0;j<pgs.length;j++){
    if(j===idx||raf||d)continue;
    const p=pgs[j];
    p.removeAttribute("data-hidden");p.classList.add("warm");
    p.style.transform="translateX("+((idx-j)*W)+"px)";
    // Hem düz hem esnemiş hâliyle (kayarken eğilince ekran kartı sayfayı yeniden tarar).
    await raf2();
    scrolls[j].style.transform="scaleX(1.03) skewX(-1.5deg)";
    await raf2();
    p.classList.remove("warm");p.style.transform="";scrolls[j].style.transform="";
    if(!raf&&j!==idx)p.setAttribute("data-hidden","");
    await new Promise((r)=>setTimeout(r,60));
  }
}
const warm=()=>Promise.all($$("img").map((i)=>i.decode?i.decode().catch(()=>{}):0)).then(()=>setTimeout(prepaint,200));
if(document.readyState==="complete")warm();else addEventListener("load",warm);
document.fonts&&document.fonts.ready.then(()=>{measure();paint();});
})();`;

const ICONS = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  zap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
};

/** Cubby'nin küpü, zeminsiz (`public/logo.svg` ile aynı); sayfaya gömülü, ayrı istek yok. */
const LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,14 83,33 50,52 17,33" fill="#FFCF85"/><polygon points="17,33 50,52 50,90 17,71" fill="#F0A040"/><polygon points="50,52 83,33 83,71 50,90" fill="#B8681C"/><path d="M59.5 84.5 L59.5 72.5 C59.5 64 73.5 56 73.5 64.5 L73.5 76.5 Z" fill="#FFF0D2"/></svg>`;

const cells = (code: string) =>
  `<span class="cells" aria-label="${code.slice(0, 3)}-${code.slice(3)}">${[...code]
    .map((c, i) => (i === 3 ? `<i></i>` : "") + `<span>${c}</span>`)
    .join("")}</span>`;

export function sitePage(lang: Lang, origin: string, release: LatestRelease | null, nonce: string): string {
  const t = TEXT[lang];
  const e = escapeHtml;
  const shot = (name: string) => `/site/${name}-${lang}.webp`;
  const go = (page: (typeof PAGES)[number]) => {
    const i = PAGES.indexOf(page);
    return `href="${i ? `#${page}` : "./"}" data-go="${i}"`;
  };
  const toDownload = (label: string) => `<a class="btn primary" ${go("download")}>${ICONS.download}${e(label)}</a>`;
  const footer = `<footer><span>© Cubby · ${e(t.rights)}</span><nav><a href="${REPO_URL}" rel="noopener">${e(t.footer[0])}</a><a href="${REPO_URL}/releases" rel="noopener">${e(t.footer[1])}</a><a href="/join">${e(t.footer[2])}</a></nav></footer>`;
  const rows = t.rows
    .map((r, i) => {
      const wide = r.size[0] >= 1000;
      const cls = wide ? " wide" : i % 2 ? " flip" : "";
      const text = wide
        ? `<div class="text"><div><p class="eyebrow">${e(r.eyebrow)}</p><h2>${e(r.title)}</h2></div><div><p class="lead">${e(r.text)}</p><ul class="points">${r.points.map((p) => `<li>${e(p)}</li>`).join("")}</ul></div></div>`
        : `<div class="text"><p class="eyebrow">${e(r.eyebrow)}</p><h2>${e(r.title)}</h2><p class="lead">${e(r.text)}</p><ul class="points">${r.points.map((p) => `<li>${e(p)}</li>`).join("")}</ul></div>`;
      return `<section class="row${cls}">${text}
<div class="shot${wide ? "" : " narrow"}"><img src="${shot(r.img)}" alt="${e(r.title)}" decoding="async" width="${r.size[0]}" height="${r.size[1]}"></div></section>`;
    })
    .join("\n");
  const page = (i: number, cls: string, bg: string, body: string) =>
    `<section class="pg ${cls}${i === 0 ? " on" : ""}" aria-label="${e(t.nav[i])}"${i ? " inert" : ""}><div class="bg">${bg}</div><div class="scroll">${body}</div></section>`;

  const home = page(
    0,
    "home",
    `<img class="bgimg cover anim" src="/site/kapak.webp" alt="" fetchpriority="high"><div class="scrim"></div>`,
    `<div class="stage">
<div>
<p class="caption">${e(t.caption)}</p>
<h1 class="name">Cubby</h1>
<p class="status"><span class="dot"></span>${e(t.ready)} <span class="more">· ${e(t.readyMore)}</span></p>
<div class="dock glass blur">
<div class="item"><span class="icon">${ICONS.globe}</span><span><small>${e(t.dock[0][0])}</small><b>${e(t.dock[0][1])}</b></span></div>
<div class="item"><span class="icon">${ICONS.send}</span><span><small>${e(t.dock[1][0])}</small><b>${cells("K7M2QX")}</b></span></div>
<div class="item"><span class="icon">${ICONS.zap}</span><span><small>${e(t.dock[2][0])}</small><b>${e(t.dock[2][1])}</b></span></div>
</div>
</div>
<div class="play">${toDownload(t.download)}<span class="meta">${e(t.meta(release))}</span></div>
</div>`,
  );

  const features = page(
    1,
    "features",
    "",
    `<main class="wrap">
<section><div class="band glass">${cells("K7M2QX")}<div><p class="eyebrow">${e(t.codeEyebrow)}</p><h2>${e(t.codeTitle)}</h2><p class="lead">${e(t.codeText)}</p></div></div></section>
${rows}
<div class="final glass"><div><h2>${e(t.finalTitle)}</h2><p>${e(t.meta(release))}</p></div>${toDownload(t.download)}</div>
${footer}
</main>`,
  );

  const faq = page(
    2,
    "faqpg",
    "",
    `<main class="wrap">
<div class="faqgrid">
<aside class="faqside"><div class="rise">
<h1 class="title">${e(t.faqTitle)}</h1><p class="lead">${e(t.faqLead)}</p>
<a class="ask glass" href="${REPO_URL}/issues" rel="noopener"><span class="icon">${ICONS.chat}</span><span><b>${e(t.faqAsk[0])}</b><small>${e(t.faqAsk[1])}</small></span><span class="arrow">${ICONS.arrow}</span></a>
</div></aside>
<div>
<div class="chips rise" role="group" aria-label="${e(t.faqTitle)}"><span class="chipind"></span>${t.faqCats
      .map(
        ([c, l], i) =>
          `<button type="button" data-cat="${c}" aria-pressed="${i === 0}">${e(l)}<i>${c === "all" ? t.faq.length : t.faq.filter((f) => f[0] === c).length}</i></button>`,
      )
      .join("")}</div>
${t.faq
  .map(
    ([c, q, a], i) =>
      `<div class="qa" data-cat="${c}"><div><div class="rise" style="--i:${i + 1}"><div class="q${i === 0 ? " open" : ""}"><button type="button" class="qh" id="q${i}" aria-expanded="${i === 0}" aria-controls="a${i}"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="qt">${e(q)}</span><span class="plus" aria-hidden="true"></span></button><div class="ans" id="a${i}" role="region" aria-labelledby="q${i}"><div><p>${e(a)}</p></div></div></div></div></div></div>`,
  )
  .join("\n")}
</div>
</div>
<div class="final glass"><div><h2>${e(t.finalTitle)}</h2><p>${e(t.meta(release))}</p></div>${toDownload(t.download)}</div>
${footer}
</main>`,
  );

  const download = page(
    3,
    "dl",
    `<img class="bgimg" src="/site/indir.webp" alt="" decoding="async">`,
    `<div class="dlgrid">
<div>
<p class="eyebrow">${e(t.dlEyebrow)}</p>
<h1>${e(t.dlTitle)}</h1>
<p class="lead">${e(t.dlLead)}</p>
<div class="get"><a class="btn primary" href="${DOWNLOAD_PATH}">${ICONS.download}${e(t.downloadLong)}</a><span class="meta">${e(t.dlMeta(release))}</span></div>
<ul class="trust">${t.trust.map((s) => `<li>${ICONS.check}${e(s)}</li>`).join("")}</ul>
<p class="note glass blur">${ICONS.shield}<span>${e(t.dlNote)}</span></p>
</div>
<div class="device">
<div class="frame"><img src="${shot("oyna")}" alt="${e(t.shotAlt)}" decoding="async" width="1200" height="720"></div>
<div class="float glass blur f-invite anim"><span class="icon">${ICONS.send}</span><span><small>${e(t.inviteCard)}</small>${cells("K7M2QX")}</span></div>
<div class="float glass blur f-toast anim"><span class="avatar">A</span><span><b>${e(t.joined)}</b><small><span class="online"></span>${e(t.joinedMore)}</small></span></div>
</div>
</div>`,
  );

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
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="preload" as="image" href="/site/kapak.webp">
<style>${STYLE}</style>
</head>
<body>
<header class="bar">
<a class="brand" ${go("home")}>${LOGO}<span>Cubby</span></a>
<nav class="pills"><span class="ind"></span>${PAGES.map((p, i) => `<a ${go(p)}>${e(t.nav[i])}</a>`).join("")}<span class="ink" aria-hidden="true">${t.nav.map((n) => `<span>${e(n)}</span>`).join("")}</span></nav>
<div class="end">
<nav class="lang" aria-label="${e(t.langLabel)}">${(["tr", "en"] as const)
    .map((l) => `<a href="/?lang=${l}" hreflang="${l}" lang="${l}"${l === lang ? ` aria-current="true"` : ""}>${l.toUpperCase()}</a>`)
    .join("")}</nav>
<a class="gh" href="${REPO_URL}" rel="noopener">GitHub</a>
</div>
</header>
<div class="viewport"><div class="strip">
${home}
${features}
${faq}
${download}
</div></div>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
