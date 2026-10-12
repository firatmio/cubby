import type { LaunchResult } from "./api";

/** Launcher açıldıktan sonra oyuncuya ne yapacağını söyleyen tek cümle. */
export function launchHint(r: LaunchResult, worldName: string): { tone: "info" | "error"; text: string } {
  if (r.error) return { tone: "error", text: `Minecraft hazırlanamadı: ${r.error}` };
  const then = r.direct ? "Oyna'ya bas, doğrudan dünyaya girersin." : `Oyna'ya bas → Çok Oyunculu → ${worldName}.`;
  if (r.launcher === "tLauncher") return { tone: "info", text: `TLauncher'ı aç, "${r.pick}" sürümünü seç. ${then}` };
  if (!r.opened) return { tone: "info", text: `Minecraft Launcher'ı aç, "${r.pick}" profilini seç. ${then}` };
  if (r.wasRunning) return { tone: "info", text: `Launcher zaten açıktı: "${r.pick}" profilini seç. ${then}` };
  return { tone: "info", text: `Minecraft Launcher açılıyor, "${r.pick}" seçili. ${then}` };
}
