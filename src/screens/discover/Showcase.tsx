import { useEffect, useState, type RefObject } from "react";
import type { ModHit, ModSearch } from "../../lib/api";
import { useT } from "../../i18n";
import { categoryLabels } from "../../lib/format";
import { peek } from "../../lib/queryCache";
import { Featured } from "./Featured";
import { Shelf, type ShelfDef } from "./Shelf";
import { searchKey, searchMods, type ModActions } from "./useBrowse";
import styles from "./Discover.module.css";

/** Raflardaki kategoriler (Modrinth kategori anahtarları), sırayla. */
const MOD_SHELVES = ["optimization", "utility", "adventure", "technology", "magic", "decoration", "storage", "food", "worldgen", "mobs", "equipment", "transportation"];
const PLUGIN_SHELVES = ["management", "economy", "social", "minigame", "utility", "game-mechanics", "optimization"];
/** Öne çıkan bandında en fazla kaç proje. */
const FEATURED = 5;

type Props = {
  world: string;
  plugin: boolean;
  scrollRoot: RefObject<HTMLElement | null>;
  selectedId: string | null;
  actions: ModActions;
  onOpen: (hit: ModHit) => void;
  onPrefetch: (projectId: string) => void;
  onSeeAll: (def: ShelfDef) => void;
  onLoaded: (hits: ModHit[]) => void;
};

/** Vitrin: öne çıkan bandı + kategori rafları. Raflar ekrana yaklaştıkça yüklenir. */
export function Showcase({ world, plugin, scrollRoot, selectedId, actions, onOpen, onPrefetch, onSeeAll, onLoaded }: Props) {
  const t = useT().discover;
  const labels = categoryLabels();
  const [popular, setPopular] = useState<ModHit[]>(() => peek<ModSearch>(searchKey(world, "", null, "downloads", 0))?.hits ?? []);

  useEffect(() => {
    let live = true;
    searchMods(world, "", null, "downloads", 0)
      .then((r) => live && setPopular(r.hits))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [world]);

  const defs: ShelfDef[] = [
    { key: "popular", title: t.shelfPopular, category: null, sort: "downloads" },
    { key: "updated", title: t.shelfUpdated, category: null, sort: "updated" },
    ...(plugin ? PLUGIN_SHELVES : MOD_SHELVES).map((c) => ({
      key: c,
      title: labels[c] ?? c,
      category: c,
      sort: "downloads" as const,
    })),
  ];
  const installing = actions.busy?.startsWith("install:") ? actions.busy.slice("install:".length) : null;

  return (
    <div className={styles.showcase}>
      <Featured
        hits={popular.filter((h) => h.image).slice(0, FEATURED)}
        plugin={plugin}
        isInstalled={actions.isInstalled}
        installing={installing}
        busy={actions.busy !== null}
        onInstall={actions.install}
        onOpen={onOpen}
      />
      {defs.map((d) => (
        <Shelf
          key={d.key}
          world={world}
          def={d}
          plugin={plugin}
          scrollRoot={scrollRoot}
          selectedId={selectedId}
          isInstalled={actions.isInstalled}
          onOpen={onOpen}
          onPrefetch={onPrefetch}
          onSeeAll={onSeeAll}
          onLoaded={onLoaded}
        />
      ))}
    </div>
  );
}
