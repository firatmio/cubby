/** Sayfanın metinleri: Türkçe ve İngilizce (uygulamadaki gibi "arkadaşın"). */

export type Lang = "tr" | "en";

export const TEXT = {
  tr: {
    inviteTitle: (world: string) => `${world} — Cubby daveti`,
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
  },
  en: {
    inviteTitle: (world: string) => `${world} — Cubby invite`,
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
