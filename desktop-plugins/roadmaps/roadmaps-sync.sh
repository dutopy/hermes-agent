#!/bin/bash
# Roadmaps — sync bidirectionnelle MBP ↔ VPS worktree.
#
# Usage:
#   ./roadmaps-sync pull   # MBP → VPS : rapatrie les sources du laptop dans le worktree, puis valide
#   ./roadmaps-sync push   # VPS → MBP : déploie le bundle + sources du worktree sur le laptop
#
# Côté VPS (worktree)  : /home/hermes-sys/hermes-worktrees/roadmaps/desktop-plugins/roadmaps/
# Côté MBP (installed) : /Users/pierre/.hermes/desktop-plugins/roadmaps/
#
# Règles :
# - pull  = copie des SOURCES laptop → worktree (src/, config.json, build.mjs, README.md)
#           puis rebuild + node --check + ESLint + tests canoniques (garde de qualité).
# - push  = copie du bundle + sources worktree → laptop (le plugin installé est remplacé),
#           avec rollback horodaté côté laptop et hash vérifié.
# - Ne touche jamais au checkout principal /home/hermes-sys/.hermes/hermes-agent.
# - N'effectue aucun commit.
set -euo pipefail

MODE="${1:-}"
WORKTREE="/home/hermes-sys/hermes-worktrees/roadmaps"
SRC_DIR="$WORKTREE/desktop-plugins/roadmaps"
MBP="mbp"
MBP_DIR="~/.hermes/desktop-plugins/roadmaps"

if [[ "$MODE" != "pull" && "$MODE" != "push" ]]; then
  echo "Usage: $0 pull|push" >&2
  exit 2
fi

echo "== Roadmaps sync ($MODE) =="

if [[ "$MODE" == "pull" ]]; then
  # 1. Vérifier que le dossier source laptop existe
  ssh -o BatchMode=yes "$MBP" "test -f $MBP_DIR/src/index.js && echo LAPTOP_SRC_OK || echo LAPTOP_SRC_MISSING"
  # 2. Copier les sources (pas le bundle, pas node_modules, pas .validate artefacts)
  rsync -az --delete \
    -e "ssh -o BatchMode=yes" \
    --exclude 'node_modules/' \
    --exclude '.validate/' \
    --exclude 'plugin.js' \
    --exclude '.DS_Store' \
    "$MBP:$MBP_DIR/src/" "$SRC_DIR/src/"
  rsync -az -e "ssh -o BatchMode=yes" "$MBP:$MBP_DIR/src/config.json" "$SRC_DIR/src/config.json"
  rsync -az -e "ssh -o BatchMode=yes" "$MBP:$MBP_DIR/README.md" "$SRC_DIR/README.md"
  echo "  sources rapatriées MBP → VPS"
  # 3. Rebuild + validation
  ( cd "$SRC_DIR" && node build.mjs && node --check plugin.js )
  ( cd "$WORKTREE" && ./node_modules/.bin/eslint --config eslint.config.shared.mjs "$SRC_DIR/plugin.js" )
  # 4. Tests canoniques (backend inchangé, mais garde de non-régression)
  ( cd "$WORKTREE" && scripts/run_tests.sh \
      tests/hermes_cli/test_projects_db.py \
      tests/hermes_cli/test_projects_db_roadmaps.py \
      tests/hermes_cli/test_roadmaps_service.py \
      tests/hermes_cli/test_roadmaps_writer.py \
      tests/hermes_cli/test_roadmaps_todo.py \
      tests/hermes_cli/test_roadmaps_tools.py \
      tests/tui_gateway/test_roadmaps_rpc.py \
      tests/tui_gateway/test_roadmaps_rpc_mutations.py \
      tests/tui_gateway/test_roadmaps_rpc_security.py \
      tests/test_roadmaps_contract.py \
      tests/test_roadmaps_store_phase1_contract.py \
      -q 2>&1 | grep -E 'Summary' )
  echo "== pull OK : bundle rebuilt + validations passées. Diff à reviewer avant commit. =="
  ( cd "$WORKTREE" && git status --short -- desktop-plugins/roadmaps/ | head -30 )

elif [[ "$MODE" == "push" ]]; then
  # 1. Rebuild propre côté worktree
  ( cd "$SRC_DIR" && node build.mjs && node --check plugin.js )
  # 2. Rollback horodaté côté laptop
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  ssh -o BatchMode=yes "$MBP" "mkdir -p ~/.hermes/ops/rollback/roadmaps-sync-push-$TS && cp -R $MBP_DIR/ ~/.hermes/ops/rollback/roadmaps-sync-push-$TS/ 2>/dev/null || true"
  # 3. Déployer bundle + sources
  scp -o BatchMode=yes "$SRC_DIR/plugin.js" "$MBP:$MBP_DIR/plugin.js"
  rsync -az --delete \
    -e "ssh -o BatchMode=yes" \
    --exclude 'node_modules/' \
    --exclude '.validate/' \
    --exclude '.DS_Store' \
    "$SRC_DIR/src/" "$MBP:$MBP_DIR/src/"
  scp -o BatchMode=yes "$SRC_DIR/src/config.json" "$MBP:$MBP_DIR/src/config.json"
  scp -o BatchMode=yes "$SRC_DIR/README.md" "$MBP:$MBP_DIR/README.md"
  # 4. Hash vérifié
  LOCAL=$(sha256sum "$SRC_DIR/plugin.js" | cut -d' ' -f1)
  REMOTE=$(ssh -o BatchMode=yes "$MBP" "shasum -a 256 $MBP_DIR/plugin.js | cut -d' ' -f1")
  echo "local=$LOCAL"
  echo "remote=$REMOTE"
  if [[ "$LOCAL" == "$REMOTE" ]]; then
    echo "== push OK : hash identiques. HD rechargera automatiquement (fs-watch). Rollback: $TS =="
  else
    echo "!! HASH MISMATCH — rollback disponible: roadmaps-sync-push-$TS" >&2
    exit 1
  fi
fi
