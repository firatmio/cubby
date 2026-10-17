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
    internet: true,
    inviteToken: null,
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
    internet: true,
    inviteToken: null,
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
    internet: false,
    inviteToken: null,
  },
];

const players: Record<string, string[]> = { "mock-1": ["Ali"] };
const HOUR = 3_600_000;
const shots = Array.from({ length: 7 }, (_, i) => ({
  file: `2026-10-0${(i % 9) + 1}_1${i}.2${i}.0${i}.png`,
  takenAt: Date.now() - (i + 1) * 5 * HOUR,
}));
let settings = { minecraftDir: null as string | null, useScreenshots: true, eulaAccepted: true, clientSync: true, language: null as "tr" | "en" | null, animations: null as "full" | "simple" | null, autoUpdate: true, betaUpdates: false };

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

type Route = { state: string; address: string | null; message: string | null };
const OFF: Route = { state: "off", address: null, message: null };
const direct: Record<string, Route> = {};

function connectionView(id: string) {
  const inst = byId(id);
  const up = status[id] === "running" && inst.internet;
  return {
    lan: `192.168.1.24:${inst.port}`,
    internet: !!inst.internet,
    direct: up ? (direct[id] ?? OFF) : OFF,
  };
}

const pushNet = (id: string) => emit("net://status", { id, view: connectionView(id) });

/** Mock: Paper dünyasında modem UPnP'yi destekliyor, diğerlerinde desteklemiyor. */
async function netUp(id: string) {
  direct[id] = { state: "working", address: null, message: null };
  pushNet(id);
  await sleep(1200);
  direct[id] =
    id === "mock-2"
      ? { state: "ok", address: `188.119.44.224:${byId(id).port}`, message: null }
      : { state: "error", address: null, message: "Modemin otomatik port açmayı (UPnP) desteklemiyor ya da kapalı." };
  pushNet(id);
}

// Açılışta çalışan ve internete açık dünya için bağlantılar kurulmuş olsun.
setTimeout(() => void netUp("mock-1"), 300);

const ONLINE = { reachable: true, running: true, path: "direct", error: null };
const joined: { world: Record<string, unknown> & { id: string; name: string; localPort: number }; status: typeof ONLINE | Record<string, unknown>; address: string }[] = [
  {
    world: {
      id: "join-1",
      name: "Ali'nin adası",
      host: "f".repeat(64),
      world: "remote-1",
      loader: "vanilla",
      mcVersion: "26.3",
      loaderVersion: null,
      localPort: 25600,
      addedAt: 1,
      profile: null,
      gameDir: null,
      modsRev: null,
      withRecommended: false,
      cover: { version: 1, color: "#d9a35b" },
      code: "K7M-2QX",
    },
    status: { ...ONLINE, modsRev: null },
    address: "127.0.0.1:25600",
  },
];
const entries = new Set(["join-1"]);

type MockMod = {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  clientNeed: string;
  deps?: string[];
  plugin?: boolean;
};
/** Gerçek Modrinth açıklamalarına benzeyen Markdown: başlık, rozet, liste, tablo, kod, HTML. */
const MOCK_BODY = (title: string, desc: string) => `<center>

![banner](https://placehold.co/800x200/2f4a63/ffffff/png?text=${encodeURIComponent(title)})

[![Discord](https://img.shields.io/badge/Discord-join-5865F2)](https://example.com/discord) [![Modrinth](https://img.shields.io/badge/Modrinth-download-1bd96a)](https://modrinth.com)

</center>

## ${title}

${desc}

---

### Özellikler

- **Hafif:** sunucuyu yavaşlatmaz
- **Kolay:** kurduktan sonra ayar gerekmez
- Yeni komut: \`/${title.toLowerCase().replace(/\W+/g, "")} reload\`

| Sürüm | Minecraft | Durum |
| --- | --- | --- |
| 1.2.0 | 26.3 | Kararlı |
| 1.1.4 | 1.21.11 | Eski |

> Hata bulursan GitHub'da bildir.

\`\`\`json
{ "enabled": true, "radius": 64 }
\`\`\`

<details><summary>Sık sorulanlar</summary>

Arkadaşımın da kurması gerekir mi? Uygulama bunu sana söyler.

</details>

<script>alert("bu çalışmamalı")</script><img src="x" onerror="alert(1)">
`;

