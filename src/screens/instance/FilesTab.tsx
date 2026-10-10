import { useState } from "react";
import { McButton } from "../../components/McButton";
import { api, errorMessage, type Instance } from "../../lib/api";
import { CONTENT_DIR_LABEL } from "../../lib/format";
import styles from "./TabPage.module.css";

export function FilesTab({ instance }: { instance: Instance }) {
  const [error, setError] = useState<string | null>(null);
  const contentLabel = CONTENT_DIR_LABEL[instance.loader];

  const run = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e) => setError(errorMessage(e)));
  };

  return (
    <div className={styles.page}>
      <p>Dünya, ayar ve log dosyaları sunucu klasöründe.</p>
      <div className={styles.buttons}>
        <McButton onClick={() => run(() => api.openInstanceDir(instance.id))}>Sunucu Klasörünü Aç</McButton>
        {contentLabel && (
          <McButton onClick={() => run(() => api.openContentDir(instance.id))}>
            {contentLabel} Klasörünü Aç
          </McButton>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {contentLabel && (
        <p className={styles.dim}>
          {instance.loader === "fabric"
            ? "Mod .jar dosyalarını mods klasörüne at, sunucuyu yeniden başlat. Oyuna yeni içerik ekleyen modları kardeşinin de kurması gerekir."
            : "Plugin .jar dosyalarını plugins klasörüne at, sunucuyu yeniden başlat."}
        </p>
      )}
    </div>
  );
}
