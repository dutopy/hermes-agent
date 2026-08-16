# Roadmaps T5c — Session Vision (backend) — point d'état 2026-08-15

Source : session Hermes `20260815_183311_6243e4` (desktop, worktree
`/home/hermes-sys/hermes-worktrees/overview-roadmaps`, branche
`feat/overview-roadmaps`). Archivée le 2026-08-15 après vérification.

## Statut

**Terminée (backend).** La session a atteint la limite d'itérations outils
(tool-call cap) mais a rédigé son rapport final avec des résultats réels
exécutés. Ma vérification indépendante complémentaire a confirmé les tests.

## Modules créés (chemins réels, worktree)

- `hermes_cli/roadmaps_planning_rules.py` (6 849 o, mtime 18:42)
  — `PLANNING_RULES_VERSION = "1.0"`, `get_planning_rules(version=None)`,
  prompt système complet en français, JSON-serializable, immuable par version,
  `PlanningRulesVersionError` pour version inconnue (pas de fallback silencieux).
- `hermes_cli/roadmaps_plan_parser.py` (20 792 o, mtime 18:41)
  — `parse_plan(text, *, source="vision", default_actor="user")` → payload
  exact pour `RoadmapsWriter.create_plan`. JSON strict + fallback Markdown
  documenté. Validations : ids uniques/non-vides, kinds/states valides, parents
  référencés/non-self/acycliques, relations from≠to, todos référencés,
  positions ≥ 0. Normalisations : defaults, génération d'ids déterministes
  collision-free, dédup. `PlanParseError` avec field/index/line/column.

## RPC ajouté

- `roadmaps.planning_rules` dans `tui_gateway/methods_roadmaps.py` — read-only,
  **global (sans scope)**, retourne `{version, rules}`. Version inconnue → 5063 ;
  erreur inattendue → 5061 générique. Ajouté à `_LONG_HANDLERS` dans
  `tui_gateway/server.py`.

## Tests (rapport de session, chiffres réels exécutés)

- Suite canonique : `15 files, 263 tests passed, 0 failed`
  (204 baseline + 59 nouveaux).
- RED confirmé : `ModuleNotFoundError` + 7 échecs RPC.
- GREEN : `79 tests passed, 0 failed` (3 fichiers).
- Nouveaux : `tests/hermes_cli/test_roadmaps_plan_parser.py` (32),
  `tests/hermes_cli/test_roadmaps_planning_rules.py` (12), + RPC/deltas.

## Vérification indépendante (moi, après archivage de session)

- `pytest tests/hermes_cli/test_roadmaps_plan_parser.py
  tests/hermes_cli/test_roadmaps_planning_rules.py -q` → **52 passed**.

## Périmètre non touché (rien effacé)

- Mes modifications advance_node (writer, methods_roadmaps, server.py, tests)
  — intactes.
- Aucun fichier supprimé ; uniquement des ajouts untracked
  (parser, planning_rules, tests).

## Suite

- **T5c reste ouvert côté plugin** : bouton Create (Plan) → `host.newChat`
  profil Vision, écoute `host.onEvent`, affichage en construction parallèle,
  lien roadmap ↔ session (table `roadmap_sessions` additive).
- Le backend T5c (règles + parser + RPC) est prêt à être branché.

## Rollback

- Archivage de session : réversible (`UPDATE sessions SET archived=0`).
- Fichiers untracked : supprimables individuellement si rejet (aucun merge fait).
