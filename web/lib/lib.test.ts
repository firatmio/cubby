import { describe, expect, test } from "bun:test";
import { ALPHABET, CODE_LEN, formatCode, hashOwner, newCode, newOwner, normalizeCode } from "./code.js";
import { escapeHtml, invitePage, notFoundPage } from "./html.js";
import { pickLang } from "./i18n.js";
import { MAX_INVITE_LEN, parseInvite } from "./invite.js";
import { COVER_MAX_BYTES, cleanHost, parseMeta, parseStatus, statusView } from "./meta.js";
import { formatSize, latestFrom } from "./release.js";
import type { GhRelease } from "./update.js";

/** Davet sayfasının en sade hali (kapak, durum, ad yok). */
const view = (over: Partial<Parameters<typeof invitePage>[0]> = {}): Parameters<typeof invitePage>[0] => ({
  lang: "tr",
  origin: "https://cubby-join.vercel.app",
  code: "K7M2QX",
  world: "W",
  tech: "Fabric · Minecraft 26.3",
  host: null,
  cover: null,
  status: null,
  mods: 0,
  downloadSize: "",
  nonce: "n0nce",
  ...over,
});

const b64url = (obj: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const sample = {
  v: 1,
  name: "Kardeşlerle survival",
  host: "f".repeat(64),
  world: "a1b2c3d4-0000-4000-8000-000000000000",
  token: "0123456789abcdef0123456789abcdef",
  loader: "fabric",
  mcVersion: "26.3",
  loaderVersion: "0.19.5",
};

describe("kısa kod", () => {
  test("alfabe karışan karakter içermez", () => {
    for (const c of "01OIL") expect(ALPHABET.includes(c)).toBe(false);
    expect(ALPHABET.length).toBe(31);
  });

  test("üretilen kodlar geçerli ve dağılım düzgün", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const c = newCode();
      expect(c).toHaveLength(CODE_LEN);
      expect(normalizeCode(c)).toBe(c);
      for (const ch of c) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(31);
    // 24000 karakter / 31 ≈ 774; sapmasız seçimde her biri makul aralıkta.
    for (const n of counts.values()) expect(n).toBeGreaterThan(600);
  });

  test("31'in katı dışındaki baytlar atılır", () => {
    // Hep 255 (sınırın üstü) gelen bir kaynak sonsuza dek beklemesin diye sonra 0 verir.
    let calls = 0;
    const code = newCode((b: Uint8Array) => b.fill(calls++ === 0 ? 255 : 0));
    expect(code).toBe("222222");
  });

  test("normalleştirme", () => {
    expect(normalizeCode("k7m-2qx")).toBe("K7M2QX");
    expect(normalizeCode(" K7M 2QX ")).toBe("K7M2QX");
    expect(normalizeCode("K7M2Q")).toBeNull();
    expect(normalizeCode("K7M2QXX")).toBeNull();
    expect(normalizeCode("K0M2QX")).toBeNull();
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(formatCode("K7M2QX")).toBe("K7M-2QX");
  });

  test("sahiplik anahtarı ve özeti", async () => {
    const o = newOwner();
    expect(o).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashOwner(o)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashOwner(o)).toBe(await hashOwner(o));
    expect(await hashOwner(o)).not.toBe(await hashOwner(newOwner()));
  });
});

describe("uzun davet", () => {
  test("geçerli davet okunur, boşluklar atılır", () => {
    const code = b64url(sample);
    const r = parseInvite(` ${code.slice(0, 10)}\n${code.slice(10)} `)!;
    expect(r.code).toBe(code);
    expect(r.invite.name).toBe("Kardeşlerle survival");
    expect(r.invite.loaderVersion).toBe("0.19.5");
    expect(parseInvite(b64url({ ...sample, loaderVersion: null }))!.invite.loaderVersion).toBeNull();
  });

  test("bozuk, büyük ya da yanlış alanlı davet reddedilir", () => {
    expect(parseInvite(undefined)).toBeNull();
    expect(parseInvite("")).toBeNull();
    expect(parseInvite("merhaba dünya")).toBeNull();
    expect(parseInvite("a".repeat(MAX_INVITE_LEN + 1))).toBeNull();
    expect(parseInvite(b64url([1, 2]))).toBeNull();
    for (const bad of [
      { v: 2 },
      { name: "" },
      { name: "x".repeat(65) },
      { host: "not-a-key" },
      { world: "../etc" },
      { token: "short" },
      { loader: "liteloader" },
      { mcVersion: "../1.21" },
      { loaderVersion: "a b" },
    ]) {
      expect(parseInvite(b64url({ ...sample, ...bad }))).toBeNull();
    }
  });
});

