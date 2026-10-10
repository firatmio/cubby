import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Plug,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import {
  api,
  errorMessage,
  mediaUrl,
  openExternal,
  type InstalledMod,
  type ModDetail,
  type ModHit,
  type ModSort,
} from "../../lib/api";
import { MOD_CATEGORY_LABELS, compactCount, formatBytesMb } from "../../lib/format";
import { spring } from "../../lib/motion";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { PillTabs } from "../../ui/PillTabs";
import { Progress } from "../../ui/Progress";
import { Sheet } from "../../ui/Sheet";
import styles from "./ModsSheet.module.css";

type Tab = "browse" | "installed";

const SORTS: { id: ModSort; label: string }[] = [
  { id: "downloads", label: "Popüler" },
  { id: "relevance", label: "En uygun" },
  { id: "updated", label: "Güncel" },
];

function ModIcon({ icon, plugin }: { icon: string | null; plugin: boolean }) {
  const [failed, setFailed] = useState(false);
  const Fallback = plugin ? Plug : Puzzle;
  return (
    <span className={styles.icon}>
      {icon && !failed ? (
        <img src={mediaUrl(icon)} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <Fallback size={20} aria-hidden />
      )}
    </span>
  );
}

function InstallProgress() {
  const p = useAppStore((s) => s.modProgress);
  if (!p) return <Progress value={null} />;
  return (
    <div className={styles.progress}>
      <Progress value={p.total ? p.downloaded / p.total : null} />
      <span>
        {p.title} indiriliyor · {formatBytesMb(p.downloaded)}
        {p.total ? ` / ${formatBytesMb(p.total)}` : ""} MB
      </span>
    </div>
  );
}

