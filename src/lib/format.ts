import type { LoaderKind } from "./api";

export const LOADER_LABELS: Record<LoaderKind, string> = {
  vanilla: "Vanilla",
};

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
