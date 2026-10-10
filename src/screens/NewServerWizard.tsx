import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { McButton } from "../components/McButton";
import { McInput } from "../components/McInput";
import { McPanel } from "../components/McPanel";
import { McProgress } from "../components/McProgress";
import { McSlider } from "../components/McSlider";
import {
  api,
  errorMessage,
  type GameVersionList,
  type InstallProgress,
  type Instance,
  type LoaderKind,
  type LoaderVersionList,
  type SystemInfo,
} from "../lib/api";
import { LOADER_LABELS, formatBytesMb, formatDate, formatRam } from "../lib/format";
import { RAM_MIN, RAM_STEP, ramBounds, ramMinFor } from "../lib/ram";
import { useAppStore } from "../store/appStore";
import styles from "./NewServerWizard.module.css";

type Step = "loader" | "version" | "loaderVersion" | "ram" | "name" | "install";

const ALL_STEPS: { id: Step; label: string }[] = [
  { id: "loader", label: "Tür" },
  { id: "version", label: "Sürüm" },
  { id: "loaderVersion", label: "Loader" },
  { id: "ram", label: "RAM" },
  { id: "name", label: "İsim" },
  { id: "install", label: "Kurulum" },
];

const LOADER_OPTIONS: { id: string; label: string; enabled: boolean; note: string }[] = [
  { id: "fabric", label: "Fabric", enabled: true, note: "Mod desteği" },
  { id: "paper", label: "Paper", enabled: true, note: "Plugin, performans" },
  { id: "vanilla", label: "Vanilla", enabled: true, note: "Saf Minecraft" },
  { id: "neoforge", label: "NeoForge", enabled: false, note: "Yakında" },
  { id: "forge", label: "Forge", enabled: false, note: "Yakında" },
  { id: "quilt", label: "Quilt", enabled: false, note: "Yakında" },
];

const DOWNLOAD_LABELS: Record<NonNullable<InstallProgress["file"]>, string> = {
  server: "Minecraft sunucusu indiriliyor",
  fabric: "Fabric başlatıcısı indiriliyor",
  paper: "Paper indiriliyor",
};

const MAX_NAME_LEN = 48;

function progressText(p: InstallProgress | null): string {
  if (p?.stage !== "download" || !p.file) return "Sürüm bilgisi alınıyor…";
  const total = p.total ? ` / ${formatBytesMb(p.total)}` : "";
  return `${DOWNLOAD_LABELS[p.file]}… ${formatBytesMb(p.downloaded)}${total} MB`;
}