const MODS: MockMod[] = [
  { projectId: "P7dR8mSH", slug: "fabric-api", title: "Fabric API", description: "Lightweight and modular API providing common hooks and intercompatibility measures utilized by mods using the Fabric toolchain.", downloads: 272_714_633, clientNeed: "recommended" },
  { projectId: "gvQqBUqZ", slug: "lithium", title: "Lithium", description: "No-compromises game logic optimization mod. Well suited for clients and servers of all kinds.", downloads: 61_200_000, clientNeed: "recommended" },
  { projectId: "fALzjamp", slug: "chunky", title: "Chunky", description: "Pre-generates chunks, quickly and efficiently.", downloads: 9_800_000, clientNeed: "recommended", deps: ["P7dR8mSH"] },
  { projectId: "Ha28R6CL", slug: "farmers-delight", title: "Farmer's Delight", description: "A gentle expansion to farming and cooking.", downloads: 38_400_000, clientNeed: "required", deps: ["P7dR8mSH"] },
  { projectId: "l6YH9Als", slug: "spark", title: "spark", description: "A performance profiler for Minecraft clients, servers and proxies.", downloads: 21_000_000, clientNeed: "recommended" },
  { projectId: "9eGKb6K1", slug: "simple-voice-chat", title: "Simple Voice Chat", description: "A working voice chat in Minecraft!", downloads: 44_100_000, clientNeed: "required" },
  { projectId: "Vebnzrzj", slug: "luckperms", title: "LuckPerms", description: "A permissions plugin for Minecraft servers.", downloads: 5_400_000, clientNeed: "none", plugin: true },
  { projectId: "UmLGoGij", slug: "essentialsx", title: "EssentialsX", description: "The essential plugin suite for Minecraft servers.", downloads: 3_100_000, clientNeed: "none", plugin: true },
];
const modsInstalled: Record<string, { file: string; projectId: string | null; dependency: boolean; update: string | null }[]> = {
  "mock-1": [
    { file: "fabric-api-0.161.0+26.3.jar", projectId: "P7dR8mSH", dependency: true, update: "0.162.0+26.3" },
    { file: "lithium-fabric-0.18.1+mc26.3.jar", projectId: "gvQqBUqZ", dependency: false, update: null },
    { file: "benim-modum.jar", projectId: null, dependency: false, update: null },
  ],
  "mock-2": [],
};
const modById = (pid: string | null) => MODS.find((m) => m.projectId === pid);

