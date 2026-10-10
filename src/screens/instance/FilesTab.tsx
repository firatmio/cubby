import { useState } from "react";
import { FolderOpen, Package } from "lucide-react";
import { api, errorMessage, type Instance } from "../../lib/api";
import { CONTENT_DIR_LABEL } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
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
      <Card
        title="Sunucu klasörü"
        description="Dünya, ayar ve kayıt (log) dosyaları burada."
        actions={
          <Button icon={FolderOpen} onClick={() => run(() => api.openInstanceDir(instance.id))}>
            Aç
          </Button>
        }
      />
      {contentLabel && (
        <Card
          title={`${contentLabel} klasörü`}
          description={
            instance.loader === "fabric"
              ? "Mod .jar dosyalarını buraya at, sunucuyu yeniden başlat. Oyuna yeni içerik ekleyen modları kardeşinin de kurması gerekir."
              : "Plugin .jar dosyalarını buraya at, sunucuyu yeniden başlat."
          }
          actions={
            <Button icon={Package} onClick={() => run(() => api.openContentDir(instance.id))}>
              Aç
            </Button>
          }
        />
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
