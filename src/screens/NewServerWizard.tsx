import { useCallback, useEffect, useMemo, useState } from "react";
import { McButton } from "../components/McButton";
import { McInput } from "../components/McInput";
import { McPanel } from "../components/McPanel";
import { McProgress } from "../components/McProgress";
import { McSlider } from "../components/McSlider";
import {
  api,
  errorMessage,
  type GameVersionList,
  type Instance,
  type LoaderKind,
  type SystemInfo,
} from "../lib/api";
import { LOADER_LABELS, formatBytesMb, formatDate, formatRam } from "../lib/format";
import { useAppStore } from "../store/appStore";
import styles from "./NewServerWizard.module.css";

type Step = "loader" | "version" | "ram" | "name" | "install";

const STEPS: { id: Step; label: string }[] = [
  { id: "loader", label: "Tür" },
  { id: "version", label: "Sürüm" },
  { id: "ram", label: "RAM" },
  { id: "name", label: "İsim" },
  { id: "install", label: "Kurulum" },
];

/** M1'de yalnız Vanilla; diğerleri sonraki milestone'larda açılır. */
const LOADER_OPTIONS: { id: string; label: string; enabled: boolean; note: string }[] = [
  { id: "vanilla", label: "Vanilla", enabled: true, note: "Saf Minecraft" },
  { id: "fabric", label: "Fabric", enabled: false, note: "Yakında" },
  { id: "paper", label: "Paper", enabled: false, note: "Yakında" },
  { id: "neoforge", label: "NeoForge", enabled: false, note: "Yakında" },
  { id: "forge", label: "Forge", enabled: false, note: "Yakında" },
  { id: "quilt", label: "Quilt", enabled: false, note: "Yakında" },
];

const RAM_STEP = 512;
const RAM_MIN = 1024;
const RAM_CAP = 16384;
/** İşletim sistemi ve oyunun kendisi için bırakılan pay. */
const RAM_RESERVE = 2048;
const MAX_NAME_LEN = 48;

function ramBounds(totalMb: number) {
  const max = Math.max(RAM_MIN, Math.min(RAM_CAP, Math.floor((totalMb - RAM_RESERVE) / RAM_STEP) * RAM_STEP));
  const preferred = totalMb >= 12288 ? 4096 : totalMb >= 8192 ? 3072 : 2048;
  return { max, initial: Math.min(preferred, max) };
}

