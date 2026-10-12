import { useState } from "react";
import { FolderOpen, Package } from "lucide-react";
import { useT } from "../../i18n";
import { api, errorMessage, type Instance } from "../../lib/api";
import { CONTENT_DIR_LABEL } from "../../lib/format";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import styles from "./sections.module.css";

export function FilesTab({ instance }: { instance: Instance }) {
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  const contentLabel = CONTENT_DIR_LABEL[instance.loader];

  const run = (fn: () => Promise<void>) => {
    setError(null);
    fn().catch((e) => setError(errorMessage(e)));
  };

  return (
    <div className={styles.stack}>
      <Card
        title={t.instance.serverFolder}
        description={t.instance.serverFolderText}
        actions={
          <Button icon={FolderOpen} onClick={() => run(() => api.openInstanceDir(instance.id))}>
            {t.instance.open}
          </Button>
        }
      />
      {contentLabel && (
        <Card
          title={t.instance.contentFolder(contentLabel)}
          description={
            instance.loader === "paper" ? t.instance.pluginsFolderText : t.instance.modsFolderText
          }
          actions={
            <Button icon={Package} onClick={() => run(() => api.openContentDir(instance.id))}>
              {t.instance.open}
            </Button>
          }
        />
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
