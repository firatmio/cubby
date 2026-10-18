/**
 * `server.properties` ayarlarının arayüzdeki karşılığı: grup, kontrol türü ve sınırlar. Adlar ve
 * açıklamalar `i18n`'de (`props.keys`). Burada olmayan bir ayar (modlardan ya da yeni sürümlerden)
 * "Diğer"de düz metin olarak görünür.
 */

export type Group = "game" | "world" | "players" | "performance" | "network" | "resourcePack" | "admin" | "other";

export const GROUPS: Group[] = ["game", "world", "players", "performance", "network", "resourcePack", "admin", "other"];

export type Unit = "blocks" | "chunks" | "seconds" | "minutes" | "ms" | "percent" | "bytes" | "packets";

export type Kind =
  | { type: "bool" }
  | { type: "number"; min?: number; max?: number; unit?: Unit }
  | { type: "enum"; options: string[] }
  | { type: "text"; secret?: boolean; mono?: boolean };

export type Spec = { group: Group; kind: Kind };

const bool = (group: Group): Spec => ({ group, kind: { type: "bool" } });
const num = (group: Group, min?: number, max?: number, unit?: Unit): Spec => ({
  group,
  kind: { type: "number", min, max, unit },
});
const choice = (group: Group, options: string[]): Spec => ({ group, kind: { type: "enum", options } });
const text = (group: Group, extra: { secret?: boolean; mono?: boolean } = {}): Spec => ({
  group,
  kind: { type: "text", ...extra },
});
const PORT = [1, 65535] as const;
const LEVELS = ["1", "2", "3", "4"];

export const SCHEMA: Record<string, Spec> = {
  // Oyun
  gamemode: choice("game", ["survival", "creative", "adventure", "spectator"]),
  difficulty: choice("game", ["peaceful", "easy", "normal", "hard"]),
  hardcore: bool("game"),
  pvp: bool("game"),
  "force-gamemode": bool("game"),
  "allow-flight": bool("game"),
  "max-players": num("game", 1, 1000),
  "spawn-protection": num("game", 0, 1000, "blocks"),
  "player-idle-timeout": num("game", 0, 1440, "minutes"),
  "pause-when-empty-seconds": num("game", -1, 86400, "seconds"),

  // Dünya
  "level-name": text("world"),
  "level-seed": text("world", { mono: true }),
  "level-type": choice("world", ["minecraft:normal", "minecraft:flat", "minecraft:large_biomes", "minecraft:amplified"]),
  "generate-structures": bool("world"),
  "generator-settings": text("world", { mono: true }),
  "max-world-size": num("world", 1, 29999984, "blocks"),
  "initial-enabled-packs": text("world", { mono: true }),
  "initial-disabled-packs": text("world", { mono: true }),
  "region-file-compression": choice("world", ["deflate", "lz4", "none"]),

  // Oyuncular ve sohbet
  motd: text("players"),
  "online-mode": bool("players"),
  "white-list": bool("players"),
  "enforce-whitelist": bool("players"),
  "enforce-secure-profile": bool("players"),
  "enable-status": bool("players"),
  "hide-online-players": bool("players"),
  "chat-spam-threshold-seconds": num("players", 0, 3600, "seconds"),
  "command-spam-threshold-seconds": num("players", 0, 3600, "seconds"),
  "log-ips": bool("players"),
  "enable-code-of-conduct": bool("players"),
  "bug-report-link": text("players", { mono: true }),

  // Performans
  "view-distance": num("performance", 2, 32, "chunks"),
  "simulation-distance": num("performance", 2, 32, "chunks"),
  "entity-broadcast-range-percentage": num("performance", 10, 1000, "percent"),
  "sync-chunk-writes": bool("performance"),
  "max-tick-time": num("performance", -1, 600000, "ms"),
  "max-chained-neighbor-updates": num("performance", -1, 100000000),
  "network-compression-threshold": num("performance", -1, 65535, "bytes"),
  "rate-limit": num("performance", 0, 100000, "packets"),

  // Ağ
  "server-port": num("network", ...PORT),
  "server-ip": text("network", { mono: true }),
  "accepts-transfers": bool("network"),
  "prevent-proxy-connections": bool("network"),
  "use-native-transport": bool("network"),

  // Kaynak paketi
  "resource-pack": text("resourcePack", { mono: true }),
  "resource-pack-sha1": text("resourcePack", { mono: true }),
  "resource-pack-id": text("resourcePack", { mono: true }),
  "resource-pack-prompt": text("resourcePack"),
  "require-resource-pack": bool("resourcePack"),

  // Yönetim ve uzaktan erişim
  "op-permission-level": choice("admin", LEVELS),
  "function-permission-level": choice("admin", LEVELS),
  "broadcast-console-to-ops": bool("admin"),
  "broadcast-rcon-to-ops": bool("admin"),
  "enable-rcon": bool("admin"),
  "rcon.port": num("admin", ...PORT),
  "rcon.password": text("admin", { secret: true }),
  "enable-query": bool("admin"),
  "query.port": num("admin", ...PORT),
  "enable-jmx-monitoring": bool("admin"),
  "management-server-enabled": bool("admin"),
  "management-server-host": text("admin", { mono: true }),
  "management-server-port": num("admin", 0, 65535),
  "management-server-secret": text("admin", { secret: true }),
  "management-server-allowed-origins": text("admin", { mono: true }),
  "management-server-tls-enabled": bool("admin"),
  "management-server-tls-keystore": text("admin", { mono: true }),
  "management-server-tls-keystore-password": text("admin", { secret: true }),
  "status-heartbeat-interval": num("admin", 0, 86400, "seconds"),
  "text-filtering-config": text("admin", { mono: true }),
  "text-filtering-version": choice("admin", ["0", "1"]),
};

export const specOf = (key: string): Spec => SCHEMA[key] ?? { group: "other", kind: { type: "text", mono: true } };

/** Sayı geçerli mi (boş da geçersiz). */
export function validNumber(value: string, kind: Extract<Kind, { type: "number" }>): boolean {
  if (!/^-?\d+$/.test(value.trim())) return false;
  const n = Number(value);
  return (kind.min === undefined || n >= kind.min) && (kind.max === undefined || n <= kind.max);
}
