import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  FolderOpen,
  Gauge,
  Hammer,
  Puzzle,
  RotateCcw,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  api,
  errorMessage,
  pickFolder,
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
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import { Progress } from "../ui/Progress";
import { SelectList } from "../ui/SelectList";
import { Slider } from "../ui/Slider";
import styles from "./NewServerWizard.module.css";

type Step = "loader" | "version" | "loaderVersion" | "ram" | "name" | "install";

const ALL_STEPS: { id: Step; label: string }[] = [
  { id: "loader", label: "Tür" },
  { id: "version", label: "Sürüm" },
  { id: "loaderVersion", label: "Loader" },
  { id: "ram", label: "Bellek" },
  { id: "name", label: "İsim" },
  { id: "install", label: "Kurulum" },
];

const LOADER_OPTIONS: {
  id: string;
  label: string;
  icon: LucideIcon;
  enabled: boolean;
  note: string;
}[] = [
  { id: "fabric", label: "Fabric", icon: Puzzle, enabled: true, note: "Hafif, mod desteği" },
  { id: "paper", label: "Paper", icon: Gauge, enabled: true, note: "Plugin desteği, performans" },
  { id: "vanilla", label: "Vanilla", icon: Box, enabled: true, note: "Saf Minecraft" },
  { id: "neoforge", label: "NeoForge", icon: Hammer, enabled: false, note: "Yakında" },
  { id: "forge", label: "Forge", icon: Hammer, enabled: false, note: "Yakında" },
  { id: "quilt", label: "Quilt", icon: Puzzle, enabled: false, note: "Yakında" },
];

const DOWNLOAD_LABELS: Record<NonNullable<InstallProgress["file"]>, string> = {
  server: "Minecraft sunucusu indiriliyor",
  fabric: "Fabric başlatıcısı indiriliyor",
  paper: "Paper indiriliyor",
  java: "Java indiriliyor",
};

const MAX_NAME_LEN = 48;

function progressText(p: InstallProgress | null): string {
  if (p?.stage === "extract") return "Java açılıyor…";
  if (p?.stage !== "download" || !p.file) return "Sürüm bilgisi alınıyor…";
  const total = p.total ? ` / ${formatBytesMb(p.total)}` : "";
  return `${DOWNLOAD_LABELS[p.file]}… ${formatBytesMb(p.downloaded)}${total} MB`;
}

