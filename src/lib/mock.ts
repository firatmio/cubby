/**
 * Yalnız geliştirme: uygulama Tauri dışında (düz tarayıcıda) açıldığında `api` ve event'ler
 * buradaki sahte verilerle çalışır. Arayüzü tarayıcıda görmek/denemek için. Prod pakete girmez
 * (`api.ts` içindeki `import.meta.env.DEV` koşulu sayesinde).
 */
import type {
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
  },
];

const status: Record<string, ServerStatus> = { "mock-1": "running", "mock-2": "stopped" };
const logs: Record<string, LogLine[]> = { "mock-1": [], "mock-2": [] };

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
      };
      instances.push(inst);
      status[id] = "stopped";
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
      return { status: status[args.id] ?? "stopped", logs: logs[args.id] ?? [] };
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
    default:
      return null;
  }
}
