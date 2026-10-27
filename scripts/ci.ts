/**
 * Yerel CI: `bun run ci [ui|web|rust]`
 *
 * GitHub Actions kullanılamadığı sürece aynı denetimleri Docker'da (Linux) çalıştırır: arayüz derlemesi,
 * site ve davet API'si (tip denetimi + testler), Rust (fmt, clippy -D warnings, testler). İmaj ilk
 * seferde `ci/Dockerfile`'dan kurulur; Cargo ve bun önbellekleri ile Rust'ın derleme klasörü Docker
 * birimlerinde kalır, sonraki koşular hızlıdır. Depo konteynere salt okunur bağlanır.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const IMAGE = "cubby-ci";
const only = process.argv[2] ?? "all";
if (!["all", "ui", "web", "rust"].includes(only)) {
  console.error("Kullanım: bun run ci [ui|web|rust]");
  process.exit(2);
}

function docker(args: string[]): number {
  return spawnSync("docker", args, { cwd: ROOT, stdio: "inherit" }).status ?? 1;
}

if (docker(["build", "-q", "-t", IMAGE, "ci"]) !== 0) {
  console.error("\n✗ CI imajı kurulamadı (Docker açık mı?)");
  process.exit(1);
}

const status = docker([
  "run",
  "--rm",
  "-v", `${ROOT}:/repo:ro`,
  "-v", "cubby-ci-cargo:/usr/local/cargo/registry",
  "-v", "cubby-ci-target:/work/src-tauri/target",
  "-v", "cubby-ci-bun:/root/.bun/install/cache",
  IMAGE,
  only,
]);
process.exit(status);
