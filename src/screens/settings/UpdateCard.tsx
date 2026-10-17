import { useState } from "react";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { api, errorMessage, type AppSettings } from "../../lib/api";
import { useT } from "../../i18n";
import { useAppStore } from "../../store/appStore";
import { updateLine } from "../../shell/Update";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Toggle } from "../../ui/Toggle";
import styles from "../instance/sections.module.css";

/** Ayarlar › Güncellemeler: sürüm, durum, elle denetleme, otomatik indirme ve deneme kanalı. */
export function UpdateCard({ settings, save }: { settings: AppSettings; save: (s: AppSettings) => Promise<void> }) {
  const update = useAppStore((s) => s.update);
  const setUpdate = useAppStore((s) => s.setUpdate);
  const openUpdate = useAppStore((s) => s.openUpdate);
  const [error, setError] = useState<string | null>(null);
  const t = useT().update;
  const state = update?.status.state;
  // Deneme sürümü kullanan zaten deneme kanalında (Rust `updates::wants_beta`).
  const onBeta = !!update?.current.includes("-");

  const check = async () => {
    setError(null);
    try {
      setUpdate(await api.updateCheck());
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card title={update ? t.cardTitle(update.current) : t.cardTitleShort} description={updateLine(update, t)}>
      <div className={styles.row}>
        {state === "ready" ? (
          <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => openUpdate(true)}>
            {t.restart}
          </Button>
        ) : state === "available" ? (
          <Button size="sm" variant="primary" icon={Download} onClick={() => openUpdate(true)}>
            {t.download}
          </Button>
        ) : (
          <Button
            size="sm"
            icon={RefreshCw}
            loading={state === "checking"}
            disabled={state === "downloading" || state === "installing"}
            onClick={check}
          >
            {t.checkNow}
          </Button>
        )}
      </div>
      <Toggle
        checked={settings.autoUpdate}
        onChange={(autoUpdate) => save({ ...settings, autoUpdate })}
        label={t.auto}
        description={t.autoText}
      />
      <Toggle
        checked={settings.betaUpdates || onBeta}
        disabled={onBeta}
        onChange={(betaUpdates) => save({ ...settings, betaUpdates })}
        label={t.beta}
        description={onBeta ? t.betaForced : t.betaText}
      />
      {error && <p className={styles.error}>{error}</p>}
    </Card>
  );
}
