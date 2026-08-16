# Roadmaps — Architecture modulaire & connectivité (contrat de structure)

Validé par Pierre le 2026-08-14. Ce document est le **contrat de structure** :
toute tranche d'implémentation doit s'y conformer, tout nouveau module doit
s'y brancher sans complication.

## 1. Principes

1. **Le plugin est un renderer/cache, jamais une autorité.** La logique métier,
   les règles, les transitions et les permissions vivent backend (contract pur +
   writer + RPC), versionnées et testées.
2. **Modularité = des modules cloisonnés, un bundle unique.** Chaque domaine
   (scope, plan, map, copilot, inspector, views) est un module `src/` autonome ;
   esbuild agrège en `plugin.js` unique (contrainte du loader blob).
3. **Connectivité = RPC natifs uniquement.** Le plugin pilote les fonctionnalités
   natives Hermes via `host.request` (projects.*, session.*, roadmaps.*, kanban*).
   Jamais d'accès direct DB/SQL/fs.
4. **Ajouter un module = créer un fichier + le brancher dans index.js.** Rien
   d'autre ne change. La configuration se fait dans `src/config.json`.
5. **Les fonctions natives sont intégrées et pilotées simplement** : un module
   déclare ses besoins (RPC, événements, données) via une interface minimale et
   le reste du plugin n'a pas à connaître son implémentation.

## 2. Contrat de module

Chaque module exporte un objet descriptif :

```js
// src/views/ma-vue.js
export default {
  id: 'ma-vue',                 // identifiant de l'onglet
  label: 'My View',             // label UI (anglais)
  codicon: 'milestone',         // icône nav (voir config.json → codicons)
  // Composant rendu dans la zone active (reçoit le scope + l'état partagé)
  render: (ctx) => jsx(MyView, { scope: ctx.scope, state: ctx.state }),
  // RPC natifs utilisés — déclaration pour audit et intégrité
  rpc: ['roadmaps.snapshot', 'projects.list'],
  // État vide honnête si la capacité backend n'existe pas encore
  unavailable: 'Coming with Phase N — no fixture.'
}
```

Branchement dans `src/index.js` :

```js
import MyView from './views/ma-vue.js'
const MODULES = [Fil, Carte, Plan, Jalons, Decisions, Files, MyView]
```

C'est tout. Aucune autre modification.

## 3. Couches et dépendances (sens unique)

```
src/index.js  (composition, routes)
   └── src/state.js  (hooks partagés : queries, scope, sélection, compact)
         └── src/data.js  (couche RPC : host.request, validation, erreurs)
               └── (backend : roadmaps.* / projects.* / session.* / kanban*)
```

- `data.js` est le seul module qui appelle `host.request`.
- `state.js` est le seul module qui possède l'état partagé (scope, sélection,
  queries, compact).
- Les views/inspector/copilot ne reçoivent que des props (état + callbacks).
- Aucun module n'importe un autre module de la même couche vers le haut
  (une view n'importe jamais une autre view).

## 4. Intégration de fonctionnalités natives

Toute intégration native passe par une **fonction pilote** dans `data.js` :

```js
// Piloter un projet existant depuis Roadmaps
export function projectCreate(params) { return rpc('projects.create', params) }
export function projectArchive(id)    { return rpc('projects.archive', { project_id: id }) }
export function openSession(params)   { return rpc('session.create', params) }  // session « Vision »
```

Les primitives réutilisées aujourd'hui (audit 2026-08-14, checkout principal) :

| Capacité | RPC natif | Statut |
|---|---|---|
| Créer/lister/archiver/renommer des projets | `projects.create/list/update/archive/delete` | ✅ existant |
| Ouvrir une session chat HD (Vision) | `session.create`, `session.steer`, `session.title` | ✅ existant |
| Lire roadmaps + mutations exécution | `roadmaps.*` (list/get/snapshot + claim/progress/complete/block/unblock/update_todo) | ✅ existant |
| CRUD roadmaps/plans (create/validate/archive) | — | ❌ à créer (tranche T5b) |
| Task ↔ carte Kanban | kanban (board) | ⚠️ à concevoir (T6b) |

## 5. Stratégie Map — simple d'abord, extensible ensuite

La vision finale : arborescence multidirectionnelle gauche→droite, blocs
milestone/epic/task, drag du fond, popup translucide contextuel.

**Stratégie de livraison :**

1. **V1 exploitable rapidement** (tranche T6a-v1) : rendu **vertical hiérarchique**
   (arbre parent→enfants, colonnes par niveau ou liste groupée par milestone),
   blocs avec état + progression, popup contextuel simple. **Pas de drag yet.**
2. **V2 vision finale** (tranche T6a-v2, plus tard) : layout libre gauche→droite,
   drag des blocs + drag du fond, zoom/pan, positions persistées.

**Exigence de non-complication pour la V2 :** la V1 doit stocker/dériver les
blocs depuis les **relations canoniques** (`depends_on`, `parent`), pas depuis
des coordonnées codées en dur. Ainsi, passer au layout libre revient à ajouter
une couche de positionnement (backend : positions optionnelles ; renderer :
pan/drag) SANS changer le modèle de données ni les modules de lecture.

- Modèle de données source (inchangé) : `roadmap_nodes` (kind milestone/epic/task,
  parent, état, progression) + `roadmap_relations` (dépendances) + `roadmap_todos`.
- Extension V2 (optionnelle, additive) : table `roadmap_layout` (positions,
  colonnes) — n'affecte pas la V1.

## 6. Règles de non-régression (inchangées)

- Sélection cohérente entre vues ; reset au changement de scope.
- ResizeObserver compact (<900 px, configurable dans config.json).
- Erreurs génériques en anglais, jamais le message backend brut.
- `jsx(Tip)` enfant unique (jamais `jsxs(Tip, [...]`)) — piège Radix Slot.
- Zéro fixture ; zéro écriture hors `host.request`.
- Validations : identifiants max 128 sans caractères de contrôle, progress 0..100.
- Chaque tranche : revue indépendante avant clôture.
