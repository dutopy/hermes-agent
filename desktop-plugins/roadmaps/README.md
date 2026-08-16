# Roadmaps — plugin Desktop (mode disk, build esbuild)

Plugin « Roadmaps » pour Hermes Desktop, chargé depuis
`$HERMES_HOME/desktop-plugins/roadmaps/plugin.js` (fichier unique, ESM pur,
UI écrite avec `jsx()`/`jsxs()` de `react/jsx-runtime`). Branche de travail :
`feat/roadmaps` (worktree `hermes-worktrees/roadmaps`).

> **Le fichier livré est `plugin.js`, un ARTEFACT de build.** Ne jamais
> l'éditer à la main : toute modification se fait dans `src/`, suivie d'un
> rebuild (cf. [Build](#build)). La référence git de l'ancien monolithe
> (1891 lignes) est conservée dans `.hermes/ops/quarantine/plugin.roadmaps.pre-structure.js.bak`.

## Structure

```
desktop-plugins/roadmaps/
├── build.mjs            # build esbuild (bundle → plugin.js unique)
├── plugin.js            # ARTEFACT livré — ne pas éditer
├── README.md
├── .validate/
│   └── data-layer.test.mjs   # harnais de la couche données (76 checks, pur Node + host mock)
└── src/
    ├── config.json      # réglages EMBARQUÉS au build (voir plus bas)
    ├── index.js         # entry : registre ROUTES_AREA / SIDEBAR_NAV_AREA, compose la page racine
    ├── data.js          # couche RPC (host.request roadmaps.* + projects.*) + validation
    │                     #   (assertResponseScope, isValidIdentifier, progress 0-100,
    │                     #   projectSelectorItems, validateProjectName)
    │                     #   + ERROR_GUIDANCE anglais + sélecteurs purs du snapshot
    ├── ui.js            # composants locaux partagés (ProgressBar, SectionTitle, NodeStateTag…)
    ├── state.js         # hooks partagés : useQuery list/projects/snapshot, sélection de scope,
    │                     #   hygiène de sélection, compact via ResizeObserver (< seuil config)
    ├── scope.js         # barre de scope : profil (lecture seule), sélecteurs projet/roadmap,
    │                     #   boutons copie + + / ⋮ (compose scope-actions)
    ├── scope-actions.js # flux d'entrée : formulaires inline create/rename projet ET roadmap,
    │                     #   menus ⋮ projet/roadmap (rename/archive/copy id) — RPC natifs
    ├── copilot.js       # CopilotBar data-driven (Next action / Now / In flight / Waiting / Blocked)
    ├── inspector.js     # panneau Inspecteur : mutations claim/progress/complete/block/unblock + todos
    └── views/
        ├── fil.js       # onglet Fil (Thread)
        ├── map.js       # onglet Carte (relations canoniques)
        ├── plan.js      # onglet Plan (historique des versions)
        ├── milestones.js# onglet Jalons
        ├── decisions.js # onglet Décisions (état vide honnête)
        └── files.js     # onglet Fichiers (état vide honnête)
```

## Build

Le loader Desktop lit **uniquement** le texte de `plugin.js` et le charge en
blob URL (pas de filesystem) : tous les imports relatifs doivent donc être
résolus **par le bundle**. Le build garde externes les trois seuls specifiers
nus que le loader réécrit (`@hermes/plugin-sdk`, `react`, `react/jsx-runtime`).

Depuis `desktop-plugins/roadmaps/` :

```sh
node build.mjs
```

Équivalent depuis la racine du worktree (produit le même bundle, sans le
banner « BUILT ARTIFACT » ajouté par `build.mjs`) :

```sh
./node_modules/.bin/esbuild --bundle desktop-plugins/roadmaps/src/index.js \
  --format=esm --outfile=desktop-plugins/roadmaps/plugin.js \
  --external:@hermes/plugin-sdk --external:react --external:react/jsx-runtime \
  --loader:.json=json
```

Post-build (contrôles de non-régression) :

```sh
node --check plugin.js
./node_modules/.bin/eslint --config eslint.config.shared.mjs plugin.js   # depuis la racine du worktree
node .validate/data-layer.test.mjs                                        # 76 checks de la couche données
```

## `src/config.json` — réglages embarqués au build

Le fichier est **embarqué** dans le bundle par esbuild (`import json`) :
modifier une valeur puis **reconstruire** (`node build.mjs`). Aucun code à
toucher pour :

- `compact.threshold` — seuil de compacité (900 px, mesuré via ResizeObserver
  sur le conteneur réel ; valeur initiale non validée visuellement) ;
- `query.listRefetchMs` / `query.projectsRefetchMs` / `query.snapshotRefetchMs` —
  deltas de rafraîchissement (30 s / 30 s / 60 s) ;
- `states.*` — états machine : tons StatusDot, ordre de tri du Fil, labels UI
  (EN ANGLAIS, comme les valeurs techniques `node_id` : l'UI ne réécrit jamais
  la machine d'états, elle la labellise) ;
- `nextActionLabel.*`, `relation.*`, `tabs` — libellés UI anglais ;
- `codicons` — liste documentaire des codicons utilisés (non consommée par le
  code ; éliminée du bundle comme code mort).

## Règles métier : versionnées côté backend, PAS dans le plugin

Le plugin reste un **renderer** : toutes les règles (états autorisés,
transitions, versioning, validation `projects.db`, relations canoniques) sont
portées par le service backend et atteintes **uniquement** via `host.request`
(`roadmaps.*`, `projects.*`, cf. table RPC). Le plugin ne contient aucune
écriture hors `host.request`, aucun fixture, et ne fait jamais confiance aux
messages d'erreur backend (guidance anglaise stable, keyée par code structuré).

## Périmètre

Vertical slice **Fil + Carte + Plan + Jalons + Inspecteur** sur la version
active d'une roadmap :

- **Barre de scope** en haut : `project_id` puis `roadmap_id`. Le sélecteur
  projet est alimenté par **`projects.list`** (RPC natif, scopé au profil
  actif) : `id` / `name` / `slug` réels, projets archivés filtrés, tri par
  nom ; un échec du RPC affiche une erreur générique avec « Retry ». Le
  sélecteur roadmap reste alimenté par `roadmaps.list`. Le profil actif est
  affiché en lecture seule ; un profil absent produit un état « non
  initialisé » explicite — jamais de fallback silencieux vers `default`.
- **Flux d'entrée UI** (boutons `+` / `⋮`) :
  - Projet `+` : formulaire inline (Input + Create/Cancel) → `projects.create`
    (name requis ; le reste reste aux défauts backend), refetch de la liste,
    **le projet créé est sélectionné** (roadmap + nœud réinitialisés).
  - Projet `⋮` : menu (DropdownMenu SDK) — **Rename** (formulaire inline →
    `projects.update`), **Copy ID** (`CopyButton` SDK en item de menu), et
    **Archive** (dialog de confirmation destructif → `projects.archive` ; pas
    de delete). Archiver le projet sélectionné le retire de la liste et
    réinitialise le scope.
  - Roadmap `+` : formulaire inline (Input + Create/Cancel, Entrée/Échap) →
    `roadmaps.create` (titre requis ; `lifecycle_state` forcé `draft` côté
    backend), refetch, **la roadmap créée est sélectionnée**.
  - Roadmap `⋮` : menu (DropdownMenu SDK) — **Rename** (formulaire inline →
    `roadmaps.update` avec `expected_version`), **Copy ID** (`CopyButton` SDK
    en item de menu), **Archive** (dialog de confirmation destructif →
    `roadmaps.archive` avec `expected_version` ; pas de delete). Archiver la
    roadmap sélectionnée la retire de la liste et réinitialise la sélection
    du nœud.
- **Fil** (colonne principale) : « que faire maintenant ? » — nœuds
  `ready` / `in_progress` / `blocked` ordonnés (bloqués d'abord), avec état
  sémantique, progression, owner et `block_reason`.
- **Carte** : relations canoniques (`depends_on`, `blocks`) de la version
  active — relations actives par défaut, bascule pour inclure les inactives.
  Chaque ligne correspond à une relation réelle du snapshot ; rien de
  décoratif.
- **Plan** : historique des versions, plus récentes d'abord, version active
  marquée.
- **Jalons** : nœuds `milestone` / `objective` groupés par parent.
- **Inspecteur** : détails du nœud sélectionné (description, todos, parent),
  champ `actor` (défaut `user`), `expected_version` affiché (= version active
  du snapshot chargé), et les mutations `claim` / `progress` / `complete` /
  `block` / `unblock`. Les erreurs **5064** (version périmée) et **5065**
  (introuvable) proposent un bouton « Reload snapshot » ; la **5066**
  (transition invalide) explique l'état incompatible.
- Sélection cohérente entre les vues ; états vides guidés tant qu'aucun scope
  complet n'est choisi ; base vide ou `found=false` → état vide explicite
  « aucune roadmap pour ce scope » (aucune fixture).
- Compacité responsive : `ResizeObserver` sur le conteneur (seuil configuré,
  documenté non validé visuellement), initialisé depuis `host.state.viewport`.
- Après chaque mutation réussie : rechargement autoritatif du snapshot —
  aucune mutation optimiste du cache.

## RPC utilisés (gateway JSON-RPC via `host.request`)

| Méthode | Params | Rôle |
|---|---|---|
| `projects.list` | *(aucun — scopé au profil actif par le gateway)* | alimente le sélecteur projet (`{projects:[{id,name,slug,archived,…}], active_id}`) |
| `projects.create` | `name` (requis), `slug?`, `folders?`, `primary_path?`, `description?`, `icon?`, `color?`, `board_slug?`, `use?` | formulaire `+` du sélecteur projet |
| `projects.update` | `id`, `name?`, `description?`, `icon?`, `color?`, `board_slug?` | menu `⋮` → Rename |
| `projects.archive` | `id`, `restore?` | menu `⋮` → Archive (soft, jamais delete) |
| `roadmaps.list` | `{profile, project_id?}` | alimente les sélecteurs de scope (roadmap) |
| `roadmaps.snapshot` | `{profile, project_id, roadmap_id}` | source unique des vues |
| `roadmaps.create` | `{profile, project_id, title, roadmap_id?, purpose?, actor?}` | flux `+` roadmap (crée roadmap + version 1 `draft`) |
| `roadmaps.update` | scope + `expected_version, title?, purpose?, actor?` | flux `⋮` → Rename (versionné) |
| `roadmaps.archive` | scope + `expected_version, actor?` | flux `⋮` → Archive (état terminal, réversible par outil) |
| `plans.list` | `{profile, project_id, roadmap_id}` | historique des versions (onglet Plan) |
| `plans.get` | idem + `version` | version complète (nœuds + relations + todos) |
| `roadmaps.claim_node` | scope + `node_id, actor, expected_version` | mutation |
| `roadmaps.update_progress` | idem + `progress` (0-100) | mutation |
| `roadmaps.complete_node` | idem | mutation |
| `roadmaps.block_node` | idem + `reason` (non vide) | mutation |
| `roadmaps.unblock_node` | idem | mutation |
| `roadmaps.update_todo` | idem + `todo_id, state` (`node_id` optionnel) | mutation |

**En attente (tranches suivantes)** : `plans.create` / `plans.activate` /
`plans.validate` existent côté backend mais ne sont pas encore branchés dans
l'UI (flux « Vision » — T5c). Le bouton `+` roadmap crée une roadmap vide
(version 1 `draft`) ; le premier plan réel sera version 2, créé depuis la
session Vision.

Codes d'erreur gérés : 5061 (indisponible), 5062 (projet introuvable), 5063
(validation/scope), 5064 (version périmée), 5065 (introuvable), 5066
(transition invalide).

## Limites

- **Validation visuelle restante sur machine cible.** `node --check` passe et
  les imports/identifiants sont audités contre le SDK, mais le rendu réel
  (chargement blob, sélection de la route `/roadmaps`, états vides, compacité)
  doit être exercé dans Hermes Desktop sur la machine cible : copier ce dossier
  vers `$HERMES_HOME/desktop-plugins/roadmaps/`, puis ⌘K → « Reload desktop
  plugins ».
- Le seuil compact/étendu est une valeur configurée, non mesurée.
- Pas d'affichage des versions antérieures rendues (seule la version active
  l'est) ni d'édition du plan (mutations d'exécution uniquement).
- **Flux « Vision » (T5c)** : `plans.create` / `plans.activate` /
  `plans.validate` existent côté backend mais le bouton « Create plan »
  (session chat HD + règles de planification + parsing) n'est pas encore
  branché dans l'UI.
- Le plugin n'écrit jamais dans `projects.db` directement ; toutes les écritures
  passent par les RPC versionnés (`projects.create` / `update` / `archive`,
  `roadmaps.*`).

## Non-goals (protégé par conception)

- Aucune base SQL créée, aucune écriture directe dans `projects.db`.
- Aucune donnée factice/fixture permanente.
- Aucune modification du checkout principal ; rien n'est committé.
