import { useEffect } from "react";
import { api, type ConnectionView } from "../../lib/api";
import { useAppStore } from "../../store/appStore";

/** Dünyanın bağlantı durumu; ilk açılışta çekilir, sonra `net://status` ile güncellenir. */
export function useConnection(id: string | null): ConnectionView | null {
  const view = useAppStore((s) => (id ? s.connections[id] : undefined));
  const setConnection = useAppStore((s) => s.setConnection);

  useEffect(() => {
    if (!id) return;
    api
      .connectionStatus(id)
      .then((v) => setConnection(id, v))
      .catch(console.error);
  }, [id, setConnection]);

  return view ?? null;
}

export type Invite = { address: string; internet: boolean };

/** Davet için en iyi adres: internete açıksa modem üzerinden, değilse LAN. */
export function bestInvite(view: ConnectionView | null): Invite | null {
  if (!view) return null;
  if (view.internet && view.direct.state === "ok" && view.direct.address) {
    return { address: view.direct.address, internet: true };
  }
  return view.lan ? { address: view.lan, internet: false } : null;
}
