import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import grassIcon from "../assets/textures/grass_side.png";
import { McButton } from "../components/McButton";
import { McModal } from "../components/McModal";
import { McTabs } from "../components/McTabs";
import { StatusLamp } from "../components/StatusLamp";
import { api, errorMessage } from "../lib/api";
import { describeInstance } from "../lib/format";
import { useAppStore, useServer } from "../store/appStore";
import { ConsoleTab } from "./instance/ConsoleTab";
import { FilesTab } from "./instance/FilesTab";
import { PlaceholderTab } from "./instance/PlaceholderTab";
import { SettingsTab } from "./instance/SettingsTab";
import styles from "./InstanceScreen.module.css";

type Tab = "console" | "players" | "settings" | "connection" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "console", label: "Konsol" },
  { id: "players", label: "Oyuncular" },
  { id: "settings", label: "Ayarlar" },
  { id: "connection", label: "Bağlantı" },
  { id: "files", label: "Dosyalar" },
];

const EULA_URL = "https://aka.ms/MinecraftEULA";

export function InstanceScreen({ id }: { id: string }) {
  const instance = useAppStore((s) => s.instances.find((i) => i.id === id));
  const navigate = useAppStore((s) => s.navigate);
  const server = useServer(id);

  const [tab, setTab] = useState<Tab>("console");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [eulaOpen, setEulaOpen] = useState(false);

  // Sayfa yenilenirse (geliştirme sırasında) konsolu Rust'taki kayıttan geri yükle.
  useEffect(() => {
    if (useAppStore.getState().servers[id]) return;
    api
      .serverSnapshot(id)
      .then((snap) => useAppStore.getState().hydrateServer(id, snap))
      .catch(console.error);
  }, [id]);

  if (!instance) {
    return (
      <div className={styles.missing}>
        <p>Sunucu bulunamadı.</p>
        <McButton onClick={() => navigate({ name: "home" })}>Ana Sayfa</McButton>
      </div>
    );
  }

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      if (!(await api.eulaStatus(id))) {
        setEulaOpen(true);
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
        <McButton onClick={() => navigate({ name: "home" })}>‹ Geri</McButton>
        <img src={grassIcon} alt="" className={styles.icon} />
        <div className={styles.title}>
          <h2>{instance.name}</h2>
          <span className={styles.meta}>{describeInstance(instance)}</span>
        </div>
        <div className={styles.state}>
          <StatusLamp status={status} />
          <span className={styles.stats}>
            {stats ? `CPU ${stats.cpu.toFixed(0)}% · RAM ${stats.memMb} / ${instance.ramMaxMb} MB` : " "}
          </span>
        </div>
        {active ? (
          <McButton variant="red" size="lg" disabled={status === "stopping"} onClick={stop}>
            {status === "stopping" ? "Durduruluyor…" : "Durdur"}
          </McButton>
        ) : (
          <McButton variant="green" size="lg" disabled={starting} onClick={start}>
            Başlat
          </McButton>
        )}
      </header>

      {error && (
        <div className={styles.banner} role="alert">
          <span>{error}</span>
          <McButton onClick={() => setError(null)}>Tamam</McButton>
        </div>
      )}
      {status === "crashed" && !error && (
        <div className={styles.banner} role="alert">
          <span>Sunucu beklenmedik şekilde kapandı. Konsoldaki son satırlara göz at.</span>
        </div>
      )}

      <McTabs tabs={TABS} active={tab} onChange={setTab} />
      <div className={styles.tabBody}>
        {tab === "console" && <ConsoleTab id={id} status={status} logs={server.logs} />}
        {tab === "players" && (
          <PlaceholderTab text="Çevrimiçi oyuncular, whitelist ve op yönetimi burada olacak." />
        )}
        {tab === "settings" && <SettingsTab instance={instance} status={status} />}
        {tab === "connection" && (
          <PlaceholderTab text="LAN adresi ve internetten katılım (playit.gg / UPnP) burada olacak." />
        )}
        {tab === "files" && <FilesTab instance={instance} />}
      </div>

      {eulaOpen && (
        <McModal
          title="Minecraft EULA"
          actions={
            <>
              <McButton onClick={() => setEulaOpen(false)}>Vazgeç</McButton>
              <McButton variant="green" onClick={acceptEula}>
                Kabul Ediyorum
              </McButton>
            </>
          }
        >
          <p>
            Sunucuyu çalıştırmak için Mojang'ın Son Kullanıcı Lisans Sözleşmesi'ni (EULA) kabul etmen
            gerekiyor. Bu sunucu için yalnızca bir kez soracağız.
          </p>
          <p>
            <a
              href={EULA_URL}
              onClick={(e) => {
                e.preventDefault();
                openUrl(EULA_URL).catch(console.error);
              }}
            >
              EULA'yı oku
            </a>
          </p>
        </McModal>
      )}
    </div>
  );
}
