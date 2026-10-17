import { describe, expect, test } from "bun:test";
import { ALPHABET, CODE_LEN, formatCode, hashOwner, newCode, newOwner, normalizeCode } from "./code.js";
import { escapeHtml, invitePage } from "./html.js";
import { pickLang } from "./i18n.js";
import { MAX_INVITE_LEN, parseInvite } from "./invite.js";

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
    const page = invitePage({
      lang: "tr",
      origin: "https://cubby-join.vercel.app",
      code: "K7M2QX",
      world: `<img src=x onerror=alert(1)>`,
      tech: "Fabric · Minecraft 26.3",
    });
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(page).toContain(`href="cubby://join?c=K7M2QX"`);
    expect(page).toContain("K7M-2QX");
    expect(page).toContain(`og:url" content="https://cubby-join.vercel.app/K7M2QX"`);
    // Uzun anahtar sayfaya girmez.
    expect(page).not.toContain(sample.token);
  });

  test("dil seçimi", () => {
    expect(pickLang("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(pickLang("en-US,en;q=0.9,tr;q=0.8")).toBe("en");
    expect(pickLang("de-DE,tr;q=0.5")).toBe("tr");
    expect(pickLang("de-DE")).toBe("en");
    expect(pickLang(null)).toBe("en");
  });
});
