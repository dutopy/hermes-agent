# Roadmaps — Vision : règles versionnées + parser du plan (T5c-backend)

Statut : implémenté en worktree `feat/overview-roadmaps` (2026-08-15), tests
verts, non commité / non déployé. Tranche UI (T5c-UI) = tranche suivante.

Ce document décrit le flux « Vision » complet côté backend : règles →
session → parse → `plans.create` → activate, et le format JSON STRICT que
l'agent doit produire.

---

## 1. Flux complet (Vision)

1. **Pierre clique Create (Plan)** — le plugin (T5c-UI) appelle le RPC
   read-only `roadmaps.planning_rules` → `{version: "1.0", rules: {...}}`.
2. Le plugin ouvre une session chat nommée **Vision** via
   `host.newChat(profile)` avec le prompt initial = `rules["prompt"]`
   (le prompt système versionné, prêt à injecter tel quel).
3. Pierre discute avec l'agent : l'agent challenge, clarifie, propose des
   alternatives, et produit **un plan en JSON STRICT** (bloc ```json).
4. Le plan est parsé par `hermes_cli.roadmaps_plan_parser.parse_plan(text)`
   — validation + normalisation → payload prêt pour `plans.create`.
   Toute erreur lève `PlanParseError` (champ + index + ligne/colonne) :
   l'agent refond le plan guidé par l'erreur.
5. Le toolset agent appelle `plans.create` (ou directement
   `RoadmapsWriter.create_plan`) avec le payload parsé : version créée en
   `'proposed'` (jamais active), lifecycle roadmap `draft → proposed`.
6. Pierre valide (`plans.validate` → `validated`) puis active
   (`plans.activate` → `in_progress`, `active_version` pointée, ancienne
   version `superseded`). La Map se nourrit du snapshot.

`source` par défaut = `"vision"` ; `actor` par défaut = `"user"` (la
gouvernance enregistre l'acteur réel de `plans.create` — toolset agent sous
autorité de Pierre, ou Pierre directement).

---

## 2. Règles versionnées (`hermes_cli/roadmaps_planning_rules.py`)

- `PLANNING_RULES_VERSION = "1.0"` — constante courante.
- `get_planning_rules(version=None) -> dict` — retourne un dict
  JSON-serialisable : `{version, prompt, format, schema_kinds,
  relation_kinds, node_states, controlled_vocabulary, plan_transitions}`.
  `prompt` est le prompt système complet (FR) : objectif, contraintes
  (scope roadmap/projet/contexte), structure de sortie STRICTE, règles
  qualité (cohérence, dépendances explicites, pas de doublons, jalons
  mesurables, vocabulaire contrôlé milestone/epic/task → kinds, transitions
  de plan), règles de comportement (jamais inventer de faits, demander
  clarification, proposer des alternatives, refondre sur `PlanParseError`).
- **Versionnement** : modifier les règles = nouvelle version dans `_RULES` +
  `PLANNING_RULES_VERSION` avancé ; jamais d'édition silencieuse. Version
  inconnue → `PlanningRulesVersionError` (message propre, liste des versions
  connues) — aucun fallback silencieux.
- Consommateurs : RPC `roadmaps.planning_rules` (plugin) et import direct
  (toolset agent).

---

## 3. Format JSON STRICT (contrat de sortie de l'agent)

C'est exactement la forme que `plans.create` attend (payload nodes/relations/
todos validé par `RoadmapsWriter`). Tous les ids fournis sont conservés tels
quels ; un id manquant est généré (n_/r_/t_ + 4 chiffres).

```json
{
  "title": "string — titre du plan",
  "purpose": "string (optionnel)",
  "nodes": [
    {
      "node_id": "string unique",
      "kind": "objective|phase|milestone|step|decision",
      "title": "string non vide",
      "description": "string (optionnel)",
      "parent_node_id": "string (optionnel, doit référencer un node du plan, jamais soi-même)",
      "state": "planned|ready|in_progress|blocked|completed|archived (optionnel, défaut planned)",
      "progress": "0-100 (optionnel, défaut 0)"
    }
  ],
  "relations": [
    {
      "relation_id": "string unique",
      "from_node_id": "string — node du plan",
      "to_node_id": "string — node du plan (jamais égal à from_node_id)",
      "kind": "depends_on|blocks|enables|follows|validates|supersedes",
      "reason": "string (optionnel)"
    }
  ],
  "todos": [
    {
      "todo_id": "string unique",
      "node_id": "string (optionnel, doit référencer un node du plan)",
      "title": "string non vide",
      "position": "entier >= 0 (optionnel, défaut 0)"
    }
  ]
}
```

---

## 4. Parser (`hermes_cli/roadmaps_plan_parser.py`)

`parse_plan(text, *, source="vision", default_actor="user") -> dict` retourne
`{title, purpose, source, actor, nodes, relations, todos}` où nodes/
relations/todos sont **exactement** la forme normalisée que
`RoadmapsWriter.create_plan` valide (mêmes clés, mêmes défauts).

### Entrées acceptées
1. **JSON STRICT** — texte JSON pur, ou dans une fence ```json ... ``` (la
   fence gagne sur la prose environnante). Chemin fiable, exigé de l'agent.
2. **Markdown structuré** — fallback DOCUMENTÉ, moins fiable (l'agent DOIT
   sortir du JSON) :
   - `# Title` → titre du plan ;
   - `## <kind>: <title>` (kind objective|phase|milestone|step|decision) —
     sinon niveau de heading : 2→phase, 3→milestone, 4→step, 5→decision ;
     le parent vient de l'imbrication des headings ;
   - `- [ ]` / `- [x]` → todos attachés au node le plus récent (`done` si [x]) ;
   - `- <kind>: <From> -> <To>` → relation résolue par titre de node UNIQUE.

### Validation (les deux formes)
- `node_id` : non vides, uniques ; kind valide ; titre non vide ;
  `parent_node_id` référencé, ≠ self, acyclique.
- relations : `from_node_id`/`to_node_id` référencés, from ≠ to, kind valide.
- todos : `node_id` référencé ou null ; `position` entier ≥ 0.
- titre du plan non vide ; au moins un node (un plan sans node est rejeté).

### Normalisation
- Défauts : node `state="planned"`, `progress=0`, description/parent/owner/
  block_reason None ; relation `state="active"`, reason None ; todo
  `state="open"`, `position=0`.
- ids fournis conservés tels quels ; ids manquants générés
  (`n_0001`/`r_0001`/`t_0001`, compteur déterministe, sans collision avec
  les ids existants).
- Dédoublonnage : relations identiques (même from/to/kind) et todos
  identiques (même node/titre) → première occurrence conservée.

### Erreurs : `PlanParseError(ValueError)`
Attributs structurés : `field` (`nodes[2].kind`, `relations[0].to_node_id`,
`todos[0].position`, …), `index`, `line`/`column` (pour les erreurs de
syntaxe JSON, position dans le texte source). `str()` = message — champ —
ligne/colonne. L'agent refond le plan guidé par ces erreurs.

---

## 5. RPC `roadmaps.planning_rules`

- Méthode read-only, **globale** : aucun scope profile/project/roadmap requis.
- Paramètres : `{version?: string}` (défaut = version courante).
- Retour : `{version: "1.0", rules: {...}}` — dict JSON-serialisable, aucun
  secret, aucune donnée DB.
- Erreurs : version inconnue / params invalides → **5063** (message propre,
  jamais le message backend brut) ; erreur inattendue → **5061**
  `"roadmaps unavailable"` (détail loggé serveur).
- Inscrit dans `_LONG_HANDLERS` (uniformité avec les autres roadmaps reads).
- Implémentation : `tui_gateway/methods_roadmaps.py` → helper
  `_planning_rules_handle` exposé sur le serveur via `register()`.

---

## 6. Tests (TDD RED→GREEN)

- `tests/hermes_cli/test_roadmaps_plan_parser.py` (32) : JSON strict ok, JSON
  en fence ok, rejets (titre vide, kind invalide, parent inconnu/self/cycle,
  relation orpheline/self/kind invalide, todo node inconnu, duplicate ids,
  état/progress/position invalides, non-JSON), normalisation (défauts,
  génération d'ids, conservation des ids fournis, dédoublonnage), erreurs
  structurées (champ + ligne/colonne), fallback Markdown (comportement
  documenté), **intégration** `parse_plan → RoadmapsWriter.create_plan` sur
  base temporaire (version 2, state proposed, counts 4/1/2, nodes persistés).
- `tests/hermes_cli/test_roadmaps_planning_rules.py` (12) : version courante,
  version explicite, None = courante, version inconnue → erreur propre,
  prompt non vide, objectif/contraintes/structure JSON/qualité/comportement
  présents, sérialisable JSON, immuabilité par version.
- `tests/tui_gateway/test_roadmaps_rpc_plans.py` (+15) : handler enregistré,
  dans `_LONG_HANDLERS`, version + rules sans scope, version explicite,
  version inconnue → 5063 propre, params invalides → 5063, erreur inattendue
  → 5061 générique sans fuite.

Suite canonique : **15 fichiers, 263 tests verts** (204 existants + 59
nouveaux). `py_compile` OK, `git diff --check` OK.

---

## 7. Décisions

| Sujet | Décision |
|---|---|
| ids fournis | conservés tels quels (aucune réécriture de préfixe) |
| ids manquants | générés `n_`/`r_`/`t_` + compteur 4 chiffres (déterministe, anti-collision) |
| Markdown | fallback documenté (grammaire §4), jamais la voie recommandée |
| Dédoublonnage | relations/todos identiques dédupliqués (première occurrence) ; ids dupliqués = erreur |
| Plan sans node | rejeté (`PlanParseError`) |
| RPC | ajouté : plus propre pour le plugin (qui ne peut pas importer Python) |
| Erreurs RPC | 5063 validation propre / 5061 générique — jamais le message brut |
| Versionnement | `_RULES` immuables par version ; `PlanningRulesVersionError` sur version inconnue |
