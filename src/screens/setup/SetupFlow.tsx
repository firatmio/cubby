import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, FolderOpen, RotateCcw } from "lucide-react";
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
} from "../../lib/api";
import { KIND_COLORS, KIND_LABELS, LOADER_LABELS, formatBytesMb, formatDate, formatRam } from "../../lib/format";
import { rise, spring, stagger } from "../../lib/motion";
import { RAM_MIN, RAM_STEP, ramBounds, ramMinFor } from "../../lib/ram";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Field, Input } from "../../ui/Input";
import { Progress } from "../../ui/Progress";
import { SelectList } from "../../ui/SelectList";
import { Slider } from "../../ui/Slider";
import { Toggle } from "../../ui/Toggle";
import { KIND_ICONS } from "../home/TileRow";
import styles from "./SetupFlow.module.css";

type Step = "kind" | "version" | "name" | "install";
const QUESTION_STEPS: Step[] = ["kind", "version", "name"];

const KINDS: { id: LoaderKind; text: string }[] = [
  { id: "fabric", text: "Mod kurabilirsin. Çoğu kişi için en iyi başlangıç." },
  { id: "paper", text: "Hızlı ve hafif. Eklentilerle oyun kuralları değişir." },
  { id: "vanilla", text: "Hiçbir ekleme yok, Minecraft olduğu gibi." },
];

const DOWNLOAD_LABELS: Record<NonNullable<InstallProgress["file"]>, string> = {
  server: "Minecraft indiriliyor",
  fabric: "Mod desteği hazırlanıyor",
  paper: "Paper indiriliyor",
  java: "Java indiriliyor",
};

const MAX_NAME_LEN = 48;

function progressText(p: InstallProgress | null): string {
  if (p?.stage === "extract") return "Java hazırlanıyor…";
  if (p?.stage !== "download" || !p.file) return "Hazırlanıyor…";
  const total = p.total ? ` / ${formatBytesMb(p.total)} MB` : " MB";
  return `${DOWNLOAD_LABELS[p.file]} · ${formatBytesMb(p.downloaded)}${total}`;
}

