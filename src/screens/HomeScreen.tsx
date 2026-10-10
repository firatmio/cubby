import grassIcon from "../assets/textures/grass_side.png";
import { McButton } from "../components/McButton";
import { McPanel } from "../components/McPanel";
import { StatusLamp } from "../components/StatusLamp";
import type { Instance } from "../lib/api";
import { LOADER_LABELS, formatRam } from "../lib/format";
import { useAppStore, useServer } from "../store/appStore";
import styles from "./HomeScreen.module.css";

function InstanceCard({ instance }: { instance: Instance }) {
  const navigate = useAppStore((s) => s.navigate);
  const { status } = useServer(instance.id);
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => navigate({ name: "instance", id: instance.id })}
    >
      <img src={grassIcon} alt="" className={styles.icon} />
      <span className={styles.cardText}>
        <span className={styles.cardName}>{instance.name}</span>
        <span className={styles.cardMeta}>
          {LOADER_LABELS[instance.loader]} {instance.mcVersion} · {formatRam(instance.ramMaxMb)}
        </span>
      </span>
      <StatusLamp status={status} />
    </button>
  );
}

export function HomeScreen() {
  const instances = useAppStore((s) => s.instances);
  const navigate = useAppStore((s) => s.navigate);

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.logo}>
          SUNUCU
          <br />
          YÖNETİCİSİ
        </h1>
        <span className={styles.splash}>Kardeşinle oyna!</span>
      </header>

      <McPanel variant="dark" className={styles.list}>
        {instances.length === 0 ? (
          <p className={styles.empty}>Henüz sunucu yok. Hadi bir tane kuralım!</p>
        ) : (
          instances.map((i) => <InstanceCard key={i.id} instance={i} />)
        )}
      </McPanel>

      <div className={styles.actions}>
        <McButton size="lg" onClick={() => navigate({ name: "wizard" })}>
          Yeni Sunucu
        </McButton>
      </div>
    </div>
  );
}
