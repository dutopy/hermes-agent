# T5c-UI — Session « Vision » dans le plugin (spécification)

Dépend de T5c-backend (règles versionnées + parser + RPC `roadmaps.planning_rules`).

## Objectif (vision Pierre)

Dans une roadmap, Pierre doit pouvoir **définir un plan** : sélectionner un plan
existant OU en créer un via le bouton **Create** qui ouvre une **session chat HD**
(la même surface que les sessions habituelles), nommée **« Vision »**. Il discute
avec l'agent qui le guide (règles très précises, plan impeccable, meilleure voie).
Le plan en construction est **visualisé en parallèle** dans Roadmaps et peut être
modifié/refondu au fil de la discussion. Une fois validé, il est parsé et
décomposé dans la Map.

## Flux utilisateur cible

1. Scope complet choisi (profil → projet → roadmap).
2. Onglet **Plan** → bouton **Create** (nouveau) à côté de l'historique des
   versions.
3. Clic → **`roadmaps.planning_rules`** (RPC read-only) → `host.newChat(profile)`
   avec un premier message = règles de planification + contexte de la roadmap.
   La session s'ouvre dans l'UI chat HD (voie A validée : ouverture native).
4. Pierre et l'agent élaborent le plan. Le plugin écoute `host.onEvent`
   (message deltas / session lifecycle) pour **afficher en parallèle** un aperçu
   du plan en construction (extraction du dernier bloc JSON du flux).
5. Quand Pierre valide (« validate the plan »), l'agent (ou le plugin via un
   RPC) appelle `plans.create` avec le payload JSON parsé
   (tous les validateurs backend s'appliquent) → version `proposed`.
6. Le plugin refetch → la version apparaît dans l'onglet Plan ; Pierre peut
   `plans.activate` (une fois `validated`) — la Map se remplit.

## Décisions d'architecture

- **Voie A (maintenant)** : ouverture native de session (`host.newChat`) + écoute
  `host.onEvent` pour l'aperçu. Le transcript/composer ne sont PAS réimplémentés
  dans le plugin (règle « ne pas réimplémenter l'expérience de chat »).
- **Le parsing** : le plugin extrait le dernier bloc ```json ... ``` du flux pour
  l'aperçu local ; le **parsing autoritatif** reste backend (`roadmaps_plan_parser`),
  appelé via `plans.create` — le plugin ne valide jamais le plan lui-même.
- **Le lien roadmap ↔ session Vision** : T5c-backend décide si une table
  `roadmap_sessions` est ajoutée (additive). Si oui, le plugin enregistre
  session_id à la création ; sinon, la session reste éphémère et le lien est
  logique (le contexte initial contient le scope).

## Composants plugin (à implémenter dans T5c-UI)

- `src/data.js` : wrapper `getPlanningRules()` (RPC read-only, scope global) ;
  wrapper `createPlan(payload)` → `plans.create` ; (si table sessions :
  `attachVisionSession(...)`).
- `src/plan/` ou dans `views/plan.js` : bouton **Create** dans l'onglet Plan ;
  état « rules loading » → erreur générique si RPC indisponible.
- `src/vision/` : `useVisionPreview()` — écoute `host.onEvent` quand la session
  Vision est active, extrait le dernier bloc JSON, produit un aperçu compact
  (titre + nœuds + relations + todos count) affiché dans l'onglet Plan.
- Garder : labels EN ANGLAIS, erreurs génériques (jamais le message backend
  brut), zéro fixture, `data.js` seul module RPC, piège Radix Slot, sélection
  cohérente.

## Gates

- Suite canonique verte (204+ tests) ; harnais data.js étendu (wrappers
  planning_rules/createPlan + parsing aperçu) ; node --check + ESLint ;
  validation visuelle MBP (ouverture session Vision réelle, aperçu en
  parallèle, validation → version proposée visible).
