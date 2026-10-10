import { useCallback, useEffect, useState } from "react";
import { McButton } from "../../components/McButton";
import { api, errorMessage, type Instance, type InstanceJava, type JavaInfo } from "../../lib/api";
import { useAppStore } from "../../store/appStore";
import { JavaDownloadProgress } from "./JavaDownloadProgress";
import styles from "./SettingsTab.module.css";

type Busy = "scan" | "install" | "save" | null;

function javaLabel(j: JavaInfo): string {
  return `Java ${j.major}${j.managed ? " (uygulamanın indirdiği)" : ""}`;
}

/** Ayarlar sekmesi: sunucunun hangi Java ile açılacağı. */
export function JavaSection({ instance }: { instance: Instance }) {
  const replaceInstance = useAppStore((s) => s.replaceInstance);
  const setJavaProgress = useAppStore((s) => s.setJavaProgress);

  const [info, setInfo] = useState<InstanceJava | null>(null);
  const [list, setList] = useState<JavaInfo[] | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      const [i, l] = await Promise.all([api.instanceJava(instance.id), api.listJava(refresh)]);
      setInfo(i);
      setList(l);
    },
    [instance.id],
  );

  useEffect(() => {
    load(false).catch((e) => setError(errorMessage(e)));
  }, [load, instance.javaPath]);

  const run = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const choose = (path: string | null) =>
    run("save", async () => {
      replaceInstance(await api.setInstanceJava(instance.id, path));
      await load(false);
    });

  const download = () =>
    run("install", async () => {
      setJavaProgress(null);
      await api.installJava(info!.required);
      await load(false);
    });

  if (!info || !list) {
    return (
      <section className={styles.section}>
        <h3>Java</h3>
        <p className={styles.dim}>{error ?? "Java'lar aranıyor…"}</p>
      </section>
    );
  }

  const hasExact = list.some((j) => j.major === info.required);
  const selected = info.selected;

  return (
    <section className={styles.section}>
      <h3>Java</h3>
      <p className={styles.dim}>
        Bu sürüm Java {info.required}+ istiyor.{" "}
        {selected ? `Başlatınca ${javaLabel(selected)} kullanılacak.` : "Uygun Java bulunamadı, indirmen gerekiyor."}
      </p>
      {info.error && <p className={styles.error}>{info.error}</p>}

      <div className={styles.choiceList}>
        <button
          type="button"
          className={[styles.choiceRow, info.pinned === null && styles.selected].filter(Boolean).join(" ")}
          disabled={busy !== null}
          onClick={() => choose(null)}
        >
          <span>Otomatik</span>
          <span className={styles.rowNote}>en uygun olanı her açılışta seç</span>
        </button>
        {list.map((j) => {
          const tooOld = j.major < info.required;
          return (
            <button
              key={j.path}
              type="button"
              title={j.path}
              className={[styles.choiceRow, info.pinned === j.path && styles.selected].filter(Boolean).join(" ")}
              disabled={busy !== null || tooOld}
              onClick={() => choose(j.path)}
            >
              <span>{javaLabel(j)}</span>
              <span className={styles.rowNote}>{tooOld ? "bu sürüm için eski" : j.path}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.row}>
        <McButton disabled={busy !== null} onClick={() => run("scan", () => load(true))}>
          {busy === "scan" ? "Taranıyor…" : "Yeniden Tara"}
        </McButton>
        {!hasExact && (
          <McButton disabled={busy !== null} onClick={download}>
            Java {info.required} İndir
          </McButton>
        )}
      </div>
      {busy === "install" && <JavaDownloadProgress />}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