export function NewServerWizard() {
  const navigate = useAppStore((s) => s.navigate);
  const instances = useAppStore((s) => s.instances);
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

  const leave = () =>
    navigate(
      created
        ? { name: "instance", id: created.id }
        : instances.length > 0
          ? { name: "instance", id: instances[0].id }
          : { name: "empty" },
    );

  const chooseFolder = async () => {
    const picked = await pickFolder("Sunucunun konacağı klasör");
    if (picked) setParentDir(picked);
  };

  const install = () => {
    if (!version) return;
    setStep("install");
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
      .catch((e) => setInstallError(errorMessage(e)));
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
      <header className={styles.header}>
        <h1 className={styles.title}>Yeni sunucu</h1>
        <ol className={styles.stepper}>
          {steps.map((s, i) => {
            const state = i < stepIndex ? styles.done : i === stepIndex ? styles.current : "";
            return (
              <li key={s.id} className={state}>
                <span className={styles.stepNum}>{i < stepIndex ? <Check size={12} /> : i + 1}</span>
                {s.label}
              </li>
            );
          })}
        </ol>
      </header>

      <div className={styles.body}>
        {step === "loader" && (
          <section className={styles.section}>
            <h2 className={styles.question}>Nasıl bir sunucu kuralım?</h2>
            <div className={styles.loaderGrid}>
              {LOADER_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  disabled={!o.enabled}
                  className={[styles.choice, loader === o.id && styles.chosen].filter(Boolean).join(" ")}
                  onClick={() => setLoader(o.id as LoaderKind)}
                >
                  <o.icon size={20} aria-hidden className={styles.choiceIcon} />
                  <span className={styles.choiceLabel}>{o.label}</span>
                  <span className={styles.choiceNote}>{o.note}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "version" && (
          <section className={[styles.section, styles.grow].join(" ")}>
            <h2 className={styles.question}>Hangi Minecraft sürümü?</h2>
            <div className={styles.toolbar}>
              <div className={styles.search}>
                <Search size={16} aria-hidden />
                <Input
                  placeholder="Sürüm ara"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={includeSnapshots}
                  onChange={(e) => setIncludeSnapshots(e.target.checked)}
                />
                Snapshot'ları göster
              </label>
            </div>
            {versionsError ? (
              <div className={styles.errorBox}>
                <span>{versionsError}</span>
                <Button size="sm" icon={RotateCcw} onClick={loadVersions}>
                  Tekrar dene
                </Button>
              </div>
            ) : !versions ? (
              <div className={styles.loading}>
                <Progress value={null} />
              </div>
            ) : (
              <SelectList
                value={version}
                onSelect={setVersion}
                empty="Eşleşen sürüm yok."
                items={shownVersions.map((v) => ({
                  key: v.id,
                  label: v.id,
                  badges: (
                    <>
                      {v.id === versions.latestRelease && <Badge tone="accent">En yeni</Badge>}
                      {v.type === "snapshot" && <Badge tone="warning">Snapshot</Badge>}
                    </>
                  ),
                  meta: formatDate(v.releaseTime),
                }))}
              />
            )}
          </section>
        )}

        {step === "loaderVersion" && (
          <section className={[styles.section, styles.grow].join(" ")}>
            <h2 className={styles.question}>{loader === "paper" ? "Paper build'i" : "Fabric Loader sürümü"}</h2>
            <p className={styles.lead}>Önerilen sürüm seçili. Emin değilsen değiştirme.</p>
            {loaderVersionsError ? (
              <div className={styles.errorBox}>
                <span>{loaderVersionsError}</span>
                <Button size="sm" icon={RotateCcw} onClick={loadLoaderVersions}>
                  Tekrar dene
                </Button>
              </div>
            ) : !loaderVersions ? (
              <div className={styles.loading}>
                <Progress value={null} />
              </div>
            ) : (
              <SelectList
                value={loaderVersion}
                onSelect={setLoaderVersion}
                empty={`${version} için ${LOADER_LABELS[loader]} henüz yok. Geri dönüp başka bir sürüm seç.`}
                items={loaderVersions.versions.map((v) => {
                  const channel = v.channel ?? (v.stable ? "stable" : "beta");
                  return {
                    key: v.version,
                    label: loader === "paper" ? `Build ${v.version}` : v.version,
                    badges: (
                      <>
                        {v.version === loaderVersions.recommended && <Badge tone="accent">Önerilen</Badge>}
                        {channel !== "stable" && <Badge tone="warning">{channel}</Badge>}
                      </>
                    ),
                  };
                })}
              />
            )}
            {selectedLoaderVersion && !selectedLoaderVersion.stable && (
              <p className={styles.warn}>
                <AlertTriangle size={14} aria-hidden />
                Bu sürüm henüz deneysel. Çalışır ama ara sıra hata çıkabilir; dünyanı yedeklemeyi unutma.
              </p>
            )}
          </section>
        )}

        {step === "ram" && (
          <section className={styles.section}>
            <h2 className={styles.question}>Sunucu ne kadar bellek kullansın?</h2>
            <Slider
              label="En fazla RAM"
              valueLabel={formatRam(ramMax)}
              value={ramMax}
              min={RAM_MIN}
              max={bounds.max}
              step={RAM_STEP}
              onChange={setRamMax}
            />
            <p className={styles.lead}>
              Bilgisayarında {sys ? formatRam(Math.round(sys.totalMemMb / 1024) * 1024) : "?"} RAM var. Oyunu da
              aynı bilgisayarda açacaksan çok yüksek seçme; iki kişi için 2–4 GB fazlasıyla yeter.
            </p>
          </section>
        )}

        {step === "name" && (
          <section className={styles.section}>
            <h2 className={styles.question}>Son dokunuşlar</h2>
            <Field label="Sunucu adı" htmlFor="server-name">
              <Input
                id="server-name"
                value={name}
                maxLength={MAX_NAME_LEN}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canNext && goNext()}
                autoFocus
              />
            </Field>
            <Field label="Konum" hint="Varsayılan konum uygulamanın kendi klasörüdür.">
              <div className={styles.location}>
                <span className={styles.path} title={parentDir ?? undefined}>
                  {parentDir ?? "Varsayılan"}
                </span>
                {parentDir && (
                  <Button variant="ghost" size="sm" onClick={() => setParentDir(null)}>
                    Sıfırla
                  </Button>
                )}
                <Button size="sm" icon={FolderOpen} onClick={chooseFolder}>
                  Klasör seç
                </Button>
              </div>
            </Field>
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
              <dt>Bellek</dt>
              <dd>
                {formatRam(ramMin)} – {formatRam(ramMax)}
              </dd>
              <dt>Java</dt>
              <dd>
                {sys?.java ? `Java ${sys.java.major} bulundu` : "Bulunamadı"}
                <span className={styles.muted}> · uygun Java yoksa kurulumda indirilir</span>
              </dd>
            </dl>
          </section>
        )}

        {step === "install" && (
          <section className={[styles.section, styles.center].join(" ")}>
            {installError ? (
              <>
                <AlertTriangle size={32} className={styles.dangerIcon} aria-hidden />
                <h2 className={styles.question}>Kurulum başarısız</h2>
                <p className={styles.errorText}>{installError}</p>
                <div className={styles.row}>
                  <Button onClick={() => setStep("name")}>Geri</Button>
                  <Button variant="primary" icon={RotateCcw} onClick={install}>
                    Tekrar dene
                  </Button>
                </div>
              </>
            ) : created ? (
              <>
                <CheckCircle2 size={36} className={styles.okIcon} aria-hidden />
                <h2 className={styles.question}>"{created.name}" hazır</h2>
                {created.loader === "fabric" && (
                  <p className={styles.lead}>İlk açılışta Fabric birkaç küçük dosya daha indirir.</p>
                )}
                <Button variant="primary" size="lg" onClick={() => navigate({ name: "instance", id: created.id })}>
                  Sunucuya git
                </Button>
              </>
            ) : (
              <>
                <h2 className={styles.question}>Kuruluyor</h2>
                <div className={styles.progress}>
                  <Progress
                    value={
                      progress?.stage === "download" && progress.total ? progress.downloaded / progress.total : null
                    }
                  />
                  <p className={styles.lead}>{progressText(progress)}</p>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {step !== "install" && (
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={leave}>
            İptal
          </Button>
          <div className={styles.row}>
            {stepIndex > 0 && <Button onClick={goBack}>Geri</Button>}
            <Button variant="primary" disabled={!canNext} onClick={goNext}>
              {step === "name" ? "Kur" : "Devam"}
            </Button>
          </div>
        </footer>
      )}
      {step === "install" && (created || installError) && (
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={leave}>
            Kapat
          </Button>
        </footer>
      )}
    </div>
  );
}
