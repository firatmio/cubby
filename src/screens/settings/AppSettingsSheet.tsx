import { useEffect, useState } from "react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { useLang, useT } from "../../i18n";
import { settingFrom, useMotion, type MotionSetting } from "../../lib/perf";
import { api, errorMessage, pickExe, pickFolder, type AppSettings, type Launcher, type SettingsView } from "../../lib/api";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { Select } from "../../ui/Select";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import { AccountCard } from "./AccountCard";
import { UpdateCard } from "./UpdateCard";
import styles from "../instance/sections.module.css";
import own from "./AppSettingsSheet.module.css";

type LangChoice = "auto" | "tr" | "en";

/** Oyunu açan launcher: otomatik ya da seçilen; Prism'in yeri bulunamadıysa seçilir. */
function LauncherCard({ view, save }: { view: SettingsView; save: (s: AppSettings) => Promise<void> }) {
  const t = useT().settings;
  const label = (l: Launcher | null) =>
    l === "prism" ? t.launcherPrism : l === "tLauncher" ? t.launcherTL : l === "official" ? t.launcherOfficial : t.launcherNone;
  const choosePrism = async () => {
    const exe = await pickExe(t.prismPick);
    if (exe) await save({ ...view.settings, prismExe: exe, launcher: "prism" });
  };
  return (
    <Card title={t.launcher} description={t.launcherText}>
      <Select
        aria-label={t.launcher}
        value={view.settings.launcher ?? "auto"}
        onChange={(v) => save({ ...view.settings, launcher: v === "auto" ? null : (v as Launcher) })}
        options={[
          { value: "auto", label: t.launcherAuto(label(view.activeLauncher)) },
          { value: "official", label: t.launcherOfficial },
          { value: "tLauncher", label: t.launcherTL },
          { value: "prism", label: t.launcherPrism },
        ]}
      />
      <p className={own.path} title={view.prismFound ?? undefined}>
        {t.prismAt(view.prismFound)}
      </p>
      <div className={styles.row}>
        <Button size="sm" icon={FolderOpen} onClick={choosePrism}>
          {t.prismChoose}
        </Button>
        {view.settings.prismExe && (
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => save({ ...view.settings, prismExe: null })}>
            {t.reset}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Davet sayfasındaki "… seni çağırıyor" adı; yazarken değil, çıkınca (ya da Enter'da) kaydedilir. */
function PlayerNameCard({ view, save }: { view: SettingsView; save: (s: AppSettings) => Promise<void> }) {
  const t = useT().settings;
  const [value, setValue] = useState(view.settings.playerName ?? "");
  useEffect(() => setValue(view.settings.playerName ?? ""), [view.settings.playerName]);
  const commit = () => {
    const name = value.trim() || null;
    if (name !== view.settings.playerName) void save({ ...view.settings, playerName: name });
  };
  return (
    <Card title={t.playerName} description={t.playerNameText}>
      <Input
        className={own.nameInput}
        value={value}
        maxLength={24}
        spellCheck={false}
        placeholder={t.playerNamePlaceholder(view.detectedPlayerName)}
        aria-label={t.playerName}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </Card>
  );
}

/** Uygulama geneli: dil, hesap, Minecraft klasörü ve ekran görüntülerinin kapak olarak kullanılması. */
export function AppSettingsSheet() {
  const open = useAppStore((s) => s.sheet === "settings");
  const openSheet = useAppStore((s) => s.openSheet);
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const setLang = useLang((s) => s.setLang);
  const setMotion = useMotion((s) => s.setSetting);
  const motionOff = useMotion((s) => s.detected === "off");

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
      setMotion(settingFrom(v.settings.animations));
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
            />
          </Card>
          <Card title={t.motion.title} description={motionOff ? t.motion.offNote : t.motion.text}>
            <PillTabs<MotionSetting>
              tabs={[
                { id: "auto", label: t.motion.auto },
                { id: "full", label: t.motion.full },
                { id: "simple", label: t.motion.simple },
              ]}
              active={settingFrom(view.settings.animations)}
              onChange={(c) => save({ ...view.settings, animations: c === "auto" ? null : c })}
            />
          </Card>
          <AccountCard />
          <PlayerNameCard view={view} save={save} />
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

          <LauncherCard view={view} save={save} />
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
          <UpdateCard settings={view.settings} save={save} />
          {error && <p className={styles.error}>{error}</p>}
        </div>
      )}
      {!view && error && <p className={styles.error}>{error}</p>}
    </Sheet>
  );
}
