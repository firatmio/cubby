import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { describeInstance } from "../../lib/format";
import { useAppStore, useSelected, useServer } from "../../store/appStore";
import { PillTabs } from "../../ui/PillTabs";
import { Sheet } from "../../ui/Sheet";
import { ConsoleTab } from "../instance/ConsoleTab";
import { FilesTab } from "../instance/FilesTab";
import { JavaSection } from "../instance/JavaSection";
import { PropertiesTab } from "./PropertiesTab";
import { WorldTab } from "./WorldTab";
import styles from "./AdvancedSheet.module.css";

type Tab = "console" | "world" | "properties" | "java" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "console", label: "Konsol" },
  { id: "world", label: "Dünya" },
  { id: "properties", label: "Tüm ayarlar" },
  { id: "java", label: "Java" },
  { id: "files", label: "Dosyalar" },
];

/** Teknik her şey burada: konsol, bellek, Java, dosyalar. Ana ekranı sade tutar. */
export function AdvancedSheet() {
  const open = useAppStore((s) => s.sheet === "advanced");
  const openSheet = useAppStore((s) => s.openSheet);
  const instance = useSelected();
  const server = useServer(instance?.id ?? null);
  const [tab, setTab] = useState<Tab>("console");

  return (
    <Sheet
      open={open && !!instance}
      title="Gelişmiş"
      subtitle={instance ? `${instance.name} · ${describeInstance(instance)}` : undefined}
      onClose={() => openSheet(null)}
      width={620}
    >
      {instance && (
        <>
          <PillTabs tabs={TABS} active={tab} onChange={setTab} layoutId="advanced-tab" />
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              className={styles.body}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {tab === "console" && <ConsoleTab id={instance.id} status={server.status} logs={server.logs} />}
              {tab === "world" && <WorldTab key={instance.id} instance={instance} status={server.status} />}
              {tab === "properties" && (
                <PropertiesTab key={instance.id} instance={instance} status={server.status} />
              )}
              {tab === "java" && <JavaSection instance={instance} />}
              {tab === "files" && <FilesTab instance={instance} />}
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </Sheet>
  );
}
