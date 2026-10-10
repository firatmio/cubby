import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, errorMessage, type Instance, type ServerStatus } from "../../lib/api";
import { describeInstance, formatRam } from "../../lib/format";
import { RAM_MIN, RAM_STEP, ramBounds, ramMinFor } from "../../lib/ram";
import { useAppStore } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Dialog } from "../../ui/Dialog";
import { Field, Input } from "../../ui/Input";
import { Slider } from "../../ui/Slider";
import styles from "../instance/sections.module.css";

const MAX_NAME_LEN = 48;

/** Gelişmiş > Dünya: isim, bellek, teknik bilgi, silme. */
export function WorldTab({ instance, status }: { instance: Instance; status: ServerStatus }) {
  const replaceInstance = useAppStore((s) => s.replaceInstance);
  const removeInstance = useAppStore((s) => s.removeInstance);

  const [name, setName] = useState(instance.name);
  const [ramMax, setRamMax] = useState(instance.ramMaxMb);
  const [ramLimit, setRamLimit] = useState(Math.max(instance.ramMaxMb, 4096));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const active = status === "starting" || status === "running" || status === "stopping";

  useEffect(() => {
    api
      .systemInfo()
      .then((s) => setRamLimit(Math.max(ramBounds(s.totalMemMb).max, instance.ramMaxMb)))
      .catch(console.error);
  }, [instance.ramMaxMb]);

  const trimmed = name.trim();
  const nameValid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN;
  const dirty = trimmed !== instance.name || ramMax !== instance.ramMaxMb;

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await api.updateInstance(instance.id, {
        name: trimmed,
        ramMinMb: ramMinFor(ramMax),
        ramMaxMb: ramMax,
      });
      replaceInstance(updated);
      const ramChanged = ramMax !== instance.ramMaxMb;
      setNotice({
        ok: true,
        text: active && ramChanged ? "Kaydedildi. Bellek bir sonraki açılışta geçerli olur." : "Kaydedildi",
      });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteInstance(instance.id);
      removeInstance(instance.id);
    } catch (e) {
      setConfirmDelete(false);
      setNotice({ ok: false, text: errorMessage(e) });
      setDeleting(false);
    }
  };

  return (
    <div className={styles.stack}>
      <Card>
        <Field label="Dünyanın adı" htmlFor="world-name">
          <Input id="world-name" value={name} maxLength={MAX_NAME_LEN} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Slider
          label="En fazla bellek"
          valueLabel={formatRam(ramMax)}
          value={ramMax}
          min={RAM_MIN}
          max={ramLimit}
          step={RAM_STEP}
          onChange={setRamMax}
        />
        <div className={styles.row}>
          <Button variant="primary" disabled={!dirty || !nameValid} loading={saving} onClick={save}>
            Kaydet
          </Button>
          {notice && <span className={notice.ok ? styles.ok : styles.error}>{notice.text}</span>}
        </div>
      </Card>

      <Card
        title="Teknik bilgi"
        description={`${describeInstance(instance)} · Java ${instance.javaMajor}+ · port ${instance.port}`}
      />

      <Card
        tone="danger"
        title="Dünyayı sil"
        description={active ? "Silmeden önce dünyayı kapat." : "Tüm dosyalar Geri Dönüşüm Kutusu'na taşınır."}
        actions={
          <Button variant="danger" size="sm" icon={Trash2} disabled={active} onClick={() => setConfirmDelete(true)}>
            Sil
          </Button>
        }
      />

      {confirmDelete && (
        <Dialog
          title="Dünya silinsin mi?"
          actions={
            <>
              <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                Vazgeç
              </Button>
              <Button variant="danger" loading={deleting} onClick={remove}>
                Sil
              </Button>
            </>
          }
        >
          <p>
            "{instance.name}" ve bütün dosyaları Geri Dönüşüm Kutusu'na taşınacak. Pişman olursan oradan geri
            alabilirsin.
          </p>
        </Dialog>
      )}
    </div>
  );
}
