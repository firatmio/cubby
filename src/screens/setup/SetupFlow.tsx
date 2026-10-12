import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, FolderOpen, Plus, RotateCcw, X } from "lucide-react";
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
import { getT, useT, type Dict } from "../../i18n";
import {
  KIND_COLORS,
  LOADER_LABELS,
  MOD_LOADERS,
  formatBytesMb,
  formatDate,
  formatRam,
  isModded,
  kindLabel,
} from "../../lib/format";
import { crossfade, slide, spring } from "../../lib/motion";
import { RAM_MIN, RAM_STEP, ramBounds, ramMinFor } from "../../lib/ram";
import { useAppStore } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Field, Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { Progress } from "../../ui/Progress";
import { SelectList } from "../../ui/SelectList";
import { Slider } from "../../ui/Slider";
import { Toggle } from "../../ui/Toggle";
import { LOADER_ART, LoaderLogo } from "../../ui/LoaderLogo";
import styles from "./SetupFlow.module.css";

type Step = "kind" | "version" | "name" | "access" | "whitelist" | "install";

/** İlk adımın kartları; "Modlu" kartı seçili mod altyapısını (Fabric, NeoForge, …) temsil eder. */
const kinds = (t: Dict["setup"]): { id: LoaderKind; text: string }[] => [
  { id: "fabric", text: t.kindFabric },
  { id: "paper", text: t.kindPaper },
  { id: "vanilla", text: t.kindVanilla },
];

const modLoaderText = (t: Dict["setup"]): Record<string, string> => ({
  fabric: t.loaderFabric,
  neoforge: t.loaderNeoforge,
  forge: t.loaderForge,
  quilt: t.loaderQuilt,
});

const downloadLabels = (t: Dict["setup"]): Record<NonNullable<InstallProgress["file"]>, string> => ({
  server: t.dlServer,
  fabric: t.dlFabric,
  paper: t.dlPaper,
  installer: t.dlInstaller,
  java: t.dlJava,
});

const MAX_NAME_LEN = 48;

function progressText(p: InstallProgress | null, kind: LoaderKind): string {
  const t = getT();
  if (p?.stage === "extract") return t.setup.javaPreparing;
  if (p?.stage === "installer") return t.setup.installing(LOADER_LABELS[kind], p.line ?? "");
  if (p?.stage !== "download" || !p.file) return t.common.preparing;
  const total = p.total ? ` / ${formatBytesMb(p.total)} MB` : " MB";
  return `${downloadLabels(t.setup)[p.file]} · ${formatBytesMb(p.downloaded)}${total}`;
}

