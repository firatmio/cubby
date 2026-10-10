import { useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { useAppStore, useSelected, useSelectedJoined } from "../../store/appStore";
import { JoinedActions, JoinedCards, JoinedHero } from "../join/JoinedHome";
import { ActionBar } from "./ActionBar";
import { EmptyHome } from "./EmptyHome";
import { Hero } from "./Hero";
import { InfoCards } from "./InfoCards";
import { TileRow } from "./TileRow";
import styles from "./HomeScreen.module.css";

/** Ana ekran: üstte dünyalar, solda seçili dünyanın kimliği, sağ altta ana eylem. */
export function HomeScreen() {
  const instances = useAppStore((s) => s.instances);
  const joinedCount = useAppStore((s) => s.joined.length);
  const selected = useSelected();
  const joined = useSelectedJoined();

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

  if ((instances.length === 0 && joinedCount === 0) || (!selected && !joined)) return <EmptyHome />;

  return (
    <div className={styles.home}>
      <TileRow />
      <div className={styles.hero}>
        <AnimatePresence mode="wait">
          {selected ? (
            <Hero key={selected.id} instance={selected} />
          ) : (
            joined && <JoinedHero key={joined.world.id} view={joined} />
          )}
        </AnimatePresence>
      </div>
      <div className={styles.bottom}>
        <AnimatePresence mode="wait">
          {selected ? (
            <InfoCards key={selected.id} instance={selected} />
          ) : (
            joined && <JoinedCards key={joined.world.id} view={joined} />
          )}
        </AnimatePresence>
        {selected ? (
          <ActionBar key={`a-${selected.id}`} instance={selected} />
        ) : (
          joined && <JoinedActions key={`a-${joined.world.id}`} view={joined} />
        )}
      </div>
    </div>
  );
}
