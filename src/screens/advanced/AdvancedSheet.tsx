import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useT } from "../../i18n";
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

/** Teknik her şey burada: konsol, bellek, Java, dosyalar. Ana ekranı sade tutar. */
export function AdvancedSheet() {
  const open = useAppStore((s) => s.sheet === "advanced");
  const openSheet = useAppStore((s) => s.openSheet);
  const instance = useSelected();
  const server = useServer(instance?.id ?? null);
  const [tab, setTab] = useState<Tab>("console");
  const t = useT();
  const tabs: { id: Tab; label: string }[] = [
    { id: "console", label: t.advanced.tabConsole },
    { id: "world", label: t.advanced.tabWorld },
    { id: "properties", label: t.advanced.tabProperties },
    { id: "java", label: "Java" },
    { id: "files", label: t.advanced.tabFiles },
  ];

  return (
    <Sheet
      open={open && !!instance}
      title={t.advanced.title}
      subtitle={instance ? `${instance.name} · ${describeInstance(instance)}` : undefined}
      onClose={() => openSheet(null)}
      width={620}
    >
      {instance && (
        <>
          <PillTabs tabs={tabs} active={tab} onChange={setTab} layoutId="advanced-tab" />
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