export function NewServerWizard() {
  const navigate = useAppStore((s) => s.navigate);
  const addInstance = useAppStore((s) => s.addInstance);
  const progress = useAppStore((s) => s.installProgress);
  const setInstallProgress = useAppStore((s) => s.setInstallProgress);

  const [step, setStep] = useState<Step>("loader");
  const [loader, setLoader] = useState<LoaderKind>("vanilla");

  const [includeSnapshots, setIncludeSnapshots] = useState(false);
  const [versions, setVersions] = useState<GameVersionList | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [ramMax, setRamMax] = useState(2048);

  const [name, setName] = useState("");

  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [created, setCreated] = useState<Instance | null>(null);

  useEffect(() => {
    api
      .systemInfo()
      .then((s) => {
        setSys(s);
        setRamMax(ramBounds(s.totalMemMb).initial);
      })
      .catch(console.error);
  }, []);

  const loadVersions = useCallback(() => {
    setVersionsError(null);
    setVersions(null);
    api
      .listMcVersions(includeSnapshots)
      .then((list) => {
        setVersions(list);
        setVersion((v) => v ?? list.latestRelease);
      })
      .catch((e) => setVersionsError(errorMessage(e)));
  }, [includeSnapshots]);

  useEffect(loadVersions, [loadVersions]);

  const shownVersions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (versions?.versions ?? []).filter((v) => !q || v.id.toLowerCase().includes(q));
  }, [versions, search]);

  const bounds = ramBounds(sys?.totalMemMb ?? 4096);
  const ramMin = Math.min(RAM_MIN, ramMax);
  const defaultName = `${LOADER_LABELS[loader]} ${version ?? ""}`.trim();

  const install = () => {
    if (!version) return;
    setStep("install");
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    api
      .createInstance({
        name: name.trim() || defaultName,
        mcVersion: version,
        ramMinMb: ramMin,
        ramMaxMb: ramMax,
      })
      .then((inst) => {
        addInstance(inst);
        setCreated(inst);
      })
      .catch((e) => setInstallError(errorMessage(e)))
      .finally(() => setInstalling(false));
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const goBack = () => setStep(STEPS[Math.max(0, stepIndex - 1)].id);
  const goNext = () => {
    if (step === "ram" && !name) setName(defaultName);
    if (step === "name") install();
    else setStep(STEPS[stepIndex + 1].id);
  };
  const canNext =
    (step === "loader") ||
    (step === "version" && version !== null) ||
    step === "ram" ||
    (step === "name" && name.trim().length > 0 && name.trim().length <= MAX_NAME_LEN);

  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Yeni Sunucu</h2>

      <ol className={styles.steps}>
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className={[i === stepIndex && styles.current, i < stepIndex && styles.done].filter(Boolean).join(" ")}
          >
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>

      <McPanel variant="dark" className={styles.body}>
        {step === "loader" && (
          <div className={styles.loaderGrid}>
            {LOADER_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={!o.enabled}
                className={[styles.choice, loader === o.id && styles.selected].filter(Boolean).join(" ")}
                onClick={() => setLoader(o.id as LoaderKind)}
              >
                <span>{o.label}</span>
                <span className={styles.choiceNote}>{o.note}</span>
              </button>
            ))}
          </div>
        )}

        {step === "version" && (
          <div className={styles.versionStep}>
            <div className={styles.row}>
              <McInput
                placeholder="Sürüm ara…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                spellCheck={false}
              />
              <McButton onClick={() => setIncludeSnapshots((v) => !v)}>
                Snapshot: {includeSnapshots ? "AÇIK" : "KAPALI"}
              </McButton>
            </div>
            <div className={styles.versionList}>
              {versionsError ? (
                <div className={styles.center}>
                  <p className={styles.error}>{versionsError}</p>
                  <McButton onClick={loadVersions}>Tekrar Dene</McButton>
                </div>
              ) : !versions ? (
                <div className={styles.center}>
                  <p>Sürümler yükleniyor…</p>
                  <McProgress value={null} />
                </div>
              ) : (
                shownVersions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={[styles.versionRow, version === v.id && styles.selected].filter(Boolean).join(" ")}
                    onClick={() => setVersion(v.id)}
                  >
                    <span>{v.id}</span>
                    {v.id === versions.latestRelease && <span className={styles.badgeGreen}>en yeni</span>}
                    {v.type === "snapshot" && <span className={styles.badgeGold}>snapshot</span>}
                    <span className={styles.date}>{formatDate(v.releaseTime)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {step === "ram" && (
          <div className={styles.form}>
            <McSlider
              label={`Maksimum RAM: ${formatRam(ramMax)}`}
              value={ramMax}
              min={RAM_MIN}
              max={bounds.max}
              step={RAM_STEP}
              onChange={setRamMax}
            />
            <p className={styles.hint}>
              Bilgisayarında toplam {sys ? formatRam(Math.round(sys.totalMemMb / 1024) * 1024) : "?"} RAM var.
              Oyunu da aynı bilgisayarda açacaksan çok yüksek seçme. 2–4 GB iki kişi için fazlasıyla yeter.
            </p>
            <p className={styles.hint}>Başlangıç RAM'i: {formatRam(ramMin)}</p>
          </div>
        )}

        {step === "name" && (
          <div className={styles.form}>
            <label className={styles.label} htmlFor="server-name">
              Sunucu adı
            </label>
            <McInput
              id="server-name"
              value={name}
              maxLength={MAX_NAME_LEN}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canNext && goNext()}
              autoFocus
            />
            <dl className={styles.summary}>
              <dt>Tür</dt>
              <dd>{LOADER_LABELS[loader]}</dd>
              <dt>Sürüm</dt>
              <dd>{version}</dd>
              <dt>RAM</dt>
              <dd>
                {formatRam(ramMin)} – {formatRam(ramMax)}
              </dd>
              <dt>Java</dt>
              <dd>{sys?.java ? `Java ${sys.java.major}` : <span className={styles.warn}>Bulunamadı</span>}</dd>
            </dl>
          </div>
        )}

        {step === "install" && (
          <div className={styles.form}>
            {installError ? (
              <>
                <p className={styles.error}>Kurulum başarısız: {installError}</p>
                <div className={styles.row}>
                  <McButton onClick={() => setStep("name")}>Geri</McButton>
                  <McButton variant="green" onClick={install}>
                    Tekrar Dene
                  </McButton>
                </div>
              </>
            ) : created ? (
              <>
                <McProgress value={1} />
                <p className={styles.success}>Kurulum tamam! "{created.name}" hazır.</p>
                <McButton
                  variant="green"
                  size="lg"
                  onClick={() => navigate({ name: "instance", id: created.id })}
                >
                  Sunucuya Git
                </McButton>
              </>
            ) : (
              <>
                <McProgress
                  value={progress?.stage === "download" && progress.total ? progress.downloaded / progress.total : null}
                />
                <p>
                  {progress?.stage === "download"
                    ? `Sunucu dosyası indiriliyor… ${formatBytesMb(progress.downloaded)}${
                        progress.total ? ` / ${formatBytesMb(progress.total)}` : ""
                      } MB`
                    : "Sürüm bilgisi alınıyor…"}
                </p>
              </>
            )}
          </div>
        )}
      </McPanel>

      <div className={styles.nav}>
        <McButton disabled={installing} onClick={() => navigate({ name: "home" })}>
          {created ? "Ana Sayfa" : "İptal"}
        </McButton>
        {step !== "install" && (
          <>
            <McButton disabled={stepIndex === 0} onClick={goBack}>
              Geri
            </McButton>
            <McButton variant={step === "name" ? "green" : "default"} disabled={!canNext} onClick={goNext}>
              {step === "name" ? "Kur" : "İleri"}
            </McButton>
          </>
        )}
      </div>
    </div>
  );
}
