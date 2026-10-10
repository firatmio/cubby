import { useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { useAppStore, useSelected } from "../../store/appStore";
import { ActionBar } from "./ActionBar";
import { EmptyHome } from "./EmptyHome";
import { Hero } from "./Hero";
import { InfoCards } from "./InfoCards";
import { TileRow } from "./TileRow";
import styles from "./HomeScreen.module.css";

/** Ana ekran: üstte dünyalar, solda seçili dünyanın kimliği, sağ altta ana eylem. */
export function HomeScreen() {
  const instances = useAppStore((s) => s.instances);
  const selected = useSelected();

  // ←/→ ile dünyalar arasında gezin (panel açıkken ya da yazı yazarken değil).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useAppStore.getState();
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if (st.sheet || typing) return;
      if (e.key === "ArrowRight") st.selectStep(1);
      if (e.key === "ArrowLeft") st.selectStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (instances.length === 0 || !selected) return <EmptyHome />;

  return (
    <div className={styles.home}>
      <TileRow />
      <div className={styles.hero}>
        <AnimatePresence mode="wait">
          <Hero key={selected.id} instance={selected} />
        </AnimatePresence>
      </div>
      <div className={styles.bottom}>
        <AnimatePresence mode="wait">
          <InfoCards key={selected.id} instance={selected} />
        </AnimatePresence>
        <ActionBar key={`a-${selected.id}`} instance={selected} />
      </div>
    </div>
  );
}