/** Mod/eklenti mağazası (Modrinth): keşfet, ayrıntı, kurulu olanlar. */
export function ModsSheet() {
  const open = useAppStore((s) => s.sheet === "mods");
  const openSheet = useAppStore((s) => s.openSheet);
  const setModProgress = useAppStore((s) => s.setModProgress);
  const instance = useSelected();
  const { status } = useServer(instance?.id ?? null);
  const id = instance?.id;
  const plugin = instance?.loader === "paper";
  const noun = plugin ? "eklenti" : "mod";
  const active = status === "running" || status === "starting";

  const [tab, setTab] = useState<Tab>("browse");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<ModSort>("downloads");
  const [hits, setHits] = useState<ModHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<ModDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [installed, setInstalled] = useState<InstalledMod[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const searchSeq = useRef(0);

  const search = useCallback(
    async (offset: number) => {
      if (!id) return;
      const seq = ++searchSeq.current;
      setLoading(true);
      setError(null);
      try {
        const r = await api.modsSearch(id, query, category, sort, offset);
        if (seq !== searchSeq.current) return;
        setHits((h) => (offset === 0 ? r.hits : [...h, ...r.hits]));
        setTotal(r.total);
      } catch (e) {
        if (seq === searchSeq.current) setError(errorMessage(e));
      } finally {
        if (seq === searchSeq.current) setLoading(false);
      }
    },
    [id, query, category, sort],
  );

  // Yazarken her tuşta değil, 350 ms durunca ara.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(0), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [open, search, query]);

  const loadInstalled = useCallback(() => {
    if (!id) return;
    api
      .modsInstalled(id)
      .then(setInstalled)
      .catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setChanged(false);
    loadInstalled();
  }, [open, id, loadInstalled]);

  const run = async (key: string, fn: () => Promise<InstalledMod[]>) => {
    if (!id) return;
    setBusy(key);
    setError(null);
    setModProgress(null);
    try {
      const list = await fn();
      setInstalled(list);
      const ids = new Set(list.map((m) => m.projectId));
      setHits((h) => h.map((x) => ({ ...x, installed: ids.has(x.projectId) })));
      setDetail((d) => (d ? { ...d, installed: ids.has(d.projectId) } : d));
      setChanged(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setModProgress(null);
    }
  };

  const install = (projectId: string) => run(`install:${projectId}`, () => api.modsInstall(id!, projectId));

  const openDetail = async (projectId: string) => {
    if (!id) return;
    setDetailLoading(projectId);
    setError(null);
    try {
      setDetail(await api.modsProject(id, projectId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setDetailLoading(null);
    }
  };

  const restart = async () => {
    if (!id) return;
    setBusy("restart");
    try {
      await api.stopServer(id);
      await api.startServer(id);
      setChanged(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const updates = installed?.filter((m) => m.update).length ?? 0;
  const tabs = [
    { id: "browse" as const, label: "Keşfet" },
    { id: "installed" as const, label: `Kurulu${installed ? ` (${installed.length})` : ""}` },
  ];

  return (
    <Sheet
      open={open && !!instance && instance.loader !== "vanilla"}
      title={plugin ? "Eklentiler" : "Modlar"}
      subtitle={instance ? `${instance.name} · Minecraft ${instance.mcVersion} · Modrinth` : undefined}
      onClose={() => openSheet(null)}
      width={720}
    >
      <div className={styles.root}>
        <PillTabs tabs={tabs} active={tab} onChange={setTab} layoutId="mods-tab" />

        <AnimatePresence>
          {changed && active && (
            <motion.div
              className={styles.restart}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring}
            >
              <span>Değişiklikler dünya yeniden açılınca geçerli olur.</span>
              <Button size="sm" variant="primary" icon={RotateCcw} loading={busy === "restart"} onClick={restart}>
                Şimdi yeniden başlat
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <p className={styles.error}>{error}</p>}
        {busy?.startsWith("install:") || busy?.startsWith("update") ? <InstallProgress /> : null}

        {tab === "browse" &&
          (detail ? (
            <DetailView
              detail={detail}
              plugin={plugin}
              busy={busy}
              onBack={() => setDetail(null)}
              onInstall={() => install(detail.projectId)}
            />
          ) : (
            <div className={styles.browse}>
              <div className={styles.toolbar}>
                <div className={styles.search}>
                  <Search size={17} aria-hidden />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={plugin ? "Eklenti ara" : "Mod ara"}
                    aria-label="Ara"
                  />
                </div>
                <PillTabs tabs={SORTS} active={sort} onChange={setSort} layoutId="mods-sort" />
              </div>
              <div
                className={styles.chips}
                // Dikey tekerlek de yatay kaydırsın.
                onWheel={(e) => {
                  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
                }}
              >
                <button
                  type="button"
                  className={[styles.chip, category === null && styles.chipOn].filter(Boolean).join(" ")}
                  onClick={() => setCategory(null)}
                >
                  Tümü
                </button>
                {Object.entries(MOD_CATEGORY_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={[styles.chip, category === key && styles.chipOn].filter(Boolean).join(" ")}
                    onClick={() => setCategory(category === key ? null : key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={styles.list}>
                {hits.map((h) => (
                  <div key={h.projectId} className={styles.row}>
                    <button type="button" className={styles.rowMain} onClick={() => openDetail(h.projectId)}>
                      <ModIcon icon={h.icon} plugin={plugin} />
                      <span className={styles.text}>
                        <span className={styles.title}>
                          {h.title}
                          {h.clientSide === "required" && <Badge tone="warning">Arkadaşın da kurmalı</Badge>}
                        </span>
                        <span className={styles.desc}>{h.description}</span>
                        <span className={styles.meta}>{compactCount(h.downloads)} indirme</span>
                      </span>
                    </button>
                    {h.installed ? (
                      <span className={styles.installed}>
                        <Check size={15} aria-hidden /> Kurulu
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        icon={Download}
                        loading={busy === `install:${h.projectId}` || detailLoading === h.projectId}
                        disabled={busy !== null}
                        onClick={() => install(h.projectId)}
                      >
                        Kur
                      </Button>
                    )}
                  </div>
                ))}
                {!loading && hits.length === 0 && !error && (
                  <p className={styles.empty}>Bu sürüm için uygun {noun} bulunamadı.</p>
                )}
                {loading && <Progress value={null} />}
                {!loading && hits.length < total && (
                  <Button variant="ghost" className={styles.more} onClick={() => search(hits.length)}>
                    Daha fazla göster
                  </Button>
                )}
              </div>
            </div>
          ))}

        {tab === "installed" && (
          <div className={styles.list}>
            {installed === null ? (
              <Progress value={null} />
            ) : installed.length === 0 ? (
              <p className={styles.empty}>Henüz {noun} kurulu değil. Keşfet'ten bir tane seç.</p>
            ) : (
              <>
                {updates > 0 && (
                  <div className={styles.updateBar}>
                    <span>{updates} güncelleme var</span>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={RefreshCw}
                      loading={busy === "update-all"}
                      disabled={busy !== null}
                      onClick={() => run("update-all", () => api.modsUpdateAll(id!))}
                    >
                      Tümünü güncelle
                    </Button>
                  </div>
                )}
                {installed.map((m) => (
                  <div key={m.file} className={styles.row}>
                    <div className={styles.rowMain}>
                      <ModIcon icon={m.icon} plugin={plugin} />
                      <span className={styles.text}>
                        <span className={styles.title}>
                          {m.title}
                          {m.dependency && <Badge>Bağımlılık</Badge>}
                          {!m.known && <Badge>Elle eklenmiş</Badge>}
                          {m.clientSide === "required" && <Badge tone="warning">Arkadaşın da kurmalı</Badge>}
                        </span>
                        <span className={styles.meta}>
                          {m.versionNumber ?? m.file}
                          {m.update && <span className={styles.update}> → {m.update} hazır</span>}
                        </span>
                      </span>
                    </div>
                    {m.update && (
                      <Button
                        size="sm"
                        icon={RefreshCw}
                        loading={busy === `update:${m.file}`}
                        disabled={busy !== null}
                        onClick={() => run(`update:${m.file}`, () => api.modsUpdate(id!, m.file))}
                      >
                        Güncelle
                      </Button>
                    )}
                    <IconButton
                      icon={Trash2}
                      size="sm"
                      variant="ghost"
                      label="Kaldır (Geri Dönüşüm Kutusu'na)"
                      disabled={busy !== null}
                      onClick={() => run(`remove:${m.file}`, () => api.modsRemove(id!, m.file))}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Markdown'u sade metne indirger (görseller ve HTML atılır, linkler metin olarak kalır). */
function plainText(md: string): string {
  return md
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function DetailView({
  detail,
  plugin,
  busy,
  onBack,
  onInstall,
}: {
  detail: ModDetail;
  plugin: boolean;
  busy: string | null;
  onBack: () => void;
  onInstall: () => void;
}) {
  const blocked = !!detail.error || detail.conflicts.length > 0;
  return (
    <motion.div className={styles.detail} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={spring}>
      <Button variant="ghost" size="sm" icon={ArrowLeft} className={styles.back} onClick={onBack}>
        Geri
      </Button>
      <div className={styles.detailHead}>
        <ModIcon icon={detail.icon} plugin={plugin} />
        <div>
          <h3>{detail.title}</h3>
          <p className={styles.desc}>{detail.description}</p>
          <p className={styles.meta}>
            {compactCount(detail.downloads)} indirme{detail.license ? ` · ${detail.license}` : ""}
          </p>
        </div>
      </div>

      <ul className={styles.facts}>
        {detail.versionNumber && (
          <li>
            Kurulacak sürüm: <b>{detail.versionNumber}</b>
            {detail.unstable && <Badge tone="warning">Deneme sürümü</Badge>}
          </li>
        )}
        {detail.with.length > 0 && (
          <li>
            Bununla birlikte kurulacak: <b>{detail.with.map((w) => w.title).join(", ")}</b>
          </li>
        )}
        {detail.clientSide === "required" && (
          <li className={styles.warn}>
            <AlertTriangle size={15} aria-hidden /> Oyuna yeni içerik ekliyor: arkadaşının da kendi Minecraft'ına kurması
            gerekir.
          </li>
        )}
        {detail.missing.length > 0 && (
          <li className={styles.warn}>
            <AlertTriangle size={15} aria-hidden /> Bu sürüm için bulunamayan bağımlılık:{" "}
            {detail.missing.map((m) => m.title).join(", ")}
          </li>
        )}
        {detail.conflicts.length > 0 && (
          <li className={styles.warn}>
            <AlertTriangle size={15} aria-hidden /> Kurulu olan şununla uyumsuz: {detail.conflicts.map((m) => m.title).join(", ")}
          </li>
        )}
        {detail.error && (
          <li className={styles.warn}>
            <AlertTriangle size={15} aria-hidden /> {detail.error}
          </li>
        )}
      </ul>

      <div className={styles.detailActions}>
        <Button variant="ghost" size="sm" icon={ExternalLink} onClick={() => openExternal(detail.url)}>
          Modrinth'te aç
        </Button>
        {detail.installed ? (
          <span className={styles.installed}>
            <Check size={15} aria-hidden /> Kurulu
          </span>
        ) : (
          <Button
            variant="primary"
            icon={Download}
            loading={busy === `install:${detail.projectId}`}
            disabled={blocked || busy !== null}
            onClick={onInstall}
          >
            Kur
          </Button>
        )}
      </div>

      {detail.body && <p className={styles.body}>{plainText(detail.body)}</p>}
    </motion.div>
  );
}
