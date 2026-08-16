# HANDOFF — Roadmaps : suite de la session « Construire la cartographie visuelle d’Hermes »

## Pourquoi ce handoff

Pierre a transféré la conversation Roadmaps dans la session Desktop `20260813_112716_a2cef1` (laptop, backend SSH hermes-vps, profil default). Ce document résume tout ce qui a été dit, décidé et produit afin que cette session puisse continuer le chantier sans perte de contexte.

## 1. Décisions de Pierre (validées, à respecter)

1. **Roadmaps n’est pas un remplacement** des outils natifs Hermes. C’est une couche d’orchestration qui **étend et relie** les primitives existantes :
   - Projects (`projects.db`) → périmètre et scope
   - Kanban → exécution des tâches, dépendances, claims, reviews
   - outil `todo` → décomposition au sein d’une session
   - sessions/agents/délégations → exécution
   - événements gateway → flux live
2. **Les agents devront interagir avec Roadmaps** comme une extension incontournable, **via un panel d’outils procéduraux** (toolset `roadmaps`), contrôlé : scope explicite, acteur, versions, permissions, idempotence.
3. Roadmaps reste **optionnel pour les conversations ordinaires** — il ne doit pas s’imposer aux agents non rattachés à un projet orchestré.
4. Le plugin Desktop est un **renderer/cache** : jamais d’SQL, jamais de base parallèle, jamais d’autorité métier dans le plugin.
5. Stratégie d’implémentation backend-first : autorité durable d’abord, projection UI ensuite.

## 2. État du chantier au VPS (worktree `/home/hermes-sys/hermes-worktrees/overview-roadmaps`, branche `feat/overview-roadmaps`)

### Layers livrés (tous testés, 210 tests verts, aucun commit)

- **Phase 0 — contrat pur** : `src/roadmaps_contract.py` (+ `tests/test_roadmaps_contract.py`, 29 tests). Scope qualifié, relations same-scope, EventEnvelope metadata-only, transitions plan/nœud, replay idempotent.
- **Phase 1 — store** : tables `roadmaps`, `roadmap_versions`, `roadmap_nodes`, `roadmap_relations`, `roadmap_todos` dans `hermes_cli/projects_db.py` (DDL + contrat indépendant + migration additive). Colonne `block_reason` ajoutée en évolution additive. Tests : `tests/test_roadmaps_store_phase1_contract.py` (28), `tests/hermes_cli/test_projects_db_roadmaps.py` (16).
- **Phase 2 — lecture** : `hermes_cli/roadmaps_service.py` (RoadmapsService, SQLite mode=ro, snapshot complet) + RPC gateway `roadmaps.list/get/snapshot` dans `tui_gateway/methods_roadmaps.py`. Tests : `tests/hermes_cli/test_roadmaps_service.py` (9), `tests/tui_gateway/test_roadmaps_rpc.py` (6).
- **Phase 2bis — mutations d’exécution** : `hermes_cli/roadmaps_writer.py` (RoadmapsWriter : claim_node, update_progress, complete_node, block_node, unblock_node — acteur obligatoire, expected_version verrou optimiste, transitions via le contrat pur, transaction IMMEDIATE). RPC `roadmaps.claim_node/update_progress/complete_node/block_node/unblock_node` avec codes d’erreur structurés 5063/5064/5065/5066/5061, inscrites dans `_LONG_HANDLERS`. Tests : `tests/hermes_cli/test_roadmaps_writer.py` (11), `tests/tui_gateway/test_roadmaps_rpc_mutations.py` (8).
- **Phase 3 — panel agent** : `tools/roadmaps_tools.py` — toolset `roadmaps` déclaré dans `toolsets.py` avec 7 outils : `roadmap_list`, `roadmap_context`, `roadmap_claim_node`, `roadmap_update_progress`, `roadmap_complete_node`, `roadmap_block_node`, `roadmap_unblock_node`. Tests : `tests/hermes_cli/test_roadmaps_tools.py` (9).
- **Documentation** : `docs/roadmaps-orchestration-contract.md`, `docs/roadmaps-store-phase1.md`, `docs/roadmaps-service-phase2.md`, `docs/roadmaps-agent-tools-phase3.md`.

## 3. Plugin Desktop — trois générations

1. **Ancien proto « cartes »** (fixtures statiques) : **installé sur le laptop**, c’est lui qui s’affiche actuellement dans HD. À remplacer.
2. **Version modulaire corrigée** (quarantaine `~/.hermes/ops/quarantine/desktop-plugin-prototypes-20260813/hermes-roadmaps/plugin.js`, 159 lignes, statique) : reviewée, jamais installée (SSH MBP refusé). **Obsolète.**
3. **Nouvelle version (la cible)** : `/home/hermes-sys/hermes-worktrees/overview-roadmaps/desktop-plugins/roadmaps/plugin.js` — 747 lignes, branchée sur les **RPC réels** `roadmaps.list/snapshot/claim_node/update_progress/complete_node/block_node/unblock_node`, zéro fixture. Vertical slice **Fil + Carte + Inspecteur** :
   - barre de scope : profil (lecture seule, état « non initialisé » si absent, jamais de fallback default) → projet → roadmap (Select avec SelectContent/SelectItem) ;
   - **Fil** : nœuds ready/in_progress/blocked triés blocked-first + block_reason ;
   - **Carte** : relations canoniques actives (depends_on, blocks) de la version active ;
   - **Inspecteur** : détails nœud + mutations (actor, expected_version, erreurs 5064/5065/5066 actionnables, rechargement snapshot après chaque mutation) ;
   - compact < 900px via ResizeObserver ; sélection cohérente entre vues ; états vides guidés.

### Gates déjà passées par la v3

- `node --check` ✅ ; imports limités au contrat disk (plugin-sdk, react, jsx-runtime) ✅ ; tous les symboles SDK vérifiés contre `apps/desktop/src/sdk/index.ts` ✅ ; aucune fixture ✅ ; 5 appels host.request vérifiés ✅.

### Ce qui reste à faire sur la v3 (gates restantes)

1. Revue qualité/sécurité adversariale (accès cross-scope, injection via titres/descriptions, XSS, statut des erreurs).
2. Packaging : archive reproductible + SHA-256 + rollback horodaté.
3. **Transfert + installation sur le laptop** (SSH refusé hier — décision Pierre requise : clé de déploiement dédiée, clé existante, ou commande locale).
4. Validation visuelle réelle dans HD sur le laptop : reload plugins (⌘K), sélection répétée de la route /roadmaps, changement de profil, viewport étroit.

## 4. Rappel des invariants de Pierre

- Auditer avant d’agir ; rollback avant modification ; vérifier avec sortie réelle ; ne jamais déclarer succès sans preuve.
- Pierre préfère les worktrees pour les travaux parallèles.
- Commandes que Pierre exécute lui-même : bloc de code seul copiable.
- Plugins HD : mode disk sur les Macs (~/.hermes/desktop-plugins/), pas bundled.
- Roadmaps doit rester « la pièce durable d’orchestration par projet et profil ».

## 5. Prochaines étapes recommandées

1. Gates qualité/sécurité sur la v3 du plugin (revue indépendante).
2. Décision d’accès laptop (voir §3).
3. Installation + validation visuelle réelle.
4. Puis : seed d’une roadmap réelle dans projects.db (via outil dédié ou migration douce) pour que l’UI montre des données canoniques ; gouvernance de plan (proposer/valider/réviser) ; événements canoniques + curseur.
