import type { GameProgress, LaunchResult } from "./api";

/** Launcher açıldıktan sonra oyuncuya ne yapacağını söyleyen tek cümle. */
export function launchHint(r: LaunchResult, worldName: string): { tone: "info" | "error"; text: string } {
  if (r.error) return { tone: "error", text: `Minecraft hazırlanamadı: ${r.error}` };
  if (r.game) return { tone: "info", text: "Minecraft açılıyor; doğrudan dünyaya gireceksin." };
  const why = r.note ? `Oyun doğrudan açılamadı (${r.note}). ` : "";
  const then = r.direct ? "Oyna'ya bas, doğrudan dünyaya girersin." : `Oyna'ya bas → Çok Oyunculu → ${worldName}.`;
  if (r.launcher === "tLauncher") return { tone: "info", text: `${why}TLauncher'ı aç, "${r.pick}" sürümünü seç. ${then}` };
  if (!r.opened) return { tone: "info", text: `${why}Minecraft Launcher'ı aç, "${r.pick}" profilini seç. ${then}` };
  if (r.wasRunning) return { tone: "info", text: `${why}Launcher zaten açıktı: "${r.pick}" profilini seç. ${then}` };
  return { tone: "info", text: `${why}Minecraft Launcher açılıyor, "${r.pick}" seçili. ${then}` };
}

/** Oyun Launcher'sız hazırlanırken gösterilen satır. */
export function progressHint(p: GameProgress): string {
  if (p.stage === "java") return "Java hazırlanıyor…";
  if (p.stage === "starting") return "Minecraft açılıyor…";
  const n = (x: number) => x.toLocaleString("tr-TR");
  return p.total > 0 ? `Oyun dosyaları hazırlanıyor · ${n(p.done)}/${n(p.total)}` : "Oyun hazırlanıyor…";
}
