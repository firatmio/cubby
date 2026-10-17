/**
 * Yeni sürüm: `bun run release <sürüm> [--beta] [--notes "…"] [--dry]`
 *
 * 1. Denetler: çalışma alanı temiz, sürüm geçerli ve şimdikinden yeni, etiket yok.
 * 2. Sürümü package.json, src-tauri/Cargo.toml ve tauri.conf.json'a yazar.
 * 3. NSIS kurulumunu derler ve güncelleme imzasını üretir (anahtar repo dışında,
 *    %USERPROFILE%\.cubby\updater.key; bkz. docs/YAYIN.md).
 * 4. Commit + `v<sürüm>` etiketi, push, GitHub Releases'a yükleme (`--beta` → pre-release).
 *
 * Derleme başarısız olursa sürüm değişiklikleri geri alınır; hiçbir şey push edilmez.
 * `--dry`: yalnız derler, commit/push/yükleme yapmaz.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");
const KEY_DIR = join(homedir(), ".cubby");
const FILES = ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"];

function die(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function run(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv; capture?: boolean } = {}): string {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: opts.env ?? process.env,
    encoding: "utf8",
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (r.status !== 0) die(`${cmd} ${args.join(" ")} başarısız${opts.capture ? `:\n${r.stderr}` : ""}`);
  return (r.stdout ?? "").trim();
}

const git = (...args: string[]) => run("git", args, { capture: true });

// ---- Argümanlar ----
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const version = argv.find((a) => !a.startsWith("--") && a !== option("--notes"));
const beta = flag("--beta");
const dry = flag("--dry");
if (!version) die('Kullanım: bun run release <sürüm> [--beta] [--notes "…"] [--dry]');
const semver = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
if (!semver) die(`Geçersiz sürüm: ${version} (ör. 0.2.0 ya da 0.2.0-beta.1)`);
if (beta && !semver[4]) die("--beta için sürümün bir ön eki olmalı (ör. 0.2.0-beta.1).");
if (!beta && semver[4]) die(`${version} bir ön sürüm; deneme kanalı için --beta ekle.`);

// ---- Denetimler ----
const tauriConf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const current: string = tauriConf.version;
const newer = (a: string, b: string) => {
  const p = (v: string) => {
    const [core, pre] = v.split("-");
    return { core: core.split(".").map(Number), pre };
  };
  const x = p(a);
  const y = p(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] > y.core[i];
  if (!x.pre) return !!y.pre;
  if (!y.pre) return false;
  return x.pre.localeCompare(y.pre, "en", { numeric: true }) > 0;
};
if (!newer(version, current)) die(`${version}, şimdiki sürümden (${current}) yeni değil.`);
if (git("status", "--porcelain", "--untracked-files=no")) die("Çalışma alanında commit'lenmemiş değişiklik var.");
if (git("branch", "--show-current") !== "main") die("Yayın yalnız main dalından yapılır.");
const tag = `v${version}`;
if (git("tag", "--list", tag)) die(`${tag} etiketi zaten var.`);

const keyFile = join(KEY_DIR, "updater.key");
const passFile = join(KEY_DIR, "updater.key.password");
if (!existsSync(keyFile)) die(`İmza anahtarı yok: ${keyFile} (docs/YAYIN.md)`);

// ---- Notlar: --notes ya da önceki etiketten bu yana commit başlıkları ----
function defaultNotes(): string {
  const prev = spawnSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: ROOT, encoding: "utf8" });
  const range = prev.status === 0 ? `${prev.stdout.trim()}..HEAD` : "HEAD";
  const subjects = git("log", range, "--no-merges", "--pretty=%s")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !/^(docs|chore|test|refactor)(\(.*\))?:/i.test(s))
    .map((s) => s.replace(/^(feat|fix)(\(.*\))?:\s*/i, ""))
    .map((s) => s.charAt(0).toLocaleUpperCase("tr") + s.slice(1));
  if (prev.status !== 0 || subjects.length === 0) return "- İlk deneme sürümü";
  return subjects.map((s) => `- ${s}`).join("\n");
}
const notes = option("--notes") ?? defaultNotes();

console.log(`\nCubby ${current} → ${version}${beta ? " (deneme)" : ""}\n\nNeler yeni:\n${notes}\n`);

// ---- Sürümü yaz ----
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
pkg.version = version;
writeFileSync(join(ROOT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
tauriConf.version = version;
writeFileSync(join(ROOT, "src-tauri/tauri.conf.json"), JSON.stringify(tauriConf, null, 2) + "\n");
const cargoPath = join(ROOT, "src-tauri/Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${version}"`));

const restore = () => spawnSync("git", ["checkout", "--", ...FILES], { cwd: ROOT, stdio: "inherit" });

// ---- Derle ve imzala ----
const env = { ...process.env };
env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, "utf8");
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = existsSync(passFile) ? readFileSync(passFile, "utf8").trim() : "";
// Plan A: yayın derlemeleri Microsoft girişi olmadan çıkar (docs/MICROSOFT_GIRIS.md).
delete env.MCSM_MS_CLIENT_ID;
const build = spawnSync("bun", ["run", "tauri", "build", "--bundles", "nsis"], {
  cwd: ROOT,
  env,
  stdio: "inherit",
});
if (build.status !== 0) {
  restore();
  die("Derleme başarısız; sürüm değişiklikleri geri alındı.");
}

const dir = join(ROOT, "src-tauri/target/release/bundle/nsis");
const exe = join(dir, `Cubby_${version}_x64-setup.exe`);
const sig = `${exe}.sig`;
if (!existsSync(exe) || !existsSync(sig)) {
  restore();
  die(`Kurulum dosyası ya da imzası bulunamadı: ${exe}`);
}
console.log(`\n✓ Derlendi: ${exe}`);

if (dry) {
  restore();
  console.log("--dry: commit, push ve yükleme yapılmadı; sürüm değişiklikleri geri alındı.");
  process.exit(0);
}

// ---- Commit, etiket, push, GitHub Releases ----
run("git", ["add", ...FILES]);
run("git", ["commit", "-m", `chore: ${version} sürümü`]);
run("git", ["tag", tag]);
run("git", ["push", "origin", "main"]);
run("git", ["push", "origin", tag]);

const notesFile = join(ROOT, "src-tauri/target/release-notes.md");
writeFileSync(notesFile, notes + "\n");
run("gh", [
  "release",
  "create",
  tag,
  exe,
  sig,
  "--title",
  `Cubby ${version}`,
  "--notes-file",
  notesFile,
  ...(beta ? ["--prerelease"] : []),
]);

console.log(`\n✓ Cubby ${version} yayında${beta ? " (deneme kanalı)" : ""}. Kurulu uygulamalar birkaç dakika içinde görür.`);