/** Sahte paketler (kaynak paketi, shader, veri paketi). */
type MockPack = { projectId: string; title: string; description: string; downloads: number; kind: string };
const PACKS: MockPack[] = [
  { projectId: "RP000001", kind: "resourcePack", title: "Fresh Animations", description: "Gives entities new life with smooth animations.", downloads: 9_400_000 },
  { projectId: "RP000002", kind: "resourcePack", title: "Faithful 32x", description: "The classic look, twice the resolution.", downloads: 6_100_000 },
  { projectId: "RP000003", kind: "resourcePack", title: "Better Leaves", description: "Bushy leaves for every tree.", downloads: 3_200_000 },
  { projectId: "RP000004", kind: "resourcePack", title: "Stay True", description: "A vanilla-like texture overhaul.", downloads: 2_800_000 },
  { projectId: "RP000005", kind: "resourcePack", title: "Low On Fire", description: "Lowers the fire overlay so you can see.", downloads: 2_100_000 },
  { projectId: "RP000006", kind: "resourcePack", title: "Default Dark Mode", description: "Dark GUI for menus and inventories.", downloads: 1_900_000 },
  { projectId: "SH000001", kind: "shader", title: "Complementary Reimagined", description: "Vanilla-like shaders, beautifully reimagined.", downloads: 12_300_000 },
  { projectId: "SH000002", kind: "shader", title: "BSL Shaders", description: "Bright, colorful and fast.", downloads: 10_100_000 },
  { projectId: "SH000003", kind: "shader", title: "Bliss", description: "Realistic lighting and fog.", downloads: 3_900_000 },
  { projectId: "SH000004", kind: "shader", title: "MakeUp Ultra Fast", description: "Shaders for low-end computers.", downloads: 3_100_000 },
  { projectId: "SH000005", kind: "shader", title: "Solas", description: "A stylized fantasy look.", downloads: 1_200_000 },
  { projectId: "DP000001", kind: "dataPack", title: "Terralith", description: "Explore almost 100 new biomes.", downloads: 8_800_000 },
  { projectId: "DP000002", kind: "dataPack", title: "Dungeons and Taverns", description: "New structures to explore.", downloads: 4_400_000 },
  { projectId: "DP000003", kind: "dataPack", title: "VeinMiner", description: "Mine a whole vein at once.", downloads: 2_500_000 },
  { projectId: "DP000004", kind: "dataPack", title: "Incendium", description: "A Nether overhaul.", downloads: 2_200_000 },
  { projectId: "MP000001", kind: "modpack", title: "Cobblemon Official Modpack", description: "The official modpack of the Cobblemon mod, for Fabric!", downloads: 9_900_000 },
  { projectId: "MP000002", kind: "modpack", title: "Better MC [FABRIC]", description: "Adventure, exploration and quality of life.", downloads: 7_300_000 },
  { projectId: "MP000003", kind: "modpack", title: "All the Mods 10", description: "A kitchen sink pack with hundreds of mods.", downloads: 5_100_000 },
  { projectId: "MP000004", kind: "modpack", title: "Create: Above and Beyond", description: "A Create-focused tech pack with quests.", downloads: 3_400_000 },
  { projectId: "MP000005", kind: "modpack", title: "Pixelmon Classic 1.12", description: "An old Forge pack (not supported).", downloads: 2_000_000 },
  { projectId: "MP000006", kind: "modpack", title: "Cozy Survival", description: "A lightweight pack for playing with friends.", downloads: 1_200_000 },
];
/** Sahte mod paketlerinin sürümleri: [sürüm, altyapı, Minecraft, sunucu modu, oyuncu modu]. */
const PACK_VERSIONS: Record<string, [string, string, string, number, number][]> = {
  MP000001: [["1.8.2", "fabric", "1.21.1", 34, 41], ["1.7.0", "fabric", "1.21.1", 31, 38], ["1.5.2", "fabric", "1.20.1", 28, 30]],
  MP000002: [["v34", "fabric", "1.21.1", 180, 62]],
  MP000003: [["4.2", "neoforge", "1.21.1", 410, 25], ["4.1", "neoforge", "1.21.1", 402, 25]],
  MP000004: [["1.3", "forge", "1.18.2", 160, 12]],
  MP000005: [],
  MP000006: [["2.0", "quilt", "26.3", 22, 9]],
};
const packById = (pid: string) => PACKS.find((p) => p.projectId === pid);
/** Dünya → tür → kurulu paketler. */
const packsInstalled: Record<string, { file: string; projectId: string; kind: string; active?: boolean; forced?: boolean }[]> = {};
const packList = (world: string, kind: string, note: string | null = null) => ({
  items: (packsInstalled[world] ?? [])
    .filter((p) => p.kind === kind)
    .map((p) => ({
      file: p.file,
      title: packById(p.projectId)?.title ?? p.file,
      projectId: p.projectId,
      versionNumber: "1.0.0",
      icon: `modicon/${p.projectId}`,
      clientNeed: null,
      dependency: false,
      known: true,
      update: null,
      active: !!p.active,
      forced: !!p.forced,
    })),
  note,
});
function installedView(id: string) {
  return (modsInstalled[id] ??= []).map((m) => {
    const mod = modById(m.projectId);
    return {
      file: m.file,
      title: mod?.title ?? m.file.replace(/\.jar$/, ""),
      projectId: m.projectId,
      versionNumber: m.projectId ? m.file.replace(/^[a-z-]+-/, "").replace(/\.jar$/, "") : null,
      icon: m.projectId ? `modicon/${m.projectId}` : null,
      clientNeed: mod?.clientNeed ?? null,
      dependency: m.dependency,
      known: !!m.projectId,
      update: m.update,
    };
  });
}

