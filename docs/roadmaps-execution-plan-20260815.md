# Roadmaps — Plan d'exécution optimal (T5 → T8)

Validé Pierre 2026-08-15 : « tout doit être anticipé, étudié, disséqué, organisé,
planifié, exécuté. Autant de runs que nécessaire, plan optimal. »

Ce document EST le plan d'exécution. Chaque tranche a : périmètre, dépendances,
gates, risques, critères de sortie. Ordre optimisé par dépendance + valeur.

---

## Constat d'audit (faits vérifiés)

1. **Modèle de données déjà complet** pour la vision : `roadmap_nodes.kind`
   (objective/phase/milestone/step/decision), `roadmap_relations`
   (depends_on/blocks/enables/follows/validates/supersedes),
   `roadmap_versions` (draft/proposed/validated/superseded/archived),
   `roadmap_todos` (open/in_progress/done/cancelled). **Aucune migration
   nécessaire** pour T5/T6/T7.
2. **Backend actuel** : read (list/get/snapshot) + mutations exécution
   (claim/progress/complete/block/unblock/todo). **Manque** : CRUD roadmap,
   CRUD plan (versions), commentaires, attachement sessions, liaison kanban.
3. **Plugin modulaire** (src/ + esbuild) avec flux d'entrée T5a déployé
   (projets via projects.list natif, + / ⋮, roadmap + / ⋮ honnêtes T5b).
   T6a-layout en cours.
4. **SDK plugin** : `host.newChat(profile)`, `host.openSession(id, {profile})`,
   `host.onEvent(type, cb)`, `host.request(method, params)` — la session
   « Vision » est faisable nativement.
5. **Checkout principal VPS** : 3 familles de chantiers non committées
   (project_worktrees, miroir Discord, roadmaps) — **risque hermes update**.
6. **Dev laptop** opérationnel (MBP : src/ + build.sh + esbuild + hot-reload
   fs-watch ; VPS : worktree miroir ; roadmaps-sync pull/push).

---

## Ordre optimal (dépendances strictes)

### T5b — CRUD roadmap + plan backend (FONDATION — tout dépend de lui)

**Statut : FAIT (2026-08-15)** — implémenté en worktree `feat/overview-roadmaps`,
backend pur (roadmaps_writer.py + roadmaps_service.py + methods_roadmaps.py),
tests TDD RED→GREEN (49 nouveaux : 36 writer/plans + 13 RPC), suite canonique
verte (132 + 49 = 181). Non commité, non déployé — revue + merge 3-way avant
déploiement.

Conventions adoptées (vérifiées sur le schéma et le code existant) :
- `roadmaps.create` → `lifecycle_state='draft'` (état frais du read side),
  `active_version=NULL`, + **version 1** (`roadmap_versions.state='draft'`,
  marqueur vide, source `roadmaps.create`) dans UNE transaction ; le premier
  plan réel sera donc la version 2 ; `roadmap_id` généré `r_` + 8 hex si absent.
- `expected_version` = version active observée par l'appelant, **0 quand la
  roadmap n'a pas encore de version active** (convention 5064 conservée).
- `roadmaps.archive` → état terminal `archived` (versions conservées,
  historique lisible) ; archiver une roadmap déjà archivée → erreur explicite.
- `plans.create` → payload complet validé AVANT insertion (nœuds uniques,
  kinds/states valides, parent référencé dans le payload et non-self, relations
  from≠to + acycliques, todos node_id référencés ou NULL), tout en UNE
  transaction atomique (rollback vérifié par counts) ; version créée en
  **'proposed'** (jamais active) ; lifecycle roadmap `draft → proposed` ;
  doublon de version → erreur (5067) ; `content_hash` sha256 du payload.
- `plans.validate` → transition version `draft|proposed → validated`
  (machine d'état des VERSIONS, distincte de la machine lifecycle roadmap du
  contrat pur src/roadmaps_contract.py — non modifié) ; autorité : toolset
  agent sous autorité de Pierre, ou Pierre directement ; l'acteur est enregistré
  sur `roadmaps.updated_by` (roadmap_versions n'a pas de colonne updated_by).
- `plans.activate` → version **validated** obligatoire sinon erreur explicite ;
  `active_version` pointe dessus, l'ancienne version active passe en
  **'superseded'** (historique conservé), lifecycle → `in_progress`
  (l'activation démarre l'exécution).
- RPC : `roadmaps.create/update/archive`, `plans.create/list/get/activate/validate`
  — codes 5063 validation, 5064 périmé, 5065 introuvable, 5066 transition
  invalide, **5067 conflit (version/id existe)**, 5061 générique ; aucun message
  backend brut (log server-side, message générique).

Périmètre :
- `roadmaps.create / roadmaps.update / roadmaps.archive` (title, purpose,
  lifecycle_state, active_version) — validations scope complètes, versions
  défensives, dédiées `RoadmapsWriteError` propres.
- `plans.create` (version + nœuds + relations + todos en un payload validé,
  transactionnel) ; `plans.list` ; `plans.get` ; `plans.activate` ;
  `plans.validate` (transitions draft→proposed→validated).
- Vérification d'intégrité après chaque écriture (FK, cycles relations,
  parent existant) — rejet explicite, jamais réparation silencieuse.
