import { describe, expect, test } from "bun:test";
import { compareVersions, installerAssets, parseVersion, pickRelease, updateBody, type GhRelease } from "./update.js";

const rel = (tag: string, prerelease = false, extra: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag,
  body: `notlar ${tag}`,
  draft: false,
  prerelease,
  published_at: "2026-10-17T12:00:00Z",
  assets: [
    { name: `Cubby_${tag.slice(1)}_x64-setup.exe`, browser_download_url: `https://github.com/x/${tag}.exe` },
    { name: `Cubby_${tag.slice(1)}_x64-setup.exe.sig`, browser_download_url: `https://github.com/x/${tag}.exe.sig` },
  ],
  ...extra,
});

describe("sürüm karşılaştırma", () => {
  test("semver sırası", () => {
    expect(parseVersion("v0.2.0-beta.1")).toEqual({ core: [0, 2, 0], pre: ["beta", 1] });
    expect(parseVersion("1.2")).toBeNull();
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0-beta.2", "0.2.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("0.2.0-beta.1", "0.2.0-alpha.3")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});

describe("kanal seçimi", () => {
  const list = [rel("v0.2.0"), rel("v0.3.0-beta.1", true), rel("v0.1.0"), rel("v0.4.0", false, { draft: true })];

  test("kararlıda pre-release ve taslak sayılmaz", () => {
    expect(pickRelease(list, "stable")?.tag_name).toBe("v0.2.0");
  });

  test("beta en yenisini alır", () => {
    expect(pickRelease(list, "beta")?.tag_name).toBe("v0.3.0-beta.1");
    // Beta'dan sonra kararlı çıkınca beta kullanıcısı da kararlıya geçer.
    expect(pickRelease([...list, rel("v0.3.0")], "beta")?.tag_name).toBe("v0.3.0");
  });

  test("kurulum dosyası ya da imzası eksik sürüm atlanır", () => {
    const broken = rel("v0.5.0", false, { assets: [rel("v0.5.0").assets[0]] });
    expect(installerAssets(broken)).toBeNull();
    expect(pickRelease([broken, rel("v0.2.0")], "stable")?.tag_name).toBe("v0.2.0");
    expect(pickRelease([], "stable")).toBeNull();
  });

  test("Tauri yanıtı", () => {
    const body = updateBody(rel("v0.2.0"), "  imza\n");
    expect(body).toEqual({
      version: "0.2.0",
      notes: "notlar v0.2.0",
      pub_date: "2026-10-17T12:00:00Z",
      url: "https://github.com/x/v0.2.0.exe",
      signature: "imza",
    });
  });
});
