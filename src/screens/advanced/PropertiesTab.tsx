import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import { useT } from "../../i18n";
import { api, errorMessage, type Instance, type ServerStatus } from "../../lib/api";
import { Button } from "../../ui/Button";
import { HelpTip } from "../../ui/HelpTip";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import { useScrollFade } from "../../ui/useScrollFade";
import { GROUPS, specOf, validNumber, type Group, type Kind } from "./propertySchema";
import styles from "./PropertiesTab.module.css";

/** Bunlar Oyuncular / Dünya ayarları üzerinden değişir (UUID ve beyaz liste tutarlılığı için). */
const MANAGED = new Set(["online-mode", "white-list", "enforce-whitelist"]);

type Texts = { label: string; help: string };

/**
 * Gelişmiş > Tüm ayarlar: `server.properties`'in tamamı, gruplu ve oyuncunun dilinde. Her ayarın
 * yanında ne işe yaradığını anlatan ipucu; açık/kapalı ayarlar anahtar, seçmeli olanlar liste,
 * sayılar birimli kutu. Tanınmayan ayarlar "Diğer"de düz metin.
 */
export function PropertiesTab({ instance, status }: { instance: Instance; status: ServerStatus }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [exists, setExists] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fade = useScrollFade();
  const t = useT();
  const p = t.props;
  const keyTexts = p.keys as Record<string, Texts | undefined>;
  const optionTexts = p.options as Record<string, Record<string, string> | undefined>;

  useEffect(() => {
    api
      .getProperties(instance.id)
      .then((r) => {
        setValues(r.values);
        setExists(r.exists);
      })
      .catch((e) => setMessage({ ok: false, text: errorMessage(e) }));
  }, [instance.id]);

  const textsOf = (key: string): Texts => keyTexts[key] ?? { label: key, help: p.otherHelp };

  /** Gruplara ayrılmış, aramaya uyan satırlar; grup içinde şemadaki (anlamlı) sıra. */
  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const order = Object.keys(keyTexts);
    const byGroup = new Map<Group, string[]>();
    for (const [key, value] of Object.entries(values ?? {})) {
      const { label, help } = keyTexts[key] ?? { label: key, help: "" };
      const hay = `${key} ${label} ${help} ${value}`.toLocaleLowerCase();
      if (q && !hay.includes(q)) continue;
      const g = specOf(key).group;
      byGroup.set(g, [...(byGroup.get(g) ?? []), key]);
    }
    const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
    return GROUPS.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      keys: byGroup.get(g)!.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    }));
  }, [values, query, keyTexts]);

  const edit = (key: string, next: string) =>
    setEdits((ed) => {
      const out = { ...ed, [key]: next };
      if (values && next === values[key]) delete out[key];
      return out;
    });

  /** Geçersiz sayı varsa hata metni. */
  const problem = (key: string, value: string): string | null => {
    const kind = specOf(key).kind;
    if (kind.type !== "number" || validNumber(value, kind)) return null;
    if (!/^-?\d+$/.test(value.trim())) return p.invalidNumber;
    return p.invalidRange(kind.min ?? -Infinity, kind.max ?? Infinity);
  };

  const dirty = Object.keys(edits).length > 0;
  const invalid = Object.entries(edits).some(([k, v]) => problem(k, v) !== null);
  const active = status === "starting" || status === "running" || status === "stopping";

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await api.updateProperties(instance.id, edits);
      setValues(r.values);
      setEdits({});
      setMessage({ ok: true, text: active ? t.advanced.savedRestart : t.advanced.saved });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!values) return <p className={styles.hint}>{message?.text ?? t.advanced.loading}</p>;

  const control = (key: string, kind: Kind, value: string, label: string, managed: boolean) => {
    switch (kind.type) {
      case "bool":
        return <Switch checked={value === "true"} onChange={(v) => edit(key, String(v))} label={label} disabled={managed} />;
      case "enum": {
        const names = optionTexts[key] ?? {};
        const options = kind.options.map((o) => ({ value: o, label: names[o] ?? o }));
        // Bilinmeyen bir değer (ör. modlu dünya tipi) kaybolmasın.
        if (!kind.options.includes(value)) options.push({ value, label: value });
        return (
          <Select
            className={styles.select}
            value={value}
            options={options}
            onChange={(v) => edit(key, v)}
            disabled={managed}
            aria-label={label}
          />
        );
      }
      case "number":
        return (
          <span className={styles.number}>
            <input
              className={[styles.value, styles.mono, problem(key, value) && styles.invalid].filter(Boolean).join(" ")}
              value={value}
              inputMode="numeric"
              spellCheck={false}
              disabled={managed}
              aria-label={label}
              onChange={(e) => edit(key, e.target.value)}
            />
            {/* Birimsiz sayılarda da yer ayrılır: kutuların sağ kenarı hizalı kalsın. */}
            <span className={styles.unit}>{kind.unit ? p.units[kind.unit] : ""}</span>
          </span>
        );
      case "text": {
        const hidden = kind.secret && !revealed.has(key);
        return (
          <span className={styles.number}>
            <input
              className={[styles.value, kind.mono && styles.mono].filter(Boolean).join(" ")}
              value={value}
              type={hidden ? "password" : "text"}
              spellCheck={false}
              disabled={managed}
              aria-label={label}
              onChange={(e) => edit(key, e.target.value)}
            />
            {kind.secret && (
              <IconButton
                icon={hidden ? Eye : EyeOff}
                size="sm"
                variant="ghost"
                label={hidden ? p.showSecret : p.hideSecret}
                onClick={() =>
                  setRevealed((s) => {
                    const next = new Set(s);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
            )}
          </span>
        );
      }
    }
  };

  return (
    <div className={styles.wrap}>
      {!exists && <p className={styles.hint}>{t.advanced.notCreatedYet}</p>}
      <div className={styles.search}>
        <Search size={16} aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.advanced.searchSetting} spellCheck={false} />
      </div>
      <div ref={fade} className={styles.table}>
        {groups.length === 0 && <p className={styles.empty}>{p.noResults}</p>}
        {groups.map(({ group, keys }) => (
          <section key={group} className={styles.group}>
            <h4 className={styles.groupTitle}>{p.groups[group]}</h4>
            {keys.map((key) => {
              const { label, help } = textsOf(key);
              const managed = MANAGED.has(key);
              const value = edits[key] ?? values[key];
              const err = key in edits ? problem(key, value) : null;
              return (
                <div key={key} className={[styles.row, key in edits && styles.edited].filter(Boolean).join(" ")}>
                  <div className={styles.labelCol}>
                    <span className={styles.labelLine}>
                      <span className={styles.label}>{label}</span>
                      <HelpTip text={help} label={`${label}: ${help}`} />
                    </span>
                    <span className={styles.key}>{managed ? `${key} · ${t.advanced.managedHint}` : key}</span>
                  </div>
                  <div className={styles.control}>
                    {control(key, specOf(key).kind, value, label, managed)}
                    {err && <span className={styles.problem}>{err}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className={styles.footer}>
        {message && <span className={message.ok ? styles.ok : styles.error}>{message.text}</span>}
        {dirty && !message && <span className={styles.unsaved}>{p.unsaved}</span>}
        <Button variant="primary" size="sm" disabled={!dirty || invalid} loading={saving} onClick={save}>
          {t.common.save}
        </Button>
      </div>
    </div>
  );
}