- Tests adversariaux (TDD) : scope inconnu, version périmée, relation
  cyclique, parent manquant, payload invalide, rollback atomique.

Dépendances : aucune.
Gates : revue indépendante (architecture + qualité/sécurité) ; suite canonique
verte ; `git diff --check` ; déploiement runtime principal VPS (merge 3-way).
Critère de sortie : depuis l'UI, créer/archiver une roadmap ; depuis le toolset
agent, créer un plan complet avec relations.

### T5c — Plan setup + session « Vision » intégrée

**Statut : À REPRENDRE CÔTÉ PRODUIT/UX (2026-08-15)** — tranche backend
(T5c-backend) implémentée
en worktree `feat/overview-roadmaps` : règles versionnées
(`hermes_cli/roadmaps_planning_rules.py`, v1.0), parser strict du plan
(`hermes_cli/roadmaps_plan_parser.py` + `PlanParseError` structuré), RPC
read-only `roadmaps.planning_rules` (dans `_LONG_HANDLERS`, scope non requis),
tests TDD RED→GREEN (59 nouveaux : 32 parser + 12 rules + 15 RPC/plans),
suite canonique verte. Le premier branchement UI ouvrait une session Desktop
séparée via `host.openSession` : il est techniquement valide mais rejeté comme
expérience finale. Reste : surface de session native embarquée dans Roadmaps,
parcours Plan-first et validation réelle d'un plan de démonstration.
Voir `docs/roadmaps-vision-t5c.md` pour le flux complet.

Périmètre :
- **Règles versionnées** : `roadmaps_planning_rules.py` — `PLANNING_RULES_VERSION`
  = "1.0", `get_planning_rules(version=None)` → dict JSON-serialisable
  (prompt système prêt à injecter + schéma strict + kinds/states +
  vocabulaire contrôlé + transitions de plan). Version inconnue →
  `PlanningRulesVersionError` (jamais de fallback silencieux).
