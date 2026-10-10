import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { api, errorMessage, type Instance, type ServerStatus } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import styles from "./PropertiesTab.module.css";

/** Bunlar Oyuncular / Dünya ayarları üzerinden değişir (UUID ve beyaz liste tutarlılığı için). */
const MANAGED = new Set(["online-mode", "white-list", "enforce-whitelist"]);

/** Gelişmiş > Tüm ayarlar: `server.properties`'in tamamı, aranabilir. */
export function PropertiesTab({ instance, status }: { instance: Instance; status: ServerStatus }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [exists, setExists] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getProperties(instance.id)
      .then((p) => {
        setValues(p.values);
        setExists(p.exists);
      })
      .catch((e) => setMessage({ ok: false, text: errorMessage(e) }));
  }, [instance.id]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(values ?? {}).filter(([k, v]) => !q || k.includes(q) || v.toLowerCase().includes(q));
  }, [values, query]);

  const dirty = Object.keys(edits).length > 0;
  const active = status === "starting" || status === "running" || status === "stopping";

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const p = await api.updateProperties(instance.id, edits);
      setValues(p.values);
      setEdits({});
      setMessage({ ok: true, text: active ? "Kaydedildi. Dünya yeniden açılınca geçerli olur." : "Kaydedildi" });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!values) return <p className={styles.hint}>{message?.text ?? "Yükleniyor…"}</p>;

  return (
    <div className={styles.wrap}>
      {!exists && (
        <p className={styles.hint}>Dünya henüz hiç açılmadı; kalan ayarlar ilk açılışta oluşacak.</p>
      )}
      <div className={styles.search}>
        <Search size={16} aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ayar ara" spellCheck={false} />
      </div>
      <div className={styles.table}>
        {rows.map(([key, value]) => {
          const managed = MANAGED.has(key);
          const current = edits[key] ?? value;
          return (
            <label key={key} className={styles.row} title={managed ? "Oyuncular panelinden değiştirilir" : undefined}>
              <span className={styles.key}>{key}</span>
              <input
                className={[styles.value, key in edits && styles.edited].filter(Boolean).join(" ")}
                value={current}
                disabled={managed}
                spellCheck={false}
                onChange={(e) =>
                  setEdits((ed) => {
                    const next = { ...ed, [key]: e.target.value };
                    if (e.target.value === value) delete next[key];
                    return next;
                  })
                }
              />
            </label>
          );
        })}
      </div>
      <div className={styles.footer}>
        {message && <span className={message.ok ? styles.ok : styles.error}>{message.text}</span>}
        <Button variant="primary" size="sm" disabled={!dirty} loading={saving} onClick={save}>
          Kaydet
        </Button>
      </div>
    </div>
  );
}
