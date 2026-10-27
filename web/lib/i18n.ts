/** Sayfanın metinleri: Türkçe ve İngilizce (uygulamadaki gibi "arkadaşın"). */

export type Lang = "tr" | "en";

export const TEXT = {
  tr: {
    inviteTitle: (world: string) => `${world} — Cubby daveti`,
    hostInvites: (host: string) => `${host} seni çağırıyor`,
    statusOpenPlayers: (n: number) => `Açık · ${n} oyuncu oyunda`,
    statusOpenEmpty: "Açık · hemen girebilirsin",
    statusClosed: "Şu an kapalı · arkadaşın açınca girebilirsin",
    modsNote: (n: number) => `Bu dünyada ${n} mod var; Cubby gerekenleri kendiliğinden kurar, sen bir şey yapmazsın.`,
    copyCode: "Kodu kopyala",
    copied: "Kopyalandı",
    copyLink: "Linki kopyala",
    guideTitle: "Cubby'n yok mu?",
    guide1: (size: string) => `Cubby'yi indir${size ? ` (${size})` : ""}.`,
    guide2: "Kur ve aç. Kurulum bir dakika sürmez.",
    guide3: "Kodu kopyaladıysan Katıl kendiliğinden dolar; kopyalamadıysan kodu yaz.",
    notDetected: "Cubby açılmadı; bilgisayarında kurulu değil gibi görünüyor. Önce indirip kur.",
    windowsOnly: "Windows 10 ve 11",
    whatIsCubby: "Cubby nedir?",
    inviteDesc: (tech: string) => `Arkadaşın seni Minecraft dünyasına çağırıyor · ${tech}`,
    eyebrow: "Arkadaşın seni çağırıyor",
    open: "Cubby'de aç",
    download: "Cubby'yi indir",
    codeLabel: "Davet kodu",
    codeHint: "Cubby'de Katıl'a bu kodu da yazabilirsin.",
    notInstalled: "Cubby kurulu değilse önce indir, kurduktan sonra bu sayfaya dönüp tekrar \"Cubby'de aç\"a bas.",
    desktopOnly: "Cubby bir bilgisayar uygulaması. Bu linki Minecraft oynadığın bilgisayarda aç.",
    notFoundTitle: "Davet bulunamadı",
    notFoundText: "Bu davet yenilenmiş ya da uzun süredir kullanılmıyor. Arkadaşından yeni bir davet iste.",
    homeTitle: "Cubby — Arkadaşlarınla kendi Minecraft dünyan",
    homeDesc:
      "Cubby, terminalle uğraşmadan bir Minecraft sunucusu kurar ve çalıştırır, arkadaşlarını davet eder ve oyunu doğrudan dünyada açar.",
    homeHeading: "Arkadaşlarınla kendi Minecraft dünyan",
    tooMany: "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.",
    badCodeText: "Davet kodları 6 karakterdir, örneğin K7M-2QX. Linki ya da kodu arkadaşından tekrar iste.",
    tryAnother: "Başka kod dene",
    pageNotFoundTitle: "Sayfa bulunamadı",
    pageNotFoundText: "Aradığın sayfa yok ya da taşınmış. Bir davet linkiyle geldiysen arkadaşından linki tekrar göndermesini iste.",
    backHome: "Ana sayfaya dön",
  },
  en: {
    inviteTitle: (world: string) => `${world} — Cubby invite`,
    hostInvites: (host: string) => `${host} is inviting you`,
    statusOpenPlayers: (n: number) => `Open · ${n} ${n === 1 ? "player" : "players"} online`,
    statusOpenEmpty: "Open · you can join right now",
    statusClosed: "Closed right now · you can join once your friend opens it",
    modsNote: (n: number) => `This world has ${n} mods; Cubby installs what you need by itself.`,
    copyCode: "Copy code",
    copied: "Copied",
    copyLink: "Copy link",
    guideTitle: "Don't have Cubby?",
    guide1: (size: string) => `Download Cubby${size ? ` (${size})` : ""}.`,
    guide2: "Install and open it. It takes less than a minute.",
    guide3: "If you copied the code, Join fills itself in; otherwise type the code.",
    notDetected: "Cubby didn't open; it doesn't seem to be installed on this computer. Download and install it first.",
    windowsOnly: "Windows 10 and 11",
    whatIsCubby: "What's Cubby?",
    inviteDesc: (tech: string) => `Your friend is inviting you to their Minecraft world · ${tech}`,
    eyebrow: "Your friend is inviting you",
    open: "Open in Cubby",
    download: "Download Cubby",
    codeLabel: "Invite code",
    codeHint: "You can also type this code into Join in Cubby.",
    notInstalled: "If Cubby isn't installed, download it first, then come back to this page and press \"Open in Cubby\" again.",
    desktopOnly: "Cubby is a desktop app. Open this link on the computer you play Minecraft on.",
    notFoundTitle: "Invite not found",
    notFoundText: "This invite was renewed or hasn't been used for a long time. Ask your friend for a new one.",
    homeTitle: "Cubby — Your own Minecraft world with your friends",
    homeDesc:
      "Cubby sets up and runs a Minecraft server without any terminal work, invites your friends, and opens the game straight into the world.",
    homeHeading: "Your own Minecraft world with your friends",
    tooMany: "Too many attempts. Wait a little and try again.",
    badCodeText: "Invite codes are 6 characters, like K7M-2QX. Ask your friend for the link or code again.",
    tryAnother: "Try another code",
    pageNotFoundTitle: "Page not found",
    pageNotFoundText: "The page you're looking for doesn't exist or has moved. If you came from an invite link, ask your friend to send it again.",
    backHome: "Back to home",
  },
} satisfies Record<Lang, Record<string, unknown>>;

/** `Accept-Language`'ta Türkçe İngilizceden önce geliyorsa Türkçe; yoksa İngilizce. */
export function pickLang(header: string | null): Lang {
  const langs = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((l) => l.tag && !Number.isNaN(l.q))
    .sort((a, b) => b.q - a.q);
  for (const l of langs) {
    if (l.tag.startsWith("tr")) return "tr";
    if (l.tag.startsWith("en")) return "en";
  }
  return "en";
}

/** `?lang=` (seçilince çereze yazılır), sonra `lang` çerezi, sonra tarayıcının dili. */
export function langOf(req: Request): { lang: Lang; chosen: Lang | null } {
  const q = new URL(req.url).searchParams.get("lang");
  if (q === "tr" || q === "en") return { lang: q, chosen: q };
  const c = /(?:^|;\s*)lang=(tr|en)(?:;|$)/.exec(req.headers.get("cookie") ?? "");
  return { lang: c ? (c[1] as Lang) : pickLang(req.headers.get("accept-language")), chosen: null };
}

/** Dil seçimini bir yıl hatırlayan çerez. */
export const langCookie = (lang: Lang) => `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