describe("sayfa", () => {
  test("HTML kaçışlanır", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    const page = invitePage(view({ world: `<img src=x onerror=alert(1)>`, host: `<b>x</b>` }));
    expect(page).not.toContain("<b>x</b>");
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page).toContain(`href="cubby://join?c=K7M2QX"`);
    expect(page).toContain("K7M-2QX");
    expect(page).toContain(`og:url" content="https://cubby-join.vercel.app/join/K7M2QX"`);
    // Uzun anahtar sayfaya girmez.
    expect(page).not.toContain(sample.token);
  });

  test("davet ve 404 sayfaları dizinlenmez", () => {
    const page = invitePage(view({ lang: "en", origin: "https://x.test" }));
    expect(page).toContain(`<meta name="robots" content="noindex">`);
    const nf = notFoundPage("tr", "https://x.test");
    expect(nf).toContain("Sayfa bulunamadı");
    expect(nf).toContain(`href="/"`);
    expect(nf).toContain(`<meta name="robots" content="noindex">`);
  });

  test("kapak, durum, ad ve modlar", () => {
    const plain = invitePage(view());
    expect(plain).toContain("Arkadaşın seni çağırıyor");
    expect(plain).toContain(`twitter:card" content="summary"`);
    expect(plain).not.toContain(`class="status`);
    expect(plain).not.toContain(`class="mods"`);

    const rich = invitePage(
      view({
        host: "firatmio",
        cover: "/api/cover?code=K7M2QX&v=3",
        status: { state: "open", players: 2, maxPlayers: 20 },
        mods: 34,
        downloadSize: "12 MB",
      }),
    );
    expect(rich).toContain("firatmio seni çağırıyor");
    expect(rich).toContain(`og:image" content="https://cubby-join.vercel.app/api/cover?code=K7M2QX&amp;v=3"`);
    expect(rich).toContain(`summary_large_image`);
    expect(rich).toContain("Açık · 2 oyuncu oyunda");
    expect(rich).toContain("34 mod");
    expect(rich).toContain("12 MB");
    expect(rich).toContain(`<script nonce="n0nce">`);
    expect(invitePage(view({ status: { state: "closed" } }))).toContain("Şu an kapalı");
  });

  test("dil seçimi", () => {
    expect(pickLang("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(pickLang("en-US,en;q=0.9,tr;q=0.8")).toBe("en");
    expect(pickLang("de-DE,tr;q=0.5")).toBe("tr");
    expect(pickLang("de-DE")).toBe("en");
    expect(pickLang(null)).toBe("en");
  });
});

describe("meta ve durum", () => {
  const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
  test("meta doğrulaması", () => {
    expect(parseMeta({ host: "  firatmio ", mods: 3, cover: jpeg, coverVersion: 5 })).toMatchObject({
      host: "firatmio",
      mods: 3,
      coverVersion: 5,
    });
    expect(parseMeta({ cover: null })).toEqual({ cover: null });
    expect(parseMeta({})).toEqual({});
    // PNG, bozuk base64, sınır üstü ve yanlış türler reddedilir.
    expect(parseMeta({ cover: btoa("PNG....") })).toBeNull();
    expect(parseMeta({ cover: "%%%" })).toBeNull();
    const big = new Uint8Array(COVER_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(parseMeta({ cover: Buffer.from(big).toString("base64") })).toBeNull();
    expect(parseMeta({ mods: -1 })).toBeNull();
    expect(parseMeta({ host: 3 })).toBeNull();
    expect(cleanHost("x".repeat(40))).toHaveLength(24);
    expect(cleanHost("   ")).toBeNull();
  });

  test("durum", () => {
    expect(parseStatus({ running: true, players: 2, maxPlayers: 20 })).toEqual({ running: true, players: 2, maxPlayers: 20 });
    expect(parseStatus({ running: "yes", players: 2, maxPlayers: 20 })).toBeNull();
    expect(parseStatus({ running: true, players: 1.5, maxPlayers: 20 })).toBeNull();
    expect(statusView(null)).toBeNull();
    expect(statusView({ running: false, players: 0, maxPlayers: 20 })).toEqual({ state: "closed" });
  });
});

describe("son sürüm", () => {
  const rel = (tag: string, prerelease: boolean, size = 12_000_000): GhRelease => ({
    tag_name: tag,
    body: null,
    draft: false,
    prerelease,
    published_at: null,
    assets: [
      { name: `Cubby_${tag}_x64-setup.exe`, browser_download_url: `https://x/${tag}.exe`, size },
      { name: `Cubby_${tag}_x64-setup.exe.sig`, browser_download_url: `https://x/${tag}.sig` },
    ],
  });
  test("kararlı varsa o, yoksa deneme", () => {
    expect(latestFrom([rel("v0.2.0-beta.3", true), rel("v0.2.0-beta.4", true)])?.version).toBe("0.2.0-beta.4");
    expect(latestFrom([rel("v0.2.0-beta.4", true), rel("v0.1.0", false)])).toMatchObject({ version: "0.1.0", prerelease: false });
    expect(latestFrom([])).toBeNull();
    expect(formatSize(12_582_912)).toBe("12 MB");
    expect(formatSize(3_145_728)).toBe("3.0 MB");
    expect(formatSize(0)).toBe("");
  });
});