- **Parser du plan** : `roadmaps_plan_parser.py` — `parse_plan(text, *,
  source="vision", default_actor="user")` accepte le JSON STRICT (pur ou dans
  une fence ```json) ou le Markdown structuré (fallback DOCUMENTÉ, moins
  fiable — l'agent DOIT sortir du JSON). Validation : node_id non vides et
  uniques, kinds valides, titres non vides, parents référencés/non-self/
  acycliques, relations from≠to référencées + kinds valides, todos node_id
  référencés ou null, positions ≥ 0. Normalisation : défauts state/progress
  (planned/0), ids fournis conservés, ids manquants générés (n_/r_/t_ + 4
  chiffres), dédoublonnage relations/todos identiques. Erreurs :
  `PlanParseError` structuré (champ + index + ligne/colonne pour les erreurs
  de syntaxe JSON) — l'agent refond le plan guidé par l'erreur.
- **RPC** : `roadmaps.planning_rules` (read-only, GLOBAL — pas de scope
  profile/project/roadmap) → `{version, rules}` sans secret ; version
  inconnue → 5063, erreur inattendue → 5061 générique (jamais le message
  brut) ; inscrit dans `_LONG_HANDLERS` comme les autres roadmaps.
- **Plan setup obligatoire** (UI) : une roadmap sans plan actif ouvre
  directement l'atelier Plan/Vision ; aucune navigation secondaire ne peut
  masquer cette étape.
- **Session Vision intégrée** : le transcript/composer core est rendu dans le
  workbench Roadmaps via une surface Desktop native réutilisable ;
  `host.openSession` reste une action secondaire, jamais le flux principal.
- Une fois validé : `plans.create` appelé par le toolset agent
  (`parse_plan` → payload prêt → `RoadmapsWriter.create_plan`), puis refetch
  → la Map s'alimente.
- Lien roadmap ↔ session Vision persisté (table `roadmap_sessions` additive,
  migration optionnelle — T5c-UI).

Dépendances : T5b.
Gates : gate indépendante ; tests RPC session + parser (RED→GREEN) — T5c-backend
fait ; validation réelle d'un plan de démonstration via le toolset (reste).
Critère de sortie : une roadmap vide arrive directement dans Plan setup ; Pierre
discute avec Vision sans quitter la fenêtre Roadmaps ; le plan se construit à
côté du chat, se valide, s'active, puis seulement le workspace d'exécution et la
Map deviennent la surface principale.

### T6a — Map V1 hiérarchique + popup contextuel (SUSPENDU)

Périmètre :
- **V1 sans drag** : layout hiérarchique gauche→droite dérivé des relations
  canoniques (`depends_on`/parent), groupé par milestone/phase ; colonnes
  implicites par niveau de dépendance ; pas de coordonnées codées.
- **Popup contextuel** translucide sur bloc/tâche : infos, boutons d'action
  (mutations existantes), commentaires (read), ouverture session dédiée
  (`host.openSession` — lien roadmap_sessions), todos attachées.
- **V2 prévue** (plus tard, sans refonte) : positions libres, drag des blocs +
  drag du fond, table `roadmap_layout` additive optionnelle.

Dépendances : T5b (plans réels), **nouvelle refonte Plan-first + session
intégrée terminée**. L'ancien T6a-layout 3/2/1 n'est plus une dépendance : il
doit être remplacé par le workbench corrigé.
Gates : gate UI ; tests harnais data (layout dérivé) ; validation visuelle MBP.
Critère de sortie : une roadmap avec plan affiche l'arborescence gauche→droite ;
cliquer un bloc ouvre le popup complet.

### T6b — Liaison task ↔ Kanban

Périmètre :
- Audit des RPC kanban existants (boards/columns/cards).
- Lien `roadmap_todos` ↔ carte kanban (id kanban optionnel sur le todo,
  migration additive) ; refléter l'état kanban dans le bloc task et
  réciproquement (déterminer l'autorité : kanban = exécution, roadmap = plan).
- Au minimum : read de l'état kanban dans le popup task ; sync ciblée.

Dépendances : T6a.
Gates : gate indépendante ; tests liaison ; validation visuelle.
Critère de sortie : une task affiche sa carte kanban et son état réel.

### T7 — Copilot enrichi (Next action / In flight / Trajectoires)

Périmètre :
- Panel contextuel translucide, navigation fluide, compact si besoin.
- Données : next action (ready + dépendances satisfaites), in flight
  (in_progress), trajectoires (chaîne critique, dependants), risques
  (blocked + reason).
- Zéro LLM : tout calculé depuis le snapshot réel ; clic → sélection nœud.

Dépendances : T6a (Map), T5b (données plans).
Gates : gate UI ; tests harnais (fonctions de trajectoire) ; validation MBP.
Critère de sortie : le Copilot répond « que faire maintenant ? » de façon
actionnable sur n'importe quelle roadmap réelle.

### T8 — Hardening + commits par famille + packaging

Périmètre :
- **Commits par famille** (URGENT, risque hermes update) : worktrees / miroir
  Discord / roadmaps — chacun séparément, sur branches dédiées, revue avant
  merge sur main du VPS. Inclut le worktree (docs + plugin + backend).
- Hardening : suppression des `.validate/` temporaires, README complet,
  `roadmaps-sync` documenté, seed de démonstration propre.
- Packaging : archive reproductible + SHA-256 + rollback horodaté + déploiement
  final MBP + runtime VPS.
- Tests finaux complets ; docs à jour (vision, architecture, layout, sync).

Dépendances : tout le reste.
Gates : revue finale ; suite complète ; git log propre par famille.
Critère de sortie : chantier livré, déployé, documenté, reproductible.

---

## Risques & mitigations

| Risque | Mitigation |
|---|---|
| `hermes update` écrase le checkout principal (3 familles non committées) | **T8 à faire en parallèle des T5-T7** : au minimum committer les 2 familles non-roadmaps dès maintenant (worktrees + miroir) sur branches dédiées |
| T5b ajoute du backend dans le checkout principal déjà sale | merge 3-way systématique + rollback horodaté + tests 120+ avant/après |
| Session Vision : parsing imprécis du plan | format de sortie STRICT (JSON/texte balisé), parser testé adversarialement, rejet explicite + refonte guidée |
| Liaison kanban : double autorité (kanban exécution vs roadmap plan) | décision explicite : kanban = état d'exécution, roadmap = plan ; le lien est read + sync ciblée, jamais de double écriture |
| Map drag&drop (V2) trop ambitieux trop tôt | V1 sans drag (relations canoniques) ; V2 = couche additive seule |
| Le plugin devient gros (monolithe de retour) | contrat de module src/ : 1 fichier par domaine, data.js seul RPC |

---

## Décisions attendues de Pierre

1. **Commits maintenant ?** (recommandé : oui, les 2 familles non-roadmaps sur
   branches dédiées, sans merge sur main tant que non revus)
2. Ordre des tranches : **T5b → T5c → T6a → T6b → T7** validé ?
3. Format de sortie de la session Vision : JSON strict recommandé ?