/** Yeni dünya: adım başına tek soru; teknik seçimler "Gelişmiş seçenekler"de, önerilen değerlerle dolu. */
export function SetupFlow() {
  const setView = useAppStore((s) => s.setView);
  const setSetupColor = useAppStore((s) => s.setSetupColor);
  const addInstance = useAppStore((s) => s.addInstance);
  const progress = useAppStore((s) => s.installProgress);
  const setInstallProgress = useAppStore((s) => s.setInstallProgress);
  const tt = useT();
  const t = tt.setup;

  /** dir: son geçişin yönü (1 ileri, -1 geri); kayma animasyonu buna göre. */
  const [{ step, dir }, setNav] = useState<{ step: Step; dir: 1 | -1 }>({ step: "kind", dir: 1 });
  const [kind, setKind] = useState<LoaderKind>("fabric");
  /** Modlu kartına dönülünce son seçilen altyapı kalsın. */
  const [lastModLoader, setLastModLoader] = useState<LoaderKind>("fabric");

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

  const [whitelistOn, setWhitelistOn] = useState(false);
  const [offline, setOffline] = useState(false);
  /** Doğrulanmış isimler (hesabın gerçek yazımıyla). */
  const [allowed, setAllowed] = useState<string[]>([]);
  const [playerInput, setPlayerInput] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const pageRef = useRef<HTMLElement>(null);
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
  const defaultName = useMemo(() => tt.kind.defaultName(kindLabel(kind)), [kind, tt]);
  const noLoaderForVersion = kind !== "vanilla" && loaderVersions !== null && loaderVersions.versions.length === 0;
  // Premium olmayanlar girebiliyorsa beyaz liste zorunlu: yoksa herkes herkesin adıyla girebilir.
  const useWhitelist = whitelistOn || offline;
  const questionSteps = useMemo<Step[]>(
    () => ["kind", "version", "name", "access", ...(useWhitelist ? (["whitelist"] as Step[]) : [])],
    [useWhitelist],
  );
  const lastStep = questionSteps[questionSteps.length - 1];
  const setStep = (to: Step) => {
    const order = [...questionSteps, "install"];
    setNav((cur) => ({ step: to, dir: order.indexOf(to) >= order.indexOf(cur.step) ? 1 : -1 }));
  };

  const addPlayer = async (e: FormEvent) => {
    e.preventDefault();
    const n = playerInput.trim();
    if (!n || lookupBusy) return;
    if (allowed.some((a) => a.toLowerCase() === n.toLowerCase())) {
      setPlayerInput("");
      return;
    }
    setLookupBusy(true);
    setLookupError(null);
    try {
      const profile = await api.lookupPlayer(n, offline);
      setAllowed((list) => [...list, profile.name]);
      setPlayerInput("");
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setLookupBusy(false);
    }
  };

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
        offlineMode: offline,
        whitelist: useWhitelist ? allowed : null,
      })
      .then((inst) => {
        addInstance(inst);
        setCreated(inst);
      })
      .catch((e) => setInstallError(errorMessage(e)));
  };

  const qIndex = questionSteps.indexOf(step);
  const back = () => (qIndex <= 0 ? setView("home") : setStep(questionSteps[qIndex - 1]));
  const next = () => {
    if (step === "version" && !name) setName(defaultName);
    if (step === lastStep) install();
    else setStep(questionSteps[qIndex + 1]);
  };
  const canNext =
    step === "kind" ||
    (step === "version" && version !== null && !noLoaderForVersion) ||
    (step === "name" && name.trim().length > 0 && name.trim().length <= MAX_NAME_LEN) ||
    step === "access" ||
    (step === "whitelist" && allowed.length > 0 && !lookupBusy);

  let question: string;
  let sub: string;
  let content: ReactNode;

  if (step === "kind") {
    question = t.kindQ;
    sub = t.kindSub;
    content = (
      <div className={styles.kinds}>
        {kinds(t).map(({ id, text }) => {
          const modCard = id === "fabric";
          // Modlu kartı seçili (ya da en son seçilen) altyapının adını, logosunu ve görselini taşır.
          const shown = modCard ? (isModded(kind) ? kind : lastModLoader) : id;
          const chosen = modCard ? isModded(kind) : id === kind;
          return (
            <motion.button
              key={id}
              type="button"
              className={[styles.kind, chosen && styles.chosen].filter(Boolean).join(" ")}
              style={{ "--kind": KIND_COLORS[shown] } as React.CSSProperties}
              animate={{ scale: chosen ? 1.02 : 1 }}
              whileTap={{ scale: 0.98 }}
              transition={spring}
              onClick={() => setKind(modCard ? lastModLoader : id)}
            >
              <AnimatePresence initial={false}>
                <motion.span
                  key={shown}
                  className={styles.kindArt}
                  style={LOADER_ART[shown]}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  aria-hidden
                />
              </AnimatePresence>
              <span className={styles.kindShade} aria-hidden />
              <motion.span
                key={shown}
                className={styles.kindLogo}
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={spring}
              >
                <LoaderLogo kind={shown} size={48} />
              </motion.span>
              <span className={styles.kindLabel}>{kindLabel(id)}</span>
              <span className={styles.kindTech}>{LOADER_LABELS[shown]}</span>
              <span className={styles.kindText}>{text}</span>
            </motion.button>
          );
        })}
        <div className={[styles.modLoaders, !isModded(kind) && styles.hiddenRow].filter(Boolean).join(" ")}>
          <span className={styles.modLoadersLabel}>{t.modLoader}</span>
          <PillTabs
            tabs={MOD_LOADERS.map((l) => ({ id: l, label: LOADER_LABELS[l] }))}
            active={isModded(kind) ? kind : lastModLoader}
            onChange={(l) => {
              setLastModLoader(l);
              setKind(l);
            }}
            layoutId="mod-loader"
          />
          <span className={styles.modLoadersText}>
            {modLoaderText(t)[isModded(kind) ? kind : lastModLoader]}
            {(isModded(kind) ? kind : lastModLoader) === "fabric" && t.recommendedSuffix}
          </span>
        </div>
      </div>
    );
  } else if (step === "version") {
    question = t.versionQ;
    sub = t.versionSub;
    const latest = versions?.versions.find((v) => v.id === versions.latestRelease);
    content = versionsError ? (
      <div className={styles.errorBox}>
        <span>{versionsError}</span>
        <Button size="sm" icon={RotateCcw} onClick={loadVersions}>
          {tt.common.retry}
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
            <span className={styles.kindText}>{t.latestVersion(formatDate(latest.releaseTime))}</span>
            {version === latest.id && <Check size={20} className={styles.bigCheck} aria-hidden />}
          </motion.button>
        )}
        {showAllVersions ? (
          <>
            <Toggle
              checked={includeSnapshots}
              onChange={setIncludeSnapshots}
              label={t.showSnapshots}
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
                    {v.id === versions.latestRelease && <Badge tone="accent">{t.latest}</Badge>}
                    {v.type === "snapshot" && <Badge tone="warning">{t.snapshot}</Badge>}
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
            {t.otherVersion}
          </Button>
        )}
        {noLoaderForVersion && (
          <p className={styles.warn}>{t.notReady(version ?? "", LOADER_LABELS[kind])}</p>
        )}
      </div>
    );
  } else if (step === "name") {
    question = t.nameQ;
    sub = t.nameSub;
    const loaderItems = loaderVersions?.versions.map((v) => {
      const channel = v.channel ?? (v.stable ? "stable" : "beta");
      return {
        key: v.version,
        label: kind === "paper" ? `Build ${v.version}` : v.version,
        badges: (
          <>
            {v.version === loaderVersions.recommended && <Badge tone="accent">{t.recommended}</Badge>}
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
          data-autofocus
          aria-label={t.worldName}
        />
        <button type="button" className={styles.disclosure} onClick={() => setAdvancedOpen((v) => !v)}>
          {t.advancedOptions}
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
                  label={t.maxMemory}
                  valueLabel={formatRam(ramMax)}
                  value={ramMax}
                  min={RAM_MIN}
                  max={bounds.max}
                  step={RAM_STEP}
                  onChange={setRamMax}
                />
                {kind !== "vanilla" && loaderItems && (
                  <div className={styles.loaderField}>
                    <Field label={kind === "paper" ? t.paperBuild : t.loaderVersion(LOADER_LABELS[kind])}>
                      <SelectList
                        maxHeight={150}
                        value={loaderVersion ?? loaderVersions?.recommended ?? null}
                        onSelect={setLoaderVersion}
                        items={loaderItems}
                      />
                    </Field>
                  </div>
                )}
                <Field label={t.location} hint={parentDir ? undefined : t.locationHint}>
                  <div className={styles.location}>
                    <span className={styles.path}>{parentDir ?? t.default}</span>
                    {parentDir && (
                      <Button size="sm" variant="ghost" onClick={() => setParentDir(null)}>
                        {t.reset}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon={FolderOpen}
                      onClick={async () => setParentDir((await pickFolder(t.pickFolderTitle)) ?? parentDir)}
                    >
                      {t.pickFolder}
                    </Button>
                  </div>
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  } else if (step === "access") {
    question = t.accessQ;
    sub = t.accessSub;
    content = (
      <div className={styles.accessStep}>
        <div className={styles.panel}>
          <Toggle
            checked={useWhitelist}
            onChange={setWhitelistOn}
            disabled={offline}
            label={t.whitelist}
            description={offline ? t.whitelistForced : t.whitelistText}
          />
          <Toggle
            checked={offline}
            onChange={setOffline}
            label={t.offline}
            description={t.offlineText}
          />
        </div>
        {offline && (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            {t.offlineWarn}
          </p>
        )}
      </div>
    );
  } else if (step === "whitelist") {
    question = t.whitelistQ;
    sub = offline ? t.whitelistSubOffline : t.whitelistSub;
    content = (
      <div className={styles.accessStep}>
        <form className={styles.addRow} onSubmit={addPlayer}>
          <Input
            className={styles.playerInput}
            value={playerInput}
            maxLength={16}
            placeholder={t.playerName}
            onChange={(e) => {
              setPlayerInput(e.target.value);
              setLookupError(null);
            }}
            data-autofocus
            aria-label={t.playerName}
          />
          <Button type="submit" size="lg" icon={Plus} loading={lookupBusy} disabled={!playerInput.trim()}>
            {t.add}
          </Button>
        </form>
        {lookupError && <p className={styles.lookupError}>{lookupError}</p>}
        <div className={styles.chips}>
          <AnimatePresence initial={false}>
            {allowed.map((n) => (
              <motion.span
                key={n}
                layout
                className={styles.chip}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={spring}
              >
                <span className={styles.chipAvatar}>{n.slice(0, 1).toUpperCase()}</span>
                {n}
                <button
                  type="button"
                  aria-label={t.removeFromList(n)}
                  onClick={() => setAllowed((list) => list.filter((a) => a !== n))}
                >
                  <X size={14} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        {allowed.length === 0 && <p className={styles.hint}>{t.needOne}</p>}
      </div>
    );
  } else {
    question = installError ? t.failedQ : created ? t.readyQ : t.installingQ;
    sub = installError
      ? installError
      : created
        ? created.loader === "fabric"
          ? t.readyModded
          : t.readySub
        : kind === "neoforge" || kind === "forge" || kind === "quilt"
          ? t.installerSub(LOADER_LABELS[kind])
          : t.installSub;
    content = installError || created ? null : (
      <div className={styles.installing}>
        <Progress value={progress?.stage === "download" && progress.total ? progress.downloaded / progress.total : null} />
        <p className={styles.progressText}>{progressText(progress, kind)}</p>
      </div>
    );
  }

  return (
    <div className={styles.setup}>
      <div className={styles.dashes} aria-hidden>
        {questionSteps.map((s, i) => (
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

      {/* Adım değişince sayfalar yatayda kayar; aynı adımda içerik değişirse (kurulum → hazır/hata) çapraz geçiş. */}
      <AnimatePresence initial={false} custom={dir}>
        <motion.section
          key={step}
          className={styles.content}
          custom={dir}
          variants={slide}
          initial="enter"
          animate="center"
          exit="exit"
          // Odak kayma bitince: kayarken odaklamak tarayıcıya ekran dışındaki kutuyu göstermek için kaydırtır.
          onAnimationComplete={(def) => {
            if (def === "center") pageRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
          }}
          ref={pageRef}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={(created ? "done" : "") + (installError ? "error" : "")}
              className={styles.page}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: crossfade.ease }}
            >
              <h1 className={styles.question}>{question}</h1>
              <p className={[styles.sub, installError && styles.subError].filter(Boolean).join(" ")}>{sub}</p>
              {content}
            </motion.div>
          </AnimatePresence>
        </motion.section>
      </AnimatePresence>

      <footer className={styles.footer}>
        {step !== "install" ? (
          <>
            <Button icon={ArrowLeft} onClick={back}>
              {qIndex === 0 ? tt.common.cancel : t.back}
            </Button>
            <Button variant="primary" size="lg" icon={ArrowRight} iconRight disabled={!canNext} onClick={next}>
              {step === lastStep ? t.install : t.next}
            </Button>
          </>
        ) : installError ? (
          <>
            <Button icon={ArrowLeft} onClick={() => setStep(lastStep)}>
              {t.back}
            </Button>
            <Button variant="primary" size="lg" icon={RotateCcw} onClick={install}>
              {tt.common.retry}
            </Button>
          </>
        ) : created ? (
          <>
            <span />
            <Button variant="primary" size="lg" icon={ArrowRight} iconRight onClick={() => setView("home")}>
              {t.goToWorld}
            </Button>
          </>
        ) : null}
      </footer>
    </div>
  );
}
