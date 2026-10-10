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
import { KIND_COLORS, KIND_LABELS, LOADER_LABELS, formatBytesMb, formatDate, formatRam } from "../../lib/format";
import { crossfade, slide, spring } from "../../lib/motion";
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

type Step = "kind" | "version" | "name" | "access" | "whitelist" | "install";

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

  /** dir: son geçişin yönü (1 ileri, -1 geri); kayma animasyonu buna göre. */
  const [{ step, dir }, setNav] = useState<{ step: Step; dir: 1 | -1 }>({ step: "kind", dir: 1 });
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
  const defaultName = useMemo(() => `${KIND_LABELS[kind]} dünya`, [kind]);
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
    sub = "Arkadaşının oyunu da aynı sürümde olmalı. Genelde en yenisi iyidir.";
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
          data-autofocus
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
  } else if (step === "access") {
    question = "Kimler girebilsin?";
    sub = "Bunları sonradan Oyuncular ve Dünya ayarlarından değiştirebilirsin.";
    content = (
      <div className={styles.accessStep}>
        <div className={styles.panel}>
          <Toggle
            checked={useWhitelist}
            onChange={setWhitelistOn}
            disabled={offline}
            label="Beyaz liste"
            description={
              offline
                ? "Premium olmayanlar girebildiği için açık kalmalı."
                : "Yalnız adını eklediğin oyuncular girebilir. Adresi bilen başka biri giremez."
            }
          />
          <Toggle
            checked={offline}
            onChange={setOffline}
            label="Premium olmayanlar da girebilsin (TLauncher)"
            description="Arkadaşın satın alınmış bir Minecraft hesabı olmadan oynuyorsa aç."
          />
        </div>
        {offline && (
          <p className={styles.warn}>
            <AlertTriangle size={15} aria-hidden />
            Bu modda isimler doğrulanamaz; adresi bilen biri senin ya da arkadaşının adını kullanabilir. Bu yüzden
            yalnız beyaz listedekiler girebilecek.
          </p>
        )}
      </div>
    );
  } else if (step === "whitelist") {
    question = "Beyaz liste";
    sub = offline
      ? "Oyunda kullandıkları isimleri yaz. Kendi adını da eklemeyi unutma."
      : "Minecraft hesap adlarını yaz; her ismi Mojang'dan kontrol ederim. Kendi adını da ekle.";
    content = (
      <div className={styles.accessStep}>
        <form className={styles.addRow} onSubmit={addPlayer}>
          <Input
            className={styles.playerInput}
            value={playerInput}
            maxLength={16}
            placeholder="Oyuncu adı"
            onChange={(e) => {
              setPlayerInput(e.target.value);
              setLookupError(null);
            }}
            data-autofocus
            aria-label="Oyuncu adı"
          />
          <Button type="submit" size="lg" icon={Plus} loading={lookupBusy} disabled={!playerInput.trim()}>
            Ekle
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
                  aria-label={`${n} listeden çıkar`}
                  onClick={() => setAllowed((list) => list.filter((a) => a !== n))}
                >
                  <X size={14} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        {allowed.length === 0 && <p className={styles.hint}>En az bir isim ekle; liste boşsa kimse giremez.</p>}
      </div>
    );
  } else {
    question = installError ? "Kurulum tamamlanamadı" : created ? "Dünyan hazır" : "Dünyan kuruluyor";
    sub = installError
      ? installError
      : created
        ? created.loader === "fabric"
          ? "İlk açılışta mod desteği için birkaç küçük dosya daha iner."
          : "Başlat'a bastığında arkadaşın katılabilir."
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
              {qIndex === 0 ? "Vazgeç" : "Geri"}
            </Button>
            <Button variant="primary" size="lg" icon={ArrowRight} iconRight disabled={!canNext} onClick={next}>
              {step === lastStep ? "Kur" : "Devam"}
            </Button>
          </>
        ) : installError ? (
          <>
            <Button icon={ArrowLeft} onClick={() => setStep(lastStep)}>
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
