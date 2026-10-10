import { useEffect, useState } from "react";
import { McButton } from "../../components/McButton";
import { McInput } from "../../components/McInput";
import { McModal } from "../../components/McModal";
import { McSlider } from "../../components/McSlider";
import { api, errorMessage, type Instance, type ServerStatus } from "../../lib/api";
import { formatRam } from "../../lib/format";
import { RAM_MIN, RAM_STEP, ramBounds, ramMinFor } from "../../lib/ram";
import { useAppStore } from "../../store/appStore";
import { JavaSection } from "./JavaSection";
import styles from "./SettingsTab.module.css";

const MAX_NAME_LEN = 48;

type Props = {
  instance: Instance;
  status: ServerStatus;
};

export function SettingsTab({ instance, status }: Props) {
  const replaceInstance = useAppStore((s) => s.replaceInstance);
  const removeInstance = useAppStore((s) => s.removeInstance);
  const navigate = useAppStore((s) => s.navigate);

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
        text: active && ramChanged ? "Kaydedildi. RAM ayarı bir sonraki başlatmada geçerli olur." : "Kaydedildi.",
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
      navigate({ name: "home" });
    } catch (e) {
      setConfirmDelete(false);
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.section}>
        <h3>Genel</h3>
        <label className={styles.label} htmlFor="settings-name">
          Sunucu adı
        </label>
        <McInput
          id="settings-name"
          value={name}
          maxLength={MAX_NAME_LEN}
          onChange={(e) => setName(e.target.value)}
        />
        <span className={styles.label}>RAM</span>
        <McSlider
          label={`Maksimum RAM: ${formatRam(ramMax)}`}
          value={ramMax}
          min={RAM_MIN}
          max={ramLimit}
          step={RAM_STEP}
          onChange={setRamMax}
        />
        <div className={styles.row}>
          <McButton variant="green" disabled={!dirty || !nameValid || saving} onClick={save}>
            Kaydet
          </McButton>
          {notice && <span className={notice.ok ? styles.ok : styles.error}>{notice.text}</span>}
        </div>
      </section>

      <JavaSection instance={instance} />

      <section className={styles.section}>
        <h3>server.properties</h3>
        <p className={styles.dim}>Port, zorluk, oyun modu, whitelist ve TLauncher desteği yakında burada.</p>
      </section>

      <section className={[styles.section, styles.danger].join(" ")}>
        <h3>Tehlikeli Bölge</h3>
        <div className={styles.row}>
          <McButton variant="red" disabled={active} onClick={() => setConfirmDelete(true)}>
            Sunucuyu Sil
          </McButton>
          <span className={styles.dim}>
            {active ? "Silmeden önce sunucuyu durdur." : "Klasör Geri Dönüşüm Kutusu'na taşınır."}
          </span>
        </div>
      </section>

      {confirmDelete && (
        <McModal
          title="Sunucu silinsin mi?"
          actions={
            <>
              <McButton disabled={deleting} onClick={() => setConfirmDelete(false)}>
                Vazgeç
              </McButton>
              <McButton variant="red" disabled={deleting} onClick={remove}>
                {deleting ? "Siliniyor…" : "Sil"}
              </McButton>
            </>
          }
        >
          <p>
            "{instance.name}" ve dünyası dahil tüm dosyaları Geri Dönüşüm Kutusu'na taşınacak. Pişman olursan
            oradan geri alabilirsin.
          </p>
        </McModal>
      )}
    </div>
  );
}
