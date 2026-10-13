import { useEffect, useState, type RefObject } from "react";
import type { ContentKind, ModHit, ModSearch } from "../../lib/api";
import { useT } from "../../i18n";
import { categoryLabels } from "../../lib/format";
import { peek } from "../../lib/queryCache";
import { Featured } from "./Featured";
import { Shelf, type ShelfDef } from "./Shelf";
import { searchItems, searchKey, type ContentActions } from "./useBrowse";
import styles from "./Discover.module.css";

/** Türe göre raflar (Modrinth kategori anahtarları), sırayla. Popüler ve Yeni güncellenen hepsinde başta. */
const SHELVES: Record<ContentKind, string[]> = {
  mod: ["optimization", "utility", "adventure", "technology", "magic", "decoration", "storage", "food", "worldgen", "mobs", "equipment", "transportation"],
  resourcePack: ["vanilla-like", "realistic", "simplistic", "themed", "gui", "fonts", "combat", "decoration"],
  shader: ["realistic", "semi-realistic", "fantasy", "cartoon", "vanilla-like", "potato", "low"],
  dataPack: ["adventure", "worldgen", "game-mechanics", "utility", "magic", "mobs"],
  modpack: ["adventure", "technology", "magic", "quests", "challenging", "lightweight", "kitchen-sink", "multiplayer"],
};
const PLUGIN_SHELVES = ["management", "economy", "social", "minigame", "utility", "game-mechanics", "optimization"];
/** Öne çıkan bandında en fazla kaç proje. */
const FEATURED = 5;

type Props = {
  world: string;
  kind: ContentKind;
  plugin: boolean;
  scrollRoot: RefObject<HTMLElement | null>;
  selectedId: string | null;
  actions: ContentActions;
  onOpen: (hit: ModHit) => void;
  onPrefetch: (projectId: string) => void;
  onSeeAll: (def: ShelfDef) => void;
  onLoaded: (hits: ModHit[]) => void;
};

/** Vitrin: öne çıkan bandı + kategori rafları. Raflar ekrana yaklaştıkça yüklenir. */
export function Showcase({ world, kind, plugin, scrollRoot, selectedId, actions, onOpen, onPrefetch, onSeeAll, onLoaded }: Props) {
  const t = useT().discover;
  const labels = categoryLabels(kind);
  const all = useT().categories;
  const [popular, setPopular] = useState<ModHit[]>(
    () => peek<ModSearch>(searchKey(world, kind, "", null, "downloads", 0))?.hits ?? [],
  );

  useEffect(() => {
    let live = true;
    searchItems(world, kind, "", null, "downloads", 0)
      .then((r) => live && setPopular(r.hits))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [world, kind]);

  const defs: ShelfDef[] = [
    { key: "popular", title: t.shelfPopular, category: null, sort: "downloads" },
    { key: "updated", title: t.shelfUpdated, category: null, sort: "updated" },
    ...(plugin ? PLUGIN_SHELVES : SHELVES[kind]).map((c) => ({
      key: c,
      title: labels[c] ?? all[c] ?? c,
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
        showNeed={kind === "mod"}
        isInstalled={actions.isInstalled}
        installing={installing}
        busy={actions.busy !== null}
        onInstall={kind === "modpack" ? undefined : actions.install}
        onOpen={onOpen}
      />
      {defs.map((d) => (
        <Shelf
          key={d.key}
          world={world}
          kind={kind}
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
