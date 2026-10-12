import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "../../i18n";
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
  const t = useT();

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
        text: active && ramChanged ? t.advanced.savedRamLater : t.advanced.saved,
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
        <Field label={t.advanced.worldName} htmlFor="world-name">
          <Input id="world-name" value={name} maxLength={MAX_NAME_LEN} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Slider
          label={t.advanced.maxRam}
          valueLabel={formatRam(ramMax)}
          value={ramMax}
          min={RAM_MIN}
          max={ramLimit}
          step={RAM_STEP}
          onChange={setRamMax}
        />
        <div className={styles.row}>
          <Button variant="primary" disabled={!dirty || !nameValid} loading={saving} onClick={save}>
            {t.common.save}
          </Button>
          {notice && <span className={notice.ok ? styles.ok : styles.error}>{notice.text}</span>}
        </div>
      </Card>

      <Card
        title={t.advanced.techInfo}
        description={`${describeInstance(instance)} · Java ${instance.javaMajor}+ · port ${instance.port}`}
      />

      <Card
        tone="danger"
        title={t.advanced.deleteWorld}
        description={active ? t.advanced.stopBeforeDelete : t.advanced.deleteText}
        actions={
          <Button variant="danger" size="sm" icon={Trash2} disabled={active} onClick={() => setConfirmDelete(true)}>
            {t.advanced.delete}
          </Button>
        }
      />

      {confirmDelete && (
        <Dialog
          title={t.advanced.deleteConfirm}
          actions={
            <>
              <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" loading={deleting} onClick={remove}>
                {t.advanced.delete}
              </Button>
            </>
          }
        >
          <p>{t.advanced.deleteBody(instance.name)}</p>
        </Dialog>
      )}
    </div>
  );
}
