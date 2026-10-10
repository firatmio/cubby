/**
 * Yalnız geliştirme: uygulama Tauri dışında (düz tarayıcıda) açıldığında `api` ve event'ler
 * buradaki sahte verilerle çalışır. Arayüzü tarayıcıda görmek/denemek için. Prod pakete girmez
 * (`api.ts` içindeki `import.meta.env.DEV` koşulu sayesinde).
 */
import type {
  AccessView,
  Instance,
  JavaInfo,
  LogLine,
  LogStream,
  ServerStatus,
} from "./api";

type Handler = (e: { payload: unknown }) => void;
const listeners = new Map<string, Set<Handler>>();

export async function mockListen(event: string, handler: Handler): Promise<() => void> {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(handler);
  return () => listeners.get(event)?.delete(handler);
}

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h({ payload }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const JAVAS: JavaInfo[] = [
  { path: "C:\\Program Files\\Java\\jdk-27\\bin\\java.exe", major: 27, version: "27", managed: false },
  {
    path: "C:\\Users\\sen\\AppData\\Local\\Packages\\Microsoft.4297127D64EC6_8wekyb3d8bbwe\\LocalCache\\Local\\runtime\\java-runtime-epsilon\\bin\\java.exe",
    major: 25,
    version: "25.0.1",
    managed: false,
  },
  { path: "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot\\bin\\java.exe", major: 17, version: "17.0.19", managed: false },
];

const instances: Instance[] = [
  {
    id: "mock-1",
    name: "Kardeşlerle survival",
    loader: "fabric",
    mcVersion: "26.3",
    loaderVersion: "0.19.5",
    javaPath: null,
    javaMajor: 25,
    ramMinMb: 1024,
    ramMaxMb: 4096,
    port: 25565,
    createdAt: 1,
    cover: { kind: "auto", color: "#8fb7d8", version: 1 },
  },
  {
    id: "mock-2",
    name: "Paper test",
    loader: "paper",
    mcVersion: "26.3",
    loaderVersion: "169",
    javaPath: null,
    javaMajor: 25,
    ramMinMb: 1024,
    ramMaxMb: 2048,
    port: 25566,
    createdAt: 2,
    cover: null,
  },
  {
    id: "mock-3",
    name: "Ada macerası",
    loader: "vanilla",
    mcVersion: "1.21.11",
    loaderVersion: null,
    javaPath: null,
    javaMajor: 21,
    ramMinMb: 1024,
    ramMaxMb: 2048,
    port: 25567,
    createdAt: 3,
    cover: { kind: "manual", color: "#d8a26a", version: 1 },
  },
];

const players: Record<string, string[]> = { "mock-1": ["Ali"] };
const HOUR = 3_600_000;
const shots = Array.from({ length: 7 }, (_, i) => ({
  file: `2026-10-0${(i % 9) + 1}_1${i}.2${i}.0${i}.png`,
  takenAt: Date.now() - (i + 1) * 5 * HOUR,
}));
let settings = { minecraftDir: null as string | null, useScreenshots: true, eulaAccepted: true };

const rejected: Record<string, string[]> = { "mock-1": ["Mehmet"] };
const fakeUuid = (name: string) =>
  `${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, "0")}-0000-3000-8000-000000000000`;

type Access = Omit<AccessView, "notice">;
const access: Record<string, Access> = {
  "mock-1": {
    offlineMode: true,
    whitelistEnabled: true,
    whitelist: ["Sen", "Ali"].map((name) => ({ name, uuid: fakeUuid(name) })),
    ops: ["Sen"],
    known: ["Sen", "Ali", "Mehmet", "Zeynep"],
  },
  "mock-2": { offlineMode: false, whitelistEnabled: false, whitelist: [], ops: [], known: [] },
  "mock-3": { offlineMode: false, whitelistEnabled: true, whitelist: [], ops: [], known: ["firatmio"] },
};
const accessOf = (id: string) =>
  (access[id] ??= { offlineMode: false, whitelistEnabled: false, whitelist: [], ops: [], known: [] });

const BASE_PROPS: Record<string, string> = {
  "accepts-transfers": "false",
  "allow-flight": "false",
  difficulty: "easy",
  "enable-command-block": "false",
  "enforce-whitelist": "false",
  gamemode: "survival",
  hardcore: "false",
  "level-name": "world",
  "level-seed": "",
  "level-type": "minecraft:normal",
  "max-players": "20",
  motd: "A Minecraft Server",
  "online-mode": "true",
  pvp: "true",
  "server-port": "25565",
  "simulation-distance": "10",
  "spawn-protection": "16",
  "view-distance": "10",
  "white-list": "false",
};
const props: Record<string, Record<string, string>> = {};
const propsOf = (id: string) => {
  if (!props[id]) {
    const inst = byId(id);
    const a = accessOf(id);
    props[id] = {
      ...BASE_PROPS,
      motd: inst.name,
      "server-port": String(inst.port),
      "online-mode": String(!a.offlineMode),
      "white-list": String(a.whitelistEnabled),
      "enforce-whitelist": String(a.whitelistEnabled),
    };
  }
  return props[id];
};

function accessView(id: string, notice: string | null = null): AccessView {
  return { ...structuredClone(accessOf(id)), notice };
}

const status: Record<string, ServerStatus> = { "mock-1": "running", "mock-2": "stopped", "mock-3": "stopped" };
const logs: Record<string, LogLine[]> = { "mock-1": [], "mock-2": [], "mock-3": [] };

function log(id: string, line: string, stream: LogStream = "stdout") {
  const entry = { stream, line, ts: Date.now() };
  (logs[id] ??= []).push(entry);
  emit("server://log", { id, ...entry });
}

function setStatus(id: string, s: ServerStatus) {
  status[id] = s;
  emit("server://status", { id, status: s });
}

const time = () => new Date().toLocaleTimeString("tr-TR", { hour12: false });
const info = (msg: string) => `[${time()}] [Server thread/INFO]: ${msg}`;

const BOOT = [
  "Starting minecraft server version 26.3",
  "Loading properties",
  "Default game type: SURVIVAL",
  "Starting Minecraft server on *:25565",
  "Preparing level \"world\"",
  "Preparing spawn area: 0%",
  "Preparing spawn area: 64%",
  'Done (1.786s)! For help, type "help"',
];

for (const l of BOOT) logs["mock-1"].push({ stream: "stdout", line: `[16:20:1${BOOT.indexOf(l) % 10}] [Server thread/INFO]: ${l}`, ts: 0 });
logs["mock-1"].push({ stream: "stdout", line: "[16:21:02] [Server thread/INFO]: Ali joined the game", ts: 0 });
logs["mock-1"].push({ stream: "stdout", line: "[16:21:40] [Server thread/WARN]: Can't keep up! Is the server overloaded?", ts: 0 });
logs["mock-1"].push({ stream: "system", line: "> say merhaba", ts: 0 });
logs["mock-1"].push({ stream: "stdout", line: "[16:22:05] [Server thread/INFO]: [Server] merhaba", ts: 0 });

setInterval(() => {
  for (const [id, s] of Object.entries(status)) {
    if (s === "running") emit("server://stats", { id, cpu: 8 + Math.random() * 10, memMb: 1100 + Math.round(Math.random() * 200) });
  }
}, 2000);

async function boot(id: string) {
  setStatus(id, "starting");
  logs[id] = [];
  for (const l of BOOT) {
    await sleep(250);
    log(id, info(l));
  }
  setStatus(id, "running");
}

async function stop(id: string) {
  setStatus(id, "stopping");
  log(id, info("Stopping server"));
  await sleep(400);
  log(id, info("Saving worlds"));
  await sleep(400);
  log(id, "Sunucu kapandı (çıkış kodu: 0).", "system");
  setStatus(id, "stopped");
}

async function progress(event: string, base: Record<string, unknown>, steps: number) {
  for (let i = 0; i <= steps; i++) {
    await sleep(120);
    emit(event, { ...base, stage: "download", downloaded: i * 3_000_000, total: steps * 3_000_000 });
  }
}

function versions(includeSnapshots: boolean) {
  const list = [
    { id: "26.4-snapshot-3", type: "snapshot", releaseTime: "2026-10-08T10:00:00Z" },
    { id: "26.3", type: "release", releaseTime: "2026-09-16T10:00:00Z" },
    { id: "26.2", type: "release", releaseTime: "2026-06-10T10:00:00Z" },
    { id: "26.1.2", type: "release", releaseTime: "2026-04-01T10:00:00Z" },
    { id: "1.21.11", type: "release", releaseTime: "2025-12-09T10:00:00Z" },
    { id: "1.21.10", type: "release", releaseTime: "2025-10-07T10:00:00Z" },
    { id: "1.20.6", type: "release", releaseTime: "2024-04-29T10:00:00Z" },
    { id: "1.16.5", type: "release", releaseTime: "2021-01-14T10:00:00Z" },
  ];
  return { latestRelease: "26.3", versions: list.filter((v) => includeSnapshots || v.type === "release") };
}

const byId = (id: unknown) => instances.find((i) => i.id === id)!;

export async function mockInvoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
  await sleep(150);
  switch (cmd) {
    case "system_info":
      return { totalMemMb: 32768, java: JAVAS[0] };
    case "list_game_versions":
      return versions(args.includeSnapshots);
    case "list_loader_versions":
      return args.loader === "paper"
        ? {
            recommended: "169",
            versions: [169, 168, 167, 140].map((b, i) => ({
              version: String(b),
              stable: false,
              channel: i === 3 ? "alpha" : "beta",
            })),
          }
        : {
            recommended: "0.19.5",
            versions: [
              { version: "0.20.0-beta.1", stable: false, channel: null },
              { version: "0.19.5", stable: true, channel: null },
              { version: "0.19.4", stable: true, channel: null },
            ],
          };
    case "list_instances":
      return [...instances];
    case "get_instance":
      return byId(args.id);
    case "create_instance": {
      const req = args.req;
      const id = `mock-${Date.now()}`;
      emit("install://progress", { id, stage: "meta", file: null, downloaded: 0, total: null });
      await progress("install://progress", { id, file: "server" }, 12);
      if (req.loader === "fabric") await progress("install://progress", { id, file: "fabric" }, 3);
      const inst: Instance = {
        id,
        name: req.name,
        loader: req.loader,
        mcVersion: req.mcVersion,
        loaderVersion: req.loaderVersion,
        javaPath: null,
        javaMajor: 25,
        ramMinMb: req.ramMinMb,
        ramMaxMb: req.ramMaxMb,
        port: 25565,
        createdAt: Date.now(),
        cover: null,
      };
      instances.push(inst);
      status[id] = "stopped";
      access[id] = {
        offlineMode: req.offlineMode,
        whitelistEnabled: req.offlineMode || req.whitelist !== null,
        whitelist: (req.whitelist ?? []).map((name: string) => ({ name, uuid: fakeUuid(name) })),
        ops: [],
        known: [],
      };
      emit("install://progress", { id, stage: "done", file: null, downloaded: 0, total: null });
      return inst;
    }
    case "update_instance": {
      const inst = byId(args.id);
      Object.assign(inst, Object.fromEntries(Object.entries(args.changes).filter(([, v]) => v !== undefined)));
      return { ...inst };
    }
    case "delete_instance":
      instances.splice(instances.indexOf(byId(args.id)), 1);
      return null;
    case "eula_status":
      return true;
    case "start_server":
      void boot(args.id);
      return null;
    case "stop_server":
      await stop(args.id);
      return null;
    case "send_command":
      log(args.id, `> ${args.command}`, "system");
      log(args.id, info(`[Server] ${String(args.command).replace(/^say /, "")}`));
      return null;
    case "server_snapshot":
      return {
        status: status[args.id] ?? "stopped",
        logs: logs[args.id] ?? [],
        players: players[args.id] ?? [],
        rejected: rejected[args.id] ?? [],
      };
    case "accept_eula":
      settings.eulaAccepted = true;
      return null;
    case "get_properties":
      return { values: { ...propsOf(args.id) }, exists: args.id !== "mock-2" };
    case "update_properties":
      Object.assign(propsOf(args.id), args.changes);
      return { values: { ...propsOf(args.id) }, exists: true };
    case "world_access":
      return accessView(args.id);
    case "lookup_player": {
      const name = String(args.name).trim();
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw "İsim 3-16 karakter olmalı; yalnız harf, rakam ve _ kullanılabilir.";
      if (!args.offline && name.toLowerCase().startsWith("yok"))
        throw `"${name}" adında bir Minecraft hesabı yok. Arkadaşın TLauncher kullanıyorsa "Premium olmayanlar da girebilsin"i aç.`;
      return { name, uuid: fakeUuid(name) };
    }
    case "whitelist_add": {
      const profile = (await mockInvoke("lookup_player", { name: args.name, offline: accessOf(args.id).offlineMode })) as {
        name: string;
        uuid: string;
      };
      const a = accessOf(args.id);
      if (!a.whitelist.some((p) => p.name.toLowerCase() === profile.name.toLowerCase())) a.whitelist.push(profile);
      rejected[args.id] = (rejected[args.id] ?? []).filter((n) => n.toLowerCase() !== profile.name.toLowerCase());
      emit("server://rejected", { id: args.id, players: rejected[args.id] });
      return accessView(args.id);
    }
    case "whitelist_remove": {
      const a = accessOf(args.id);
      a.whitelist = a.whitelist.filter((p) => p.name.toLowerCase() !== String(args.name).toLowerCase());
      return accessView(args.id);
    }
    case "set_whitelist_enabled": {
      const a = accessOf(args.id);
      if (!args.on && a.offlineMode) throw "Premium olmayanlar girebilirken beyaz liste kapatılamaz.";
      a.whitelistEnabled = args.on;
      return accessView(args.id);
    }
    case "set_offline_mode": {
      if (status[args.id] !== "stopped") throw "Bu ayarı değiştirmek için önce dünyayı durdur.";
      const a = accessOf(args.id);
      a.offlineMode = args.offline;
      if (args.offline) a.whitelistEnabled = true;
      propsOf(args.id)["online-mode"] = String(!args.offline);
      return accessView(args.id);
    }
    case "set_op": {
      const a = accessOf(args.id);
      a.ops = args.op ? [...a.ops, args.name] : a.ops.filter((n) => n !== args.name);
      const online = (players[args.id] ?? []).includes(args.name) || status[args.id] !== "running";
      return accessView(args.id, online ? null : "Yeniden başlatınca geçerli olur.");
    }
    case "kick_player":
      players[args.id] = (players[args.id] ?? []).filter((n) => n !== args.name);
      emit("server://players", { id: args.id, players: players[args.id] });
      return null;
    case "list_java":
      return JAVAS;
    case "instance_java": {
      const inst = byId(args.id);
      const pinned = inst.javaPath;
      return {
        required: inst.javaMajor,
        pinned,
        selected: JAVAS.find((j) => j.path === pinned) ?? JAVAS[1],
        error: null,
      };
    }
    case "install_java":
      await progress("java://progress", { major: args.major }, 10);
      emit("java://progress", { major: args.major, stage: "extract", downloaded: 0, total: null });
      await sleep(500);
      return { ...JAVAS[1], managed: true };
    case "set_instance_java":
      byId(args.id).javaPath = args.path;
      return { ...byId(args.id) };
    case "get_settings":
      return { settings, minecraftDir: settings.minecraftDir ?? "C:\\Users\\sen\\AppData\\Roaming\\.minecraft", screenshotsFound: true };
    case "update_settings":
      settings = args.settings;
      return mockInvoke("get_settings");
    case "list_screenshots":
      return args.id === "mock-1" ? { matched: shots.slice(0, 3), others: shots.slice(3) } : { matched: [], others: shots };
    case "set_cover": {
      const inst = byId(args.id);
      await sleep(600);
      const hue = Math.floor(Math.random() * 360);
      inst.cover =
        args.source.type === "auto" && args.id !== "mock-1"
          ? null
          : { kind: args.source.type === "auto" ? "auto" : "manual", color: `hsl(${hue} 50% 65%)`, version: (inst.cover?.version ?? 0) + 1 };
      return { ...inst };
    }
    case "play_stats":
      return args.id === "mock-2" ? { lastPlayedAt: null, totalMs: 0 } : { lastPlayedAt: Date.now() - 26 * HOUR, totalMs: 7.5 * HOUR };
    case "lan_address":
      return `192.168.1.24:${byId(args.id).port}`;
    default:
      return null;
  }
}
