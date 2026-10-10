import { useState } from "react";
import { McButton } from "../../components/McButton";
import { api, errorMessage } from "../../lib/api";
import styles from "./TabPage.module.css";

export function FilesTab({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    api.openInstanceDir(id).catch((e) => setError(errorMessage(e)));
  };

  return (
    <div className={styles.page}>
      <p>Dünya, ayar ve log dosyaları sunucu klasöründe.</p>
      <McButton onClick={open}>Sunucu Klasörünü Aç</McButton>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.dim}>Mod / plugin klasörü butonu Fabric ve Paper desteğiyle gelecek.</p>
    </div>
  );
}
