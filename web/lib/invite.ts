/**
 * Uygulamanın uzun davet kodu (`src-tauri/src/invite.rs`): JSON → base64url.
 * Burada yalnız biçim denetlenir; uygulama çözdüğünde ayrıca doğrular.
 */

export const MAX_INVITE_LEN = 2048;
const LOADERS = ["vanilla", "fabric", "paper", "neoforge", "forge", "quilt"] as const;

export interface Invite {
  v: number;
  name: string;
  host: string;
  world: string;
  token: string;
  loader: (typeof LOADERS)[number];
  mcVersion: string;
  loaderVersion: string | null;
}

const version = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= 64 && !v.startsWith(".") && /^[A-Za-z0-9.\-_+]+$/.test(v);

function decode(code: string): unknown {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Geçerliyse boşlukları atılmış kod ve içeriği; değilse null. */
export function parseInvite(input: unknown): { code: string; invite: Invite } | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/\s/g, "").replace(/=+$/, "");
  if (!code || code.length > MAX_INVITE_LEN || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  let v: Record<string, unknown>;
  try {
    const parsed = decode(code);
    if (!parsed || typeof parsed !== "object") return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const name = typeof v.name === "string" ? v.name : "";
  const ok =
    v.v === 1 &&
    name.trim().length > 0 &&
    [...name].length <= 64 &&
    typeof v.host === "string" &&
    /^[0-9a-f]{64}$/.test(v.host) &&
    typeof v.world === "string" &&
    /^[A-Za-z0-9-]{1,64}$/.test(v.world) &&
    typeof v.token === "string" &&
    /^[0-9a-fA-F]{32}$/.test(v.token) &&
    LOADERS.includes(v.loader as Invite["loader"]) &&
    version(v.mcVersion) &&
    (v.loaderVersion === null || v.loaderVersion === undefined || version(v.loaderVersion));
  if (!ok) return null;
  return {
    code,
    invite: {
      v: 1,
      name,
      host: v.host as string,
      world: v.world as string,
      token: v.token as string,
      loader: v.loader as Invite["loader"],
      mcVersion: v.mcVersion as string,
      loaderVersion: (v.loaderVersion as string | null | undefined) ?? null,
    },
  };
}

/** Uygulamadaki adlarla (`LoaderKind::label`). */
export const LOADER_LABELS: Record<Invite["loader"], string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  paper: "Paper",
  neoforge: "NeoForge",
  forge: "Forge",
  quilt: "Quilt",
};
