import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Folder,
  Globe,
  MemoryStick,
  Play,
  Settings,
  Square,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { api, errorMessage, openExternal } from "../lib/api";
import { describeInstance } from "../lib/format";
import { useAppStore, useServer } from "../store/appStore";
import { StatusBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Card";
import { Dialog } from "../ui/Dialog";
import { ServerAvatar } from "../ui/ServerAvatar";
import { Tabs } from "../ui/Tabs";
import { ConsoleTab } from "./instance/ConsoleTab";
import { FilesTab } from "./instance/FilesTab";
import { JavaDownloadProgress } from "./instance/JavaDownloadProgress";
import { PlaceholderTab } from "./instance/PlaceholderTab";
import { SettingsTab } from "./instance/SettingsTab";
import styles from "./InstanceScreen.module.css";

type Tab = "console" | "players" | "settings" | "connection" | "files";

const TABS = [
  { id: "console" as const, label: "Konsol", icon: Terminal },
  { id: "players" as const, label: "Oyuncular", icon: Users },
  { id: "settings" as const, label: "Ayarlar", icon: Settings },
  { id: "connection" as const, label: "Bağlantı", icon: Globe },
  { id: "files" as const, label: "Dosyalar", icon: Folder },
];

const EULA_URL = "https://aka.ms/MinecraftEULA";

const gb = (mb: number) => (mb / 1024).toFixed(1).replace(/\.0$/, "");

export function InstanceScreen({ id }: { id: string }) {
  const instance = useAppStore((s) => s.instances.find((i) => i.id === id));
  const server = useServer(id);

  const [tab, setTab] = useState<Tab>("console");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [eulaOpen, setEulaOpen] = useState(false);
  /** Uygun Java yoksa indirme önerisi: gereken major. */
  const [javaPrompt, setJavaPrompt] = useState<number | null>(null);
  const [javaInstalling, setJavaInstalling] = useState(false);

  // Sayfa yenilenirse (geliştirme sırasında) konsolu Rust'taki kayıttan geri yükle.
  useEffect(() => {
    if (useAppStore.getState().servers[id]) return;
    api
      .serverSnapshot(id)
      .then((snap) => useAppStore.getState().hydrateServer(id, snap))
      .catch(console.error);
  }, [id]);

  if (!instance) {
    return <EmptyState icon={AlertTriangle} title="Sunucu bulunamadı" />;
  }

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      if (!(await api.eulaStatus(id))) {
        setEulaOpen(true);
        return;
      }
      const java = await api.instanceJava(id);
      if (java.error) {
        setError(`${java.error} Ayarlar sekmesinden Java seçimini değiştirebilirsin.`);
        return;
      }
      if (!java.selected) {
        setJavaPrompt(java.required);
        return;
      }
      await api.startServer(id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const acceptEula = async () => {
    setEulaOpen(false);
    try {
      await api.acceptEula(id);
      await start();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const installJavaAndStart = async (major: number) => {
    setJavaInstalling(true);
    useAppStore.getState().setJavaProgress(null);
    try {
      await api.installJava(major);
      setJavaPrompt(null);
      await start();
    } catch (e) {
      setJavaPrompt(null);
      setError(errorMessage(e));
    } finally {
      setJavaInstalling(false);
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await api.stopServer(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const { status, stats } = server;
  const active = status === "starting" || status === "running" || status === "stopping";

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <ServerAvatar size={48} />
        <div className={styles.title}>
          <h1>{instance.name}</h1>
          <p className={styles.meta}>{describeInstance(instance)}</p>
        </div>
        <div className={styles.state}>
          <StatusBadge status={status} />
          {stats && (
            <span className={styles.stats}>
              <span>
                <Cpu size={13} aria-hidden /> %{stats.cpu.toFixed(0)}
              </span>
              <span>
                <MemoryStick size={13} aria-hidden /> {gb(stats.memMb)} / {gb(instance.ramMaxMb)} GB
              </span>
            </span>
          )}
        </div>
        {active ? (
          <Button
            variant="danger"
            size="lg"
            icon={Square}
            loading={status === "stopping"}
            onClick={stop}
            className={styles.power}
          >
            {status === "stopping" ? "Durduruluyor" : "Durdur"}
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon={Play} loading={starting} onClick={start} className={styles.power}>
            Başlat
          </Button>
        )}
      </header>

      {(error || status === "crashed") && (
        <div className={styles.banner} role="alert">
          <AlertTriangle size={16} aria-hidden />
          <span>{error ?? "Sunucu beklenmedik şekilde kapandı. Konsoldaki son satırlara göz at."}</span>
          {error && (
            <button type="button" className={styles.bannerClose} aria-label="Kapat" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div className={styles.tabs}>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>
      <div className={styles.tabBody}>
        {tab === "console" && <ConsoleTab id={id} status={status} logs={server.logs} />}
        {tab === "players" && (
          <PlaceholderTab icon={Users} text="Çevrimiçi oyuncular, beyaz liste ve yetkili (op) yönetimi burada olacak." />
        )}
        {tab === "settings" && <SettingsTab instance={instance} status={status} />}
        {tab === "connection" && (
          <PlaceholderTab icon={Globe} text="Yerel ağ adresi ve internetten katılım (playit.gg / UPnP) burada olacak." />
        )}
        {tab === "files" && <FilesTab instance={instance} />}
      </div>

      {javaPrompt !== null && (
        <Dialog
          title="Java gerekli"
          actions={
            javaInstalling ? undefined : (
              <>
                <Button variant="ghost" onClick={() => setJavaPrompt(null)}>
                  Vazgeç
                </Button>
                <Button variant="primary" onClick={() => installJavaAndStart(javaPrompt)}>
                  İndir ve başlat
                </Button>
              </>
            )
          }
        >
          {javaInstalling ? (
            <JavaDownloadProgress />
          ) : (
            <>
              <p>Bu sunucu Java {javaPrompt} istiyor ama bilgisayarında uygun bir Java bulunamadı.</p>
              <p>
                Açık kaynak Eclipse Temurin'i (yaklaşık 50 MB) uygulamanın kendi klasörüne indirebilirim. Sistemine
                kurulmaz, başka programları etkilemez.
              </p>
            </>
          )}
        </Dialog>
      )}

      {eulaOpen && (
        <Dialog
          title="Minecraft EULA"
          actions={
            <>
              <Button variant="ghost" onClick={() => setEulaOpen(false)}>
                Vazgeç
              </Button>
              <Button variant="primary" onClick={acceptEula}>
                Kabul ediyorum
              </Button>
            </>
          }
        >
          <p>
            Sunucuyu çalıştırmak için Mojang'ın Son Kullanıcı Lisans Sözleşmesi'ni (EULA) kabul etmen gerekiyor. Bu
            sunucu için yalnızca bir kez soracağız.
          </p>
          <p>
            <a
              href={EULA_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternal(EULA_URL);
              }}
            >
              EULA'yı oku
            </a>
          </p>
        </Dialog>
      )}
    </div>
  );
}