let account: { name: string; uuid: string; skin: string | null } | null = null;

/** Oyunun Launcher'sız hazırlanması: dosyalar → Java → açılış. */
async function gameBoot() {
  const total = 3104;
  for (let done = 0; done <= total; done += 388) {
    emit("game://progress", { stage: "files", done: Math.min(done, total), total });
    await sleep(250);
  }
  emit("game://progress", { stage: "java", done: 0, total: 0 });
  await sleep(500);
  emit("game://progress", { stage: "starting", done: 0, total: 0 });
  await sleep(600);
  emit("game://state", { state: "running", code: null });
}

async function boot(id: string) {
  setStatus(id, "starting");
  logs[id] = [];
  for (const l of BOOT) {
    await sleep(250);
    log(id, info(l));
  }
  setStatus(id, "running");
  if (byId(id).internet) void netUp(id);
}

async function stop(id: string) {
  setStatus(id, "stopping");
  log(id, info("Stopping server"));
  await sleep(400);
  log(id, info("Saving worlds"));
  await sleep(400);
  log(id, "Sunucu kapandı (çıkış kodu: 0).", "system");
  setStatus(id, "stopped");
  pushNet(id);
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
        : args.loader === "neoforge"
          ? {
              recommended: "26.3.0.76",
              versions: [
                { version: "26.3.0.76", stable: true, channel: null },
                { version: "26.3.0.75-beta", stable: false, channel: null },
              ],
            }
          : args.loader === "forge"
            ? {
                recommended: "66.0.10",
                versions: ["66.0.10", "66.0.9", "66.0.8"].map((version) => ({ version, stable: true, channel: null })),
              }
            : {
                recommended: args.loader === "quilt" ? "0.30.1" : "0.19.5",
                versions: (args.loader === "quilt" ? ["0.31.0-beta.4", "0.30.1", "0.30.0"] : ["0.20.0-beta.1", "0.19.5", "0.19.4"]).map(
                  (version) => ({ version, stable: !version.includes("-"), channel: null }),
                ),
              };
    case "list_instances":
      return [...instances];
    case "get_instance":
      return { ...byId(args.id) };
    case "create_instance": {
      const req = args.req;
      const id = `mock-${Date.now()}`;
      emit("install://progress", { id, stage: "meta", file: null, downloaded: 0, total: null });
      await progress("install://progress", { id, file: "server" }, 12);
      if (req.loader === "fabric") await progress("install://progress", { id, file: "fabric" }, 3);
      if (req.modpack) await progress("install://progress", { id, file: "modpack" }, 20);
      if (["neoforge", "forge", "quilt"].includes(req.loader)) {
        await progress("install://progress", { id, file: "installer" }, 4);
        for (const line of [
          "Considering Minecraft server jar",
          "Considering library net.neoforged:fancymodloader:10.0.3",
          "Download completed: Checksum validated.",
          "Task: PROCESS_MINECRAFT_JAR",
          "applying patches [275ms]",
        ]) {
          await sleep(500);
          emit("install://progress", { id, stage: "installer", file: null, downloaded: 0, total: null, line });
        }
      }
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
        internet: false,
        inviteToken: null,
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
      void boot(args.id).then(async () => {
        if (!args.join) return;
        const inst = byId(args.id);
        if (account) {
          await gameBoot();
          emit("client://launch", {
            id: args.id,
            result: { opened: false, launcher: "official", pick: `${inst.name} · Cubby`, wasRunning: false, direct: true, game: true, note: null, error: null },
          });
          return;
        }
        emit("client://launch", {
          id: args.id,
          result: { opened: true, launcher: "official", pick: `${inst.name} · Cubby`, wasRunning: false, direct: true, game: false, note: null, error: null },
        });
      });
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
    case "connection_status":
      return connectionView(args.id);
    case "set_internet": {
      byId(args.id).internet = args.on;
      if (args.on && status[args.id] === "running") void netUp(args.id);
      return connectionView(args.id);
    }
    case "create_invite":
    case "reset_invite": {
      // localStorage.mockNoShort = "1": davet sunucusuna ulaşılamamış gibi.
      const noShort = typeof localStorage !== "undefined" && localStorage.getItem("mockNoShort") === "1";
      const short = cmd === "reset_invite" ? "Q4R-8TW" : "K7M-2QX";
      const inst = instances.find((i) => i.id === args.id);
      if (inst && !noShort) inst.shortInvite = { code: short.replace("-", "") };
      await sleep(400);
      return {
        short: noShort ? null : short,
        web: noShort ? null : `https://cubby.quacomes.com/join/${short.replace("-", "")}`,
      };
    }
    // localStorage.mockUpdate = "ready" | "available": güncelleme varmış gibi.
    case "update_status":
    case "update_check": {
      const mode = typeof localStorage !== "undefined" ? localStorage.getItem("mockUpdate") : null;
      const notes = "- Davet artık 6 karakterlik kodla\n- Oyna sayfasında yeni kartlar\n- Panodan kod doldurma";
      return {
        current: "0.2.0-beta.1",
        status: mode === "ready" || mode === "available" ? { state: mode, version: "0.2.0-beta.2", notes } : { state: "upToDate" },
        minecraftRunning: false,
      };
    }
    case "update_download":
      return { current: "0.2.0-beta.1", status: { state: "ready", version: "0.2.0-beta.2", notes: "- Yeni" }, minecraftRunning: false };
    case "update_install":
      await sleep(800);
      return null;
    case "update_whats_new":
      return typeof localStorage !== "undefined" && localStorage.getItem("mockWhatsNew")
        ? { version: "0.2.0-beta.1", notes: "- Davet artık 6 karakterlik kodla\n- Oyna sayfasında yeni kartlar" }
        : null;
    case "clipboard_invite_code":
      // localStorage.mockClipboard = "K7M2QX": panoda kod varmış gibi.
      return (typeof localStorage !== "undefined" && localStorage.getItem("mockClipboard")) || null;
    case "preview_invite":
      if (/^[a-z0-9]{3}-?[a-z0-9]{3}$/i.test(String(args.code).trim()) && !/^k7m-?2qx$/i.test(String(args.code).trim()))
        throw "Bu davet kodu bulunamadı ya da yenilenmiş. Arkadaşından yeni bir davet iste.";
      if (!String(args.code).trim().startsWith("cubby") && String(args.code).trim().length < 6)
        throw "Davet kodu bozuk ya da eksik. Arkadaşından yeni bir davet iste.";
      await sleep(700);
      return {
        name: "Mehmet'in modlu dünyası",
        loader: "fabric",
        mcVersion: "26.3",
        loaderVersion: "0.19.5",
        status: { reachable: true, running: true, path: "relay", error: null },
        own: false,
        alreadyJoined: false,
        minecraftDir: "C:\\Users\\sen\\AppData\\Roaming\\.minecraft",
        minecraftRunning: false,
        requiredVersion: "fabric-loader-0.19.5-26.3",
        versionInstalled: false,
        mods: {
          launcher: "official",
          required: [{ title: "Farmer's Delight", size: 3_400_000 }],
          recommended: [
            { title: "Just Enough Items (JEI)", size: 2_388_519 },
            { title: "Fabric API", size: 1_772_377 },
          ],
        },
        modsError: null,
      };
    case "join_world": {
      const id = `join-${Date.now()}`;
      const titles = ["Farmer's Delight", ...(args.installRecommended ? ["Just Enough Items (JEI)", "Fabric API"] : [])];
      for (let i = 0; i < titles.length; i++) {
        emit("join://progress", { id, title: titles[i], index: i + 1, count: titles.length });
        await sleep(700);
      }
      const view = {
        world: {
          id,
          name: "Mehmet'in modlu dünyası",
          host: "e".repeat(64),
          world: "remote-2",
          loader: "fabric",
          mcVersion: "26.3",
          loaderVersion: "0.19.5",
          localPort: 25600 + joined.length,
          addedAt: Date.now(),
          profile: "Mehmet'in modlu dünyası · Cubby",
          gameDir: "C:\\Users\\sen\\AppData\\Roaming\\.minecraft\\mcsm\\mehmet",
          modsRev: "aaaa",
          withRecommended: !!args.installRecommended,
        },
        status: { reachable: null, running: false, path: null, error: null } as Record<string, unknown>,
        address: `127.0.0.1:${25600 + joined.length}`,
      };
      joined.push(view);
      entries.add(id);
      setTimeout(() => {
        // Biraz sonra arkadaş yeni bir mod ekler: "Güncelle" butonu görünsün.
        view.status = { reachable: true, running: true, path: "relay", error: null, modsRev: "bbbb" };
        emit("join://status", { id, status: view.status });
      }, 1500);
      return view;
    }
    case "list_joined":
      return structuredClone(joined);
    case "remove_joined": {
      const i = joined.findIndex((j) => j.world.id === args.id);
      if (i >= 0) joined.splice(i, 1);
      entries.delete(args.id);
      return null;
    }
    case "readd_server_entry":
      entries.add(args.id);
      return null;
    case "server_entry_exists":
      return entries.has(args.id);
    case "refresh_joined":
      return structuredClone(joined.find((j) => j.world.id === args.id));
    case "take_pending_invite":
      return null;
    case "play_joined": {
      const j = joined.find((x) => x.world.id === args.id)!;
      await sleep(400);
      return {
        opened: true,
        launcher: "official",
        pick: `${j.world.name} · Cubby`,
        wasRunning: true,
        direct: true,
        game: false,
        note: null,
        error: null,
      };
    }
    case "account_status":
      return { enabled: true, account };
    case "account_login":
      await sleep(1500);
      account = { name: "firatmio", uuid: "0", skin: null };
      return account;
    case "account_logout":
      account = null;
      return null;
    case "open_game_log":
      return null;
    case "update_joined_mods": {
      const j = joined.find((x) => x.world.id === args.id)!;
      await sleep(900);
      (j.world as Record<string, unknown>).modsRev = (j.status as Record<string, unknown>).modsRev;
      return structuredClone(j);
    }
    case "client_status":
      return byId(args.id).loader === "fabric" && settings.clientSync
        ? { state: "ok", launcher: "official", pick: `${byId(args.id).name} · Cubby`, mods: 3, blocked: [], message: null }
        : { state: "off", launcher: null, pick: null, mods: 0, blocked: [], message: null };
    case "client_resync":
      await sleep(500);
      return null;
    case "modpack_plan": {
      await sleep(600);
      const list = PACK_VERSIONS[args.projectId] ?? [];
      const versions = list.map(([number, loader, mc], i) => ({ id: `${args.projectId}-v${i}`, number, mc, loader, unstable: i === 2 }));
      const chosen = versions.find((v) => v.id === args.versionId) ?? versions[0];
      if (!chosen)
        return {
          versions: [],
          versionId: null,
          versionNumber: null,
          unstable: false,
          mc: null,
          loader: null,
          loaderVersion: null,
          serverMods: 0,
          clientMods: 0,
          size: 0,
          ramMb: 0,
          error: "Bu paket Forge 1.12.2 istiyor; Cubby henüz desteklemiyor.",
        };
      const [, , , server, client] = list[versions.indexOf(chosen)];
      const mods = server + client;
      const loaderVersions: Record<string, string> = { fabric: "0.19.5", neoforge: "21.1.77", forge: "40.2.0", quilt: "0.29.1" };
      return {
        versions,
        versionId: chosen.id,
        versionNumber: chosen.number,
        unstable: chosen.unstable,
        mc: chosen.mc,
        loader: chosen.loader,
        loaderVersion: loaderVersions[chosen.loader] ?? null,
        serverMods: server,
        clientMods: client,
        size: mods * 2_800_000,
        ramMb: mods < 50 ? 4096 : mods < 150 ? 6144 : 8192,
        error: null,
      };
    }
    case "content_search": {
      await sleep(300);
      const q = String(args.query).toLowerCase();
      const cat = args.category ? String(args.category) : "";
      const have = new Set((packsInstalled[args.world] ?? []).filter((p) => p.kind === args.kind).map((p) => p.projectId));
      const list = PACKS.filter((p) => p.kind === args.kind)
        .filter((p) => !cat || (cat.length + p.projectId.charCodeAt(7)) % 3 !== 0)
        .filter((p) => !q || p.title.toLowerCase().includes(q));
      return {
        total: list.length,
        hits: list.slice(args.offset, args.offset + 20).map((p) => ({
          projectId: p.projectId,
          slug: p.projectId.toLowerCase(),
          title: p.title,
          description: p.description,
          downloads: p.downloads,
          icon: `modicon/${p.projectId}`,
          author: "sixthsurge",
          image: `modimg/${p.projectId}`,
          color: "#3b5c7a",
          clientNeed: "unknown",
          installed: have.has(p.projectId),
        })),
      };
    }
    case "content_project": {
      await sleep(250);
      const p = packById(args.projectId)!;
      const have = (packsInstalled[args.world] ?? []).some((x) => x.projectId === p.projectId);
      return {
        projectId: p.projectId,
        title: p.title,
        description: p.description,
        body: MOCK_BODY(p.title, p.description),
        downloads: p.downloads,
        license: "CC-BY-NC-4.0",
        url: `https://modrinth.com/project/${p.projectId.toLowerCase()}`,
        icon: `modicon/${p.projectId}`,
        gallery: [0, 1, 2].map((n) => `modimg/${p.projectId}_${n}`),
        clientNeed: "unknown",
        installed: have,
      };
    }
    case "content_plan": {
      await sleep(700);
      const shaders = (packsInstalled[args.world] ?? []).some((x) => x.kind === "shader");
      return {
        versionNumber: "1.0.0",
        unstable: false,
        // İlk shader'da Iris ve Sodium da gelir.
        with: args.kind === "shader" && !shaders ? [{ projectId: "YL57xq9U", title: "Iris Shaders" }, { projectId: "AANobbMI", title: "Sodium" }] : [],
        missing: [],
        conflicts: [],
        error: null,
      };
    }
    case "content_installed":
      await sleep(250);
      return packList(args.world, args.kind);
    case "content_install": {
      const p = packById(args.projectId)!;
      for (let i = 1; i <= 4; i++) {
        await sleep(250);
        emit("mods://progress", { id: args.world, title: p.title, downloaded: i * 600_000, total: 2_400_000 });
      }
      const list = (packsInstalled[args.world] ??= []);
      if (args.kind === "shader") list.forEach((x) => x.kind === "shader" && (x.active = false));
      list.push({ file: `${p.title.replace(/\W+/g, "_")}.zip`, projectId: p.projectId, kind: args.kind, active: args.kind === "shader" });
      return packList(args.world, args.kind);
    }
    case "content_remove":
      packsInstalled[args.world] = (packsInstalled[args.world] ?? []).filter((x) => x.file !== args.file);
      return packList(args.world, args.kind);
    case "content_update":
      return packList(args.world, args.kind);
    case "content_activate_shader":
      (packsInstalled[args.world] ?? []).forEach((x) => x.kind === "shader" && (x.active = x.file === args.file));
      return packList(args.world, "shader");
    case "content_force_pack":
      (packsInstalled[args.world] ?? []).forEach((x) => x.kind === "resourcePack" && (x.forced = x.file === args.file));
      return packList(args.world, "resourcePack", "Dünya yeniden açılınca geçerli olur.");
    case "mods_search": {
      await sleep(300);
      const plugin = byId(args.id).loader === "paper";
      const q = String(args.query).toLowerCase();
      const have = new Set((modsInstalled[args.id] ?? []).map((m) => m.projectId));
      // Kategoriler sahte: her kategori listenin farklı bir alt kümesini gösterir (raflar farklı görünsün).
      const cat = args.category ? String(args.category) : "";
      const inCat = (m: MockMod) => !cat || (cat.length + m.projectId.charCodeAt(2)) % 3 !== 0;
      const list = MODS.filter((m) => !!m.plugin === plugin)
        .filter(inCat)
        .filter((m) => !q || m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q))
        .sort((a, b) => (args.sort === "downloads" ? b.downloads - a.downloads : 0));
      return {
        total: list.length,
        hits: list.slice(args.offset, args.offset + 20).map((m) => ({
          projectId: m.projectId,
          slug: m.slug,
          title: m.title,
          description: m.description,
          downloads: m.downloads,
          icon: `modicon/${m.projectId}`,
          author: ["jellysquid3", "CaffeineMC", "henkelmax", "vectorwing"][m.projectId.charCodeAt(3) % 4],
          // Bazı kartlar görselsiz: zemin rengi + büyük ikon görünümü de denensin.
          image: m.projectId.charCodeAt(0) % 2 ? `modimg/${m.projectId}` : null,
          color: ["#3b7a57", "#7a3b5c", "#3b5c7a", "#7a6a3b"][m.projectId.charCodeAt(1) % 4],
          clientNeed: m.clientNeed,
          installed: have.has(m.projectId),
        })),
      };
    }
    case "mods_project": {
      await sleep(300);
      const m = modById(args.projectId)!;
      const have = new Set((modsInstalled[args.id] ?? []).map((x) => x.projectId));
      return {
        projectId: m.projectId,
        title: m.title,
        description: m.description,
        body: MOCK_BODY(m.title, m.description),
        downloads: m.downloads,
        license: "MIT License",
        url: `https://modrinth.com/project/${m.slug}`,
        icon: `modicon/${m.projectId}`,
        gallery: [0, 1, 2, 3].map((n) => `modimg/${m.projectId}_${n}`),
        clientNeed: m.clientNeed,
        installed: have.has(m.projectId),
      };
    }
    case "mods_plan": {
      // Çözüm gerçekte birkaç istek sürer: önizleme önce bilgiyle açılır, bu sonra dolar.
      await sleep(900);
      const m = modById(args.projectId)!;
      const have = new Set((modsInstalled[args.id] ?? []).map((x) => x.projectId));
      return {
        versionNumber: "1.2.0+26.3",
        unstable: m.slug === "chunky",
        with: (m.deps ?? []).filter((d) => !have.has(d)).map((d) => ({ projectId: d, title: modById(d)!.title })),
        missing: [],
        conflicts: [],
        error: null,
      };
    }
    case "mods_install": {
      const m = modById(args.projectId)!;
      const list = (modsInstalled[args.id] ??= []);
      for (const pid of [m.projectId, ...(m.deps ?? [])]) {
        if (list.some((x) => x.projectId === pid)) continue;
        const mod = modById(pid)!;
        for (let i = 0; i <= 8; i++) {
          await sleep(90);
          emit("mods://progress", { id: args.id, title: mod.title, downloaded: i * 220_000, total: 8 * 220_000 });
        }
        list.push({ file: `${mod.slug}-1.2.0+26.3.jar`, projectId: pid, dependency: pid !== m.projectId, update: null });
      }
      return installedView(args.id);
    }
    case "mods_installed":
      await sleep(400);
      return installedView(args.id);
    case "mods_remove":
      modsInstalled[args.id] = (modsInstalled[args.id] ?? []).filter((m) => m.file !== args.file);
      return installedView(args.id);
    case "mods_update":
    case "mods_update_all":
      for (const m of modsInstalled[args.id] ?? []) {
        if (cmd === "mods_update" && m.file !== args.file) continue;
        if (!m.update) continue;
        await sleep(500);
        m.file = m.file.replace(/\d[^-]*\.jar$/, `${m.update}.jar`);
        m.update = null;
      }
      return installedView(args.id);
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
      return { settings, language: settings.language ?? (navigator.language.startsWith("tr") ? "tr" : "en"), minecraftDir: settings.minecraftDir ?? "C:\\Users\\sen\\AppData\\Roaming\\.minecraft", screenshotsFound: true };
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
