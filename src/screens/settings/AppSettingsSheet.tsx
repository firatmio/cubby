import { useEffect, useState } from "react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { useLang, useT } from "../../i18n";
import { api, errorMessage, pickFolder, type AppSettings, type SettingsView } from "../../lib/api";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { PillTabs } from "../../ui/PillTabs";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import { AccountCard } from "./AccountCard";
import styles from "../instance/sections.module.css";
import own from "./AppSettingsSheet.module.css";

type LangChoice = "auto" | "tr" | "en";

/** Uygulama geneli: dil, hesap, Minecraft klasörü ve ekran görüntülerinin kapak olarak kullanılması. */
export function AppSettingsSheet() {
  const open = useAppStore((s) => s.sheet === "settings");
  const openSheet = useAppStore((s) => s.openSheet);
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const setLang = useLang((s) => s.setLang);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.getSettings().then(setView).catch((e) => setError(errorMessage(e)));
  }, [open]);

  const save = async (settings: AppSettings) => {
    setError(null);
    try {
      const v = await api.updateSettings(settings);
      setView(v);
      setLang(v.language);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const chooseDir = async () => {
    if (!view) return;
    const dir = await pickFolder(t.settings.mcFolderPick);
    if (dir) await save({ ...view.settings, minecraftDir: dir });
  };

  return (
    <Sheet open={open} title={t.settings.title} onClose={() => openSheet(null)}>
      {view && (
        <div className={styles.stack}>
          <Card title={t.settings.language} description={t.settings.languageText}>
            <PillTabs<LangChoice>
              tabs={[
                { id: "auto", label: t.settings.langAuto },
                { id: "tr", label: "Türkçe" },
                { id: "en", label: "English" },
              ]}
              active={view.settings.language ?? "auto"}
              onChange={(c) => save({ ...view.settings, language: c === "auto" ? null : c })}
              layoutId="language-tab"
            />
          </Card>
          <AccountCard />
          <Card>
            <Toggle
              checked={view.settings.useScreenshots}
              onChange={(useScreenshots) => save({ ...view.settings, useScreenshots })}
              label={t.settings.screenshots}
              description={t.settings.screenshotsText}
            />
          </Card>

          <Card>
            <Toggle
              checked={view.settings.clientSync}
              onChange={(clientSync) => save({ ...view.settings, clientSync })}
              label={t.settings.clientSync}
              description={t.settings.clientSyncText}
            />
          </Card>

          <Card
            title={t.settings.mcFolder}
            description={t.settings.mcFolderText}
          >
            <p className={own.path} title={view.minecraftDir ?? undefined}>
              {view.minecraftDir ?? t.settings.notFound}
            </p>
            {!view.screenshotsFound && (
              <p className={styles.dim}>{t.settings.noScreenshots}</p>
            )}
            <div className={styles.row}>
              <Button size="sm" icon={FolderOpen} onClick={chooseDir}>
                {t.settings.change}
              </Button>
              {view.settings.minecraftDir && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  onClick={() => save({ ...view.settings, minecraftDir: null })}
                >
                  {t.settings.reset}
                </Button>
              )}
            </div>
          </Card>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
      {!view && error && <p className={styles.error}>{error}</p>}
    </Sheet>
  );
}
