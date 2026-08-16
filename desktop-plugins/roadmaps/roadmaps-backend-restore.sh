#!/bin/bash
# Roadmaps — re-restaure le backend roadmaps sur le MBP après un `hermes update`.
#
# `hermes update` fast-forwarde ~/.hermes/hermes-agent sur main, qui ne contient
# pas (encore) le chantier roadmaps : les RPC roadmaps.* disparaissent et le
# plugin affiche « méthode inconnue ». Ce script reapplique le patch family-scoped
# depuis le worktree canonique du VPS. Idempotent : sans effet si déjà présent.
#
# Usage : ~/.hermes/desktop-plugins/roadmaps/roadmaps-backend-restore.sh
# Puis redémarrer Hermes Desktop.
set -euo pipefail

VPS="hermes-sys@hermes-vps"
WT="/home/hermes-sys/hermes-worktrees/roadmaps"
AGENT="$HOME/.hermes/hermes-agent"
cd "$AGENT"

# 0. Déjà présent ? → rien à faire.
if venv/bin/python -c "from tui_gateway import server; exit(0 if 'roadmaps.list' in server._methods else 1)" 2>/dev/null; then
  echo "✓ backend roadmaps déjà présent, rien à faire."
  exit 0
fi

echo "→ RPC roadmaps absentes (update a régressé le backend) — restauration…"

# 1. Patch family-scoped généré côté VPS (diff HEAD→worktree du worktree :
#    identique à la procédure de restauration validée ; merge-base est inutilisable
#    car l'historique upstream a été réécrit — pas de base commune fiable).
ssh -o BatchMode=yes "$VPS" \
  "cd $WT && git diff HEAD -- hermes_cli/projects_db.py toolsets.py tui_gateway/server.py" \
  > /tmp/roadmaps-backend.patch
[ -s /tmp/roadmaps-backend.patch ] || { echo "!! patch vide côté VPS — worktree injoignable ou base incohérente"; exit 1; }

# 2. Backup horodaté + apply (échec fermé : git apply aborte, backup intact).
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RB="$HOME/.hermes/ops/rollback/roadmaps-backend-restore-$TS"
mkdir -p "$RB"
cp hermes_cli/projects_db.py toolsets.py tui_gateway/server.py "$RB/"
git apply /tmp/roadmaps-backend.patch

# 3. Fichiers nouveaux (tar over ssh, préserve les chemins).
ssh -o BatchMode=yes "$VPS" "cd $WT && tar -cf - \
  src/roadmaps_contract.py \
  hermes_cli/roadmaps_plan_parser.py \
  hermes_cli/roadmaps_planning_rules.py \
  hermes_cli/roadmaps_service.py \
  hermes_cli/roadmaps_writer.py \
  tools/roadmaps_tools.py \
  tui_gateway/methods_roadmaps.py" | tar -xf -

# 4. Vérification réelle : compile + import + RPC présentes.
venv/bin/python -m py_compile \
  hermes_cli/projects_db.py toolsets.py tui_gateway/server.py \
  src/roadmaps_contract.py hermes_cli/roadmaps_plan_parser.py \
  hermes_cli/roadmaps_planning_rules.py hermes_cli/roadmaps_service.py \
  hermes_cli/roadmaps_writer.py tools/roadmaps_tools.py tui_gateway/methods_roadmaps.py
venv/bin/python -c "from tui_gateway import server; assert 'roadmaps.list' in server._methods"

echo "✓ backend roadmaps restauré (rollback : $RB)."
echo "→ Redémarre Hermes Desktop pour le charger :"
echo "    kill \$(pgrep -f 'hermes desktop') ; sleep 2 ; cd ~/.hermes/hermes-agent && nohup venv/bin/python hermes desktop >/dev/null 2>&1 &"
