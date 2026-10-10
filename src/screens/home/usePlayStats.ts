import { useEffect, useState } from "react";
import { api, type PlayStats, type ServerStatus } from "../../lib/api";

/** Son oynanma + toplam süre; sunucu kapandığında (yeni oturum yazıldı) yenilenir. */
export function usePlayStats(id: string, status: ServerStatus): PlayStats | null {
  const [stats, setStats] = useState<PlayStats | null>(null);
  const settled = status === "stopped" || status === "crashed";
  useEffect(() => {
    if (!settled) return;
    let cancelled = false;
    // Oturum kaydı durum olayından hemen sonra yazılıyor; kısa bir gecikme yeter.
    const t = setTimeout(() => {
      api
        .playStats(id)
        .then((s) => !cancelled && setStats(s))
        .catch(console.error);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [id, settled]);
  return stats;
}
