import { useEffect, useState } from "react";
import { FolderOpen, RotateCcw } from "lucide-react";
import { api, errorMessage, pickFolder, type AppSettings, type SettingsView } from "../../lib/api";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Sheet } from "../../ui/Sheet";
import { Toggle } from "../../ui/Toggle";
import { AccountCard } from "./AccountCard";
import styles from "../instance/sections.module.css";
import own from "./AppSettingsSheet.module.css";

/** Uygulama geneli: Minecraft klasörü ve ekran görüntülerinin kapak olarak kullanılması. */
export function AppSettingsSheet() {
  const open = useAppStore((s) => s.sheet === "settings");
  const openSheet = useAppStore((s) => s.openSheet);
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    api.getSettings().then(setView).catch((e) => setError(errorMessage(e)));
  }, [open]);

  const save = async (settings: AppSettings) => {
    setError(null);
    try {
      setView(await api.updateSettings(settings));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const chooseDir = async () => {
    if (!view) return;
    const dir = await pickFolder("Minecraft oyun klasörü (.minecraft)");
    if (dir) await save({ ...view.settings, minecraftDir: dir });
  };

  return (
    <Sheet open={open} title="Ayarlar" onClose={() => openSheet(null)}>
      {view && (
        <div className={styles.stack}>
          <AccountCard />
          <Card>
            <Toggle
              checked={view.settings.useScreenshots}
              onChange={(useScreenshots) => save({ ...view.settings, useScreenshots })}
              label="Ekran görüntülerimi kapak yap"
              description="Bir dünya açıkken oyunda F2 ile çektiğin görüntü, o dünyanın arka planı olur. Görüntüler bilgisayarından çıkmaz."
            />
          </Card>

          <Card>
            <Toggle
              checked={view.settings.clientSync}
              onChange={(clientSync) => save({ ...view.settings, clientSync })}
              label="Modları kendi Minecraft'ıma da kur"
              description="Modlu dünyalarda oyuncuda gereken ve önerilen modlar, mod altyapısıyla (Fabric, NeoForge, Forge, Quilt) birlikte senin Minecraft'ına da kurulur. Resmi Launcher'da her dünyanın kendi profili olur, böylece modlar karışmaz."
            />
          </Card>

          <Card
            title="Minecraft klasörü"
            description="Ekran görüntüleri buradan okunur. TLauncher başka bir klasör kullanıyorsa değiştir."
          >
            <p className={own.path} title={view.minecraftDir ?? undefined}>
              {view.minecraftDir ?? "Bulunamadı"}
            </p>
            {!view.screenshotsFound && (
              <p className={styles.dim}>Bu klasörde henüz "screenshots" klasörü yok; ilk F2'de oluşur.</p>
            )}
            <div className={styles.row}>
              <Button size="sm" icon={FolderOpen} onClick={chooseDir}>
                Değiştir
              </Button>
              {view.settings.minecraftDir && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  onClick={() => save({ ...view.settings, minecraftDir: null })}
                >
                  Varsayılana dön
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
