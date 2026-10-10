import { Plus } from "lucide-react";
import type { Instance } from "../lib/api";
import { LOADER_LABELS } from "../lib/format";
import { useAppStore, useServer } from "../store/appStore";
import { StatusDot } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ServerAvatar } from "../ui/ServerAvatar";
import styles from "./Sidebar.module.css";

function SidebarItem({ instance, active }: { instance: Instance; active: boolean }) {
  const navigate = useAppStore((s) => s.navigate);
  const { status } = useServer(instance.id);
  return (
    <button
      type="button"
      className={[styles.item, active && styles.active].filter(Boolean).join(" ")}
      aria-current={active ? "page" : undefined}
      onClick={() => navigate({ name: "instance", id: instance.id })}
    >
      <ServerAvatar size={30} />
      <span className={styles.itemText}>
        <span className={styles.itemName}>{instance.name}</span>
        <span className={styles.itemMeta}>
          {LOADER_LABELS[instance.loader]} {instance.mcVersion}
        </span>
      </span>
      <StatusDot status={status} />
    </button>
  );
}

export function Sidebar() {
  const instances = useAppStore((s) => s.instances);
  const view = useAppStore((s) => s.view);
  const navigate = useAppStore((s) => s.navigate);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>Sunucu Yöneticisi</div>

      <div className={styles.sectionLabel}>Sunucular</div>
      <nav className={styles.list}>
        {instances.length === 0 && <p className={styles.none}>Henüz sunucu yok.</p>}
        {instances.map((i) => (
          <SidebarItem key={i.id} instance={i} active={view.name === "instance" && view.id === i.id} />
        ))}
      </nav>

      <div className={styles.footer}>
        <Button
          variant={view.name === "wizard" ? "secondary" : "primary"}
          icon={Plus}
          full
          onClick={() => navigate({ name: "wizard" })}
        >
          Yeni sunucu
        </Button>
      </div>
    </aside>
  );
}
