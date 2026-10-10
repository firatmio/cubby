import type { Instance, LoaderKind } from "./api";

export const LOADER_LABELS: Record<LoaderKind, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  paper: "Paper",
};

/** Mod/plugin klasörü olan türler. */
export const CONTENT_DIR_LABEL: Partial<Record<LoaderKind, string>> = {
  fabric: "Mods",
  paper: "Plugins",
};

/** "Fabric 26.3 · loader 0.19.5", "Paper 26.3 · build 169", "Vanilla 26.3" */
export function describeInstance(i: Instance): string {
  const base = `${LOADER_LABELS[i.loader]} ${i.mcVersion}`;
  if (!i.loaderVersion) return base;
  return `${base} · ${i.loader === "paper" ? "build" : "loader"} ${i.loaderVersion}`;
}

export function formatBytesMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export function formatRam(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("tr-TR");
}
