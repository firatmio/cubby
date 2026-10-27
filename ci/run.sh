#!/usr/bin/env bash
# Konteynerin içinde: depo /repo'ya salt okunur bağlanır, /work'e kopyalanır (Windows'taki node_modules,
# target ve dist'e dokunulmaz). Üç iş GitHub'daki gibi ayrı ayrı koşar; biri düşse de diğerleri sürer.
set -uo pipefail

tar -C /repo --exclude=./node_modules --exclude=./web/node_modules --exclude=./src-tauri/target \
  --exclude=./dist --exclude=./.git -cf - . | tar -C /work -xf -

results=()
job() {
  local name=$1; shift
  echo
  echo "━━━ $name ━━━"
  local start=$SECONDS
  if (set -e; "$@"); then
    results+=("✓ $name ($((SECONDS - start)) sn)")
  else
    results+=("✗ $name ($((SECONDS - start)) sn)")
  fi
}

ui() {
  cd /work
  bun install --frozen-lockfile
  bun run build
}
web() {
  cd /work/web
  bun install --frozen-lockfile
  bun run typecheck
  bun test
}
rust() {
  cd /work/src-tauri
  cargo fmt --check
  cargo clippy --all-targets -- -D warnings
  cargo test
}

only=${1:-all}
[[ $only == all || $only == ui ]] && job "UI (TypeScript)" ui
[[ $only == all || $only == web ]] && job "Website and invite API" web
[[ $only == all || $only == rust ]] && job "Backend (Rust, Linux)" rust

echo
echo "━━━ Sonuç ━━━"
failed=0
for r in "${results[@]}"; do
  echo "$r"
  [[ $r == ✗* ]] && failed=1
done
exit $failed
