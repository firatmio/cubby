import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api, errorMessage, type Instance, type InstanceJava, type JavaInfo } from "../../lib/api";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { SelectList } from "../../ui/SelectList";
import { JavaDownloadProgress } from "./JavaDownloadProgress";
import styles from "./sections.module.css";

type Busy = "scan" | "install" | "save" | null;

const AUTO = "__auto__";

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

  const choose = (key: string) =>
    run("save", async () => {
      replaceInstance(await api.setInstanceJava(instance.id, key === AUTO ? null : key));
      await load(false);
    });

  const download = () =>
    run("install", async () => {
      setJavaProgress(null);
      await api.installJava(info!.required);
      await load(false);
    });

  if (!info || !list) {
    return <Card title="Java" description={error ?? "Java'lar aranıyor…"} />;
  }

  const hasExact = list.some((j) => j.major === info.required);
  const selected = info.selected;

  return (
    <Card
      title="Java"
      description={
        <>
          Bu sürüm Java {info.required}+ istiyor.{" "}
          {selected ? `Başlatınca ${javaLabel(selected)} kullanılacak.` : "Uygun Java bulunamadı, indirmen gerekiyor."}
        </>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            loading={busy === "scan"}
            disabled={busy !== null}
            onClick={() => run("scan", () => load(true))}
          >
            Yeniden tara
          </Button>
          {!hasExact && (
            <Button size="sm" icon={Download} disabled={busy !== null} onClick={download}>
              Java {info.required} indir
            </Button>
          )}
        </>
      }
    >
      {info.error && <p className={styles.error}>{info.error}</p>}
      <SelectList
        maxHeight={220}
        value={info.pinned ?? AUTO}
        onSelect={(key) => busy === null && choose(key)}
        items={[
          { key: AUTO, label: "Otomatik", meta: "her açılışta en uygununu seç" },
          ...list.map((j) => {
            const tooOld = j.major < info.required;
            return {
              key: j.path,
              title: j.path,
              disabled: tooOld,
              label: javaLabel(j),
              badges: tooOld ? <Badge tone="neutral">Eski</Badge> : undefined,
              meta: j.path,
            };
          }),
        ]}
      />
      {busy === "install" && <JavaDownloadProgress />}
      {error && <p className={styles.error}>{error}</p>}
    </Card>
  );
}
