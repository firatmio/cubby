import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, ImagePlus, Loader2, Sparkles } from "lucide-react";
import { useT } from "../../i18n";
import { api, errorMessage, mediaUrl, pickImage, type CoverSource, type Shot, type ShotList } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { rise, stagger } from "../../lib/motion";
import { useAppStore, useSelected } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import styles from "./CoverSheet.module.css";

function ShotGrid({
  shots,
  busy,
  onPick,
}: {
  shots: Shot[];
  busy: string | null;
  onPick: (file: string) => void;
}) {
  return (
    <motion.div className={styles.grid} variants={stagger} initial="hidden" animate="show">
      {shots.map((s) => (
        <motion.button
          key={s.file}
          type="button"
          className={styles.shot}
          variants={rise}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          disabled={busy !== null}
          title={relativeTime(s.takenAt)}
          onClick={() => onPick(s.file)}
        >
          <img src={mediaUrl(`shot/${s.file}`)} alt="" loading="lazy" draggable={false} />
          {busy === s.file && (
            <span className={styles.busy}>
              <Loader2 size={22} className={styles.spin} aria-hidden />
            </span>
          )}
          <span className={styles.when}>{relativeTime(s.takenAt)}</span>
        </motion.button>
      ))}
    </motion.div>
  );
}

/** Dünyanın arka planı: bu dünyada çekilen ekran görüntüleri, diğerleri ya da bilgisayardan bir resim. */
export function CoverSheet() {
  const open = useAppStore((s) => s.sheet === "cover");
  const openSheet = useAppStore((s) => s.openSheet);
  const replaceInstance = useAppStore((s) => s.replaceInstance);
  const instance = useSelected();

  const [list, setList] = useState<ShotList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const load = useCallback(() => {
    if (!instance) return;
    setList(null);
    setError(null);
    api
      .listScreenshots(instance.id)
      .then(setList)
      .catch((e) => setError(errorMessage(e)));
  }, [instance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const apply = async (key: string, source: CoverSource) => {
    if (!instance) return;
    setBusy(key);
    setError(null);
    try {
      replaceInstance(await api.setCover(instance.id, source));
      openSheet(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const fromComputer = async () => {
    const path = await pickImage(t.cover.pickTitle);
    if (path) await apply("file", { type: "file", path });
  };

  const isAuto = instance?.cover?.kind !== "manual";

  return (
    <Sheet
      open={open && !!instance}
      title={t.cover.title}
      subtitle={t.cover.subtitle}
      onClose={() => openSheet(null)}
      width={620}
    >
      <div className={styles.actions}>
        <Button icon={ImagePlus} loading={busy === "file"} disabled={busy !== null} onClick={fromComputer}>
          {t.cover.fromComputer}
        </Button>
        <Button
          variant={isAuto ? "secondary" : "ghost"}
          icon={isAuto ? Check : Sparkles}
          loading={busy === "auto"}
          disabled={busy !== null}
          onClick={() => apply("auto", { type: "auto" })}
        >
          {isAuto ? t.cover.autoOn : t.cover.backToAuto}
        </Button>
      </div>
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.scroll}>
        {!list && !error && <p className={styles.dim}>{t.cover.searching}</p>}
        {list && (
          <>
            <h3 className={styles.section}>{t.cover.thisWorld}</h3>
            {list.matched.length > 0 ? (
              <ShotGrid
                shots={list.matched}
                busy={busy}
                onPick={(file) => apply(file, { type: "screenshot", file })}
              />
            ) : (
              <p className={styles.dim}>{t.cover.noneYet}</p>
            )}
            {list.others.length > 0 && (
              <>
                <h3 className={styles.section}>{t.cover.others}</h3>
                <ShotGrid
                  shots={list.others}
                  busy={busy}
                  onPick={(file) => apply(file, { type: "screenshot", file })}
                />
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