/** Yeni dünya: adım başına tek soru; teknik seçimler "Gelişmiş seçenekler"de, önerilen değerlerle dolu. */
export function SetupFlow() {
  const setView = useAppStore((s) => s.setView);
  const setSetupColor = useAppStore((s) => s.setSetupColor);
  const addInstance = useAppStore((s) => s.addInstance);
  const progress = useAppStore((s) => s.installProgress);
  const setInstallProgress = useAppStore((s) => s.setInstallProgress);

  const [step, setStep] = useState<Step>("kind");
  const [kind, setKind] = useState<LoaderKind>("fabric");

  const [includeSnapshots, setIncludeSnapshots] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [versions, setVersions] = useState<GameVersionList | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);

  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionList | null>(null);
  /** null: önerilen (Rust seçer). */
  const [loaderVersion, setLoaderVersion] = useState<string | null>(null);

  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [ramMax, setRamMax] = useState(2048);
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [installError, setInstallError] = useState<string | null>(null);
  const [created, setCreated] = useState<Instance | null>(null);

  useEffect(() => setSetupColor(KIND_COLORS[kind]), [kind, setSetupColor]);

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
      .listGameVersions(kind, includeSnapshots)
      .then((list) => {
        setVersions(list);
        setVersion((v) => (v && list.versions.some((x) => x.id === v) ? v : list.latestRelease || null));
      })
      .catch((e) => setVersionsError(errorMessage(e)));
  }, [kind, includeSnapshots]);

  useEffect(loadVersions, [loadVersions]);

  useEffect(() => {
    setLoaderVersions(null);
    setLoaderVersion(null);
    if (kind === "vanilla" || !version) return;
    api.listLoaderVersions(kind, version).then(setLoaderVersions).catch(console.error);
  }, [kind, version]);

  const bounds = ramBounds(sys?.totalMemMb ?? 4096);
  const defaultName = useMemo(() => `${KIND_LABELS[kind]} dünya`, [kind]);
  const noLoaderForVersion = kind !== "vanilla" && loaderVersions !== null && loaderVersions.versions.length === 0;

  const install = () => {
    if (!version) return;
    setStep("install");
    setInstallError(null);
    setInstallProgress(null);
    api
      .createInstance({
        name: name.trim() || defaultName,
        loader: kind,
        mcVersion: version,
        loaderVersion: kind === "vanilla" ? null : loaderVersion,
        ramMinMb: ramMinFor(ramMax),
        ramMaxMb: ramMax,
        parentDir,
      })
      .then((inst) => {
        addInstance(inst);
        setCreated(inst);
      })
      .catch((e) => setInstallError(errorMessage(e)));
  };

  const qIndex = QUESTION_STEPS.indexOf(step);
  const back = () => (qIndex <= 0 ? setView("home") : setStep(QUESTION_STEPS[qIndex - 1]));
  const next = () => {
    if (step === "version" && !name) setName(defaultName);
    if (step === "name") install();
    else setStep(QUESTION_STEPS[qIndex + 1]);
  };
  const canNext =
    step === "kind" ||
    (step === "version" && version !== null && !noLoaderForVersion) ||
    (step === "name" && name.trim().length > 0 && name.trim().length <= MAX_NAME_LEN);

  let question: string;
  let sub: string;
  let content: ReactNode;

  if (step === "kind") {
    question = "Nasıl oynamak istersiniz?";
    sub = "Sonradan değiştirmek zor; emin değilsen Modlu iyi bir başlangıç.";
    content = (
      <div className={styles.kinds}>
        {KINDS.map(({ id, text }) => {
          const Icon = KIND_ICONS[id];
          const chosen = id === kind;
          return (
            <motion.button
              key={id}
              type="button"
              className={[styles.kind, chosen && styles.chosen].filter(Boolean).join(" ")}
              style={{ "--kind": KIND_COLORS[id] } as React.CSSProperties}
              animate={{ scale: chosen ? 1.02 : 1 }}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              onClick={() => setKind(id)}
            >
              <Icon size={28} aria-hidden className={styles.kindIcon} />
              <span className={styles.kindLabel}>{KIND_LABELS[id]}</span>
              <span className={styles.kindTech}>{LOADER_LABELS[id]}</span>
              <span className={styles.kindText}>{text}</span>
            </motion.button>
          );
        })}
        <p className={styles.soon}>NeoForge, Forge ve Quilt yakında.</p>
      </div>
    );
  } else if (step === "version") {
    question = "Hangi Minecraft sürümü?";
    sub = "Kardeşinin oyunu da aynı sürümde olmalı. Genelde en yenisi iyidir.";
    const latest = versions?.versions.find((v) => v.id === versions.latestRelease);
    content = versionsError ? (
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
      <div className={styles.versionStep}>
        {latest && !showAllVersions && (
          <motion.button
            type="button"
            className={[styles.bigChoice, version === latest.id && styles.chosen].filter(Boolean).join(" ")}
            whileTap={{ scale: 0.98 }}
            onClick={() => setVersion(latest.id)}
          >
            <span className={styles.bigVersion}>{latest.id}</span>
            <span className={styles.kindText}>En yeni sürüm · {formatDate(latest.releaseTime)}</span>
            {version === latest.id && <Check size={20} className={styles.bigCheck} aria-hidden />}
          </motion.button>
        )}
        {showAllVersions ? (
          <>
            <Toggle
              checked={includeSnapshots}
              onChange={setIncludeSnapshots}
              label="Deneme sürümlerini (snapshot) göster"
            />
            <SelectList
              maxHeight={230}
              value={version}
              onSelect={setVersion}
              items={versions.versions.map((v) => ({
                key: v.id,
                label: v.id,
                badges: (
                  <>
                    {v.id === versions.latestRelease && <Badge tone="accent">En yeni</Badge>}
                    {v.type === "snapshot" && <Badge tone="warning">Deneme</Badge>}
                  </>
                ),
                meta: formatDate(v.releaseTime),
              }))}
            />
          </>
        ) : (
          <Button
            variant="ghost"
            icon={ChevronDown}
            iconRight
            className={styles.startSelf}
            onClick={() => setShowAllVersions(true)}
          >
            Başka bir sürüm seç
          </Button>
        )}
        {noLoaderForVersion && (
          <p className={styles.warn}>{version} için {KIND_LABELS[kind]} henüz hazır değil. Başka bir sürüm seç.</p>
        )}
      </div>
    );
  } else if (step === "name") {
    question = "Dünyana bir isim ver";
    sub = "Ana ekranda bu isimle görünecek. Sonradan değiştirebilirsin.";
    const loaderItems = loaderVersions?.versions.map((v) => {
      const channel = v.channel ?? (v.stable ? "stable" : "beta");
      return {
        key: v.version,
        label: kind === "paper" ? `Build ${v.version}` : v.version,
        badges: (
          <>
            {v.version === loaderVersions.recommended && <Badge tone="accent">Önerilen</Badge>}
            {channel !== "stable" && <Badge tone="warning">{channel}</Badge>}
          </>
        ),
      };
    });
    content = (
      <div className={styles.nameStep}>
        <Input
          className={styles.bigInput}
          value={name}
          maxLength={MAX_NAME_LEN}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canNext && next()}
          autoFocus
          aria-label="Dünyanın adı"
        />
        <button type="button" className={styles.disclosure} onClick={() => setAdvancedOpen((v) => !v)}>
          Gelişmiş seçenekler
          <motion.span animate={{ rotate: advancedOpen ? 180 : 0 }} transition={spring}>
            <ChevronDown size={16} aria-hidden />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {advancedOpen && (
            <motion.div
              className={styles.advanced}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring}
            >
              <div className={styles.advancedInner}>
                <Slider
                  label="En fazla bellek"
                  valueLabel={formatRam(ramMax)}
                  value={ramMax}
                  min={RAM_MIN}
                  max={bounds.max}
                  step={RAM_STEP}
                  onChange={setRamMax}
                />
                {kind !== "vanilla" && loaderItems && (
                  <div className={styles.loaderField}>
                    <Field label={kind === "paper" ? "Paper build'i" : "Fabric Loader sürümü"}>
                      <SelectList
                        maxHeight={150}
                        value={loaderVersion ?? loaderVersions?.recommended ?? null}
                        onSelect={setLoaderVersion}
                        items={loaderItems}
                      />
                    </Field>
                  </div>
                )}
                <Field label="Konum" hint={parentDir ? undefined : "Varsayılan: uygulamanın kendi klasörü"}>
                  <div className={styles.location}>
                    <span className={styles.path}>{parentDir ?? "Varsayılan"}</span>
                    {parentDir && (
                      <Button size="sm" variant="ghost" onClick={() => setParentDir(null)}>
                        Sıfırla
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon={FolderOpen}
                      onClick={async () => setParentDir((await pickFolder("Dünyanın konacağı klasör")) ?? parentDir)}
                    >
                      Klasör seç
                    </Button>
                  </div>
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  } else {
    question = installError ? "Kurulum tamamlanamadı" : created ? "Dünyan hazır" : "Dünyan kuruluyor";
    sub = installError
      ? installError
      : created
        ? created.loader === "fabric"
          ? "İlk açılışta mod desteği için birkaç küçük dosya daha iner."
          : "Başlat'a bastığında kardeşin katılabilir."
        : "Birkaç dakika sürebilir; gereken her şeyi indiriyorum.";
    content = installError || created ? null : (
      <div className={styles.installing}>
        <Progress value={progress?.stage === "download" && progress.total ? progress.downloaded / progress.total : null} />
        <p className={styles.progressText}>{progressText(progress)}</p>
      </div>
    );
  }

  return (
    <div className={styles.setup}>
      <div className={styles.dashes} aria-hidden>
        {QUESTION_STEPS.map((s, i) => (
          <motion.span
            key={s}
            className={styles.dash}
            animate={{
              width: step === s ? 28 : 10,
              backgroundColor: i <= qIndex || step === "install" ? "#ffffff" : "#4a4a4a",
            }}
            transition={spring}
          />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={step + (created ? "-done" : "") + (installError ? "-error" : "")}
          className={styles.content}
          variants={stagger}
          initial="hidden"
          animate="show"
          exit="exit"
        >
          <motion.h1 className={styles.question} variants={rise}>
            {question}
          </motion.h1>
          <motion.p className={[styles.sub, installError && styles.subError].filter(Boolean).join(" ")} variants={rise}>
            {sub}
          </motion.p>
          {content && <motion.div variants={rise}>{content}</motion.div>}
        </motion.section>
      </AnimatePresence>

      <footer className={styles.footer}>
        {step !== "install" ? (
          <>
            <Button icon={ArrowLeft} onClick={back}>
              {qIndex === 0 ? "Vazgeç" : "Geri"}
            </Button>
            <Button variant="primary" size="lg" icon={ArrowRight} iconRight disabled={!canNext} onClick={next}>
              {step === "name" ? "Kur" : "Devam"}
            </Button>
          </>
        ) : installError ? (
          <>
            <Button icon={ArrowLeft} onClick={() => setStep("name")}>
              Geri
            </Button>
            <Button variant="primary" size="lg" icon={RotateCcw} onClick={install}>
              Tekrar dene
            </Button>
          </>
        ) : created ? (
          <>
            <span />
            <Button variant="primary" size="lg" icon={ArrowRight} iconRight onClick={() => setView("home")}>
              Dünyaya git
            </Button>
          </>
        ) : null}
      </footer>
    </div>
  );
}