export function NewServerWizard() {
  const navigate = useAppStore((s) => s.navigate);
  const addInstance = useAppStore((s) => s.addInstance);
  const progress = useAppStore((s) => s.installProgress);
  const setInstallProgress = useAppStore((s) => s.setInstallProgress);

  const [step, setStep] = useState<Step>("loader");
  const [loader, setLoader] = useState<LoaderKind>("fabric");

  const [includeSnapshots, setIncludeSnapshots] = useState(false);
  const [versions, setVersions] = useState<GameVersionList | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionList | null>(null);
  const [loaderVersionsError, setLoaderVersionsError] = useState<string | null>(null);
  const [loaderVersion, setLoaderVersion] = useState<string | null>(null);

  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [ramMax, setRamMax] = useState(2048);

  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);

  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [created, setCreated] = useState<Instance | null>(null);

  const steps = useMemo(
    () => ALL_STEPS.filter((s) => s.id !== "loaderVersion" || loader !== "vanilla"),
    [loader],
  );

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
      .listGameVersions(loader, includeSnapshots)
      .then((list) => {
        setVersions(list);
        // Seçili sürüm bu türde yoksa varsayılana dön.
        setVersion((v) => (v && list.versions.some((x) => x.id === v) ? v : list.latestRelease || null));
      })
      .catch((e) => setVersionsError(errorMessage(e)));
  }, [loader, includeSnapshots]);

  useEffect(loadVersions, [loadVersions]);

  const loadLoaderVersions = useCallback(() => {
    if (loader === "vanilla" || !version) return;
    setLoaderVersionsError(null);
    setLoaderVersions(null);
    setLoaderVersion(null);
    api
      .listLoaderVersions(loader, version)
      .then((list) => {
        setLoaderVersions(list);
        setLoaderVersion(list.recommended);
      })
      .catch((e) => setLoaderVersionsError(errorMessage(e)));
  }, [loader, version]);

  useEffect(loadLoaderVersions, [loadLoaderVersions]);

  const shownVersions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (versions?.versions ?? []).filter((v) => !q || v.id.toLowerCase().includes(q));
  }, [versions, search]);

  const selectedLoaderVersion = loaderVersions?.versions.find((v) => v.version === loaderVersion);
  const bounds = ramBounds(sys?.totalMemMb ?? 4096);
  const ramMin = ramMinFor(ramMax);
  const defaultName = `${LOADER_LABELS[loader]} ${version ?? ""}`.trim();

  const chooseFolder = async () => {
    const picked = await openDialog({ directory: true, multiple: false, title: "Sunucunun konacağı klasör" });
    if (typeof picked === "string") setParentDir(picked);
  };

  const install = () => {
    if (!version) return;
    setStep("install");
    setInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    api
      .createInstance({
        name: name.trim() || defaultName,
        loader,
        mcVersion: version,
        loaderVersion: loader === "vanilla" ? null : loaderVersion,
        ramMinMb: ramMin,
        ramMaxMb: ramMax,
        parentDir,
      })
      .then((inst) => {
        addInstance(inst);
        setCreated(inst);
      })
      .catch((e) => setInstallError(errorMessage(e)))
      .finally(() => setInstalling(false));
  };

  const stepIndex = steps.findIndex((s) => s.id === step);
  const goBack = () => setStep(steps[Math.max(0, stepIndex - 1)].id);
  const goNext = () => {
    if (step === "ram" && !name) setName(defaultName);
    if (step === "name") install();
    else setStep(steps[stepIndex + 1].id);
  };
  const canNext =
    step === "loader" ||
    (step === "version" && version !== null) ||
    (step === "loaderVersion" && loaderVersion !== null) ||
    step === "ram" ||
    (step === "name" && name.trim().length > 0 && name.trim().length <= MAX_NAME_LEN);

  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Yeni Sunucu</h2>

      <ol className={styles.steps}>
        {steps.map((s, i) => (
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
          <div className={styles.listStep}>
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
            <div className={styles.list}>
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
                    className={[styles.listRow, version === v.id && styles.selected].filter(Boolean).join(" ")}
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

        {step === "loaderVersion" && (
          <div className={styles.listStep}>
            <p className={styles.hint}>
              {loader === "paper" ? "Paper build'i" : "Fabric Loader sürümü"} — önerilen seçili, emin değilsen
              dokunma.
            </p>
            <div className={styles.list}>
              {loaderVersionsError ? (
                <div className={styles.center}>
                  <p className={styles.error}>{loaderVersionsError}</p>
                  <McButton onClick={loadLoaderVersions}>Tekrar Dene</McButton>
                </div>
              ) : !loaderVersions ? (
                <div className={styles.center}>
                  <p>Yükleniyor…</p>
                  <McProgress value={null} />
                </div>
              ) : loaderVersions.versions.length === 0 ? (
                <p className={styles.center}>
                  {version} için {LOADER_LABELS[loader]} henüz yok. Geri dönüp başka bir sürüm seç.
                </p>
              ) : (
                loaderVersions.versions.map((v) => {
                  const channel = v.channel ?? (v.stable ? "stable" : "beta");
                  return (
                    <button
                      key={v.version}
                      type="button"
                      className={[styles.listRow, loaderVersion === v.version && styles.selected]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setLoaderVersion(v.version)}
                    >
                      <span>{loader === "paper" ? `build ${v.version}` : v.version}</span>
                      {v.version === loaderVersions.recommended && (
                        <span className={styles.badgeGreen}>önerilen</span>
                      )}
                      {channel !== "stable" && <span className={styles.badgeGold}>{channel}</span>}
                    </button>
                  );
                })
              )}
            </div>
            {selectedLoaderVersion && !selectedLoaderVersion.stable && (
              <p className={styles.warn}>
                Bu sürüm henüz deneysel. Çalışır ama ara sıra hata çıkabilir; dünyanı yedeklemeyi unutma.
              </p>
            )}
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
            <span className={styles.label}>Konum</span>
            <div className={styles.row}>
              <span className={styles.path} title={parentDir ?? undefined}>
                {parentDir ?? "Varsayılan (uygulama klasörü)"}
              </span>
              <McButton onClick={chooseFolder}>Klasör Seç…</McButton>
              {parentDir && <McButton onClick={() => setParentDir(null)}>Varsayılan</McButton>}
            </div>
            <dl className={styles.summary}>
              <dt>Tür</dt>
              <dd>{LOADER_LABELS[loader]}</dd>
              <dt>Sürüm</dt>
              <dd>{version}</dd>
              {loader !== "vanilla" && (
                <>
                  <dt>{loader === "paper" ? "Build" : "Loader"}</dt>
                  <dd>{loaderVersion}</dd>
                </>
              )}
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
                {created.loader === "fabric" && (
                  <p className={styles.hint}>
                    İlk açılışta Fabric birkaç küçük dosya daha indirir, biraz uzun sürebilir.
                  </p>
                )}
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
                <p>{progressText(progress)}</p>
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
