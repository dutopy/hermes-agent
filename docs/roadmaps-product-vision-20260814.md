# Roadmaps — Product Vision (Pierre, 2026-08-14)

Statut : brouillon de vision validé oralement — à raffiner avant implémentation.
Ce document EST la cible produit. Chaque tranche d'implémentation doit se référer à lui.

## 1. Le voyage, pas la liste

Roadmaps est l'outil pour **organiser son voyage avant le départ**, puis **contrôler
l'avancée et les trajectoires**. Tout le monde — Pierre et les agents — doit avoir
une vision claire et structurée, et obtenir rapidement :

- ce qui est **fait** ;
- ce qui est à faire **maintenant** ;
- ce qu'il faudra faire pour arriver de la **meilleure façon**.

## 2. Flux d'entrée (navigation de premier niveau)

1. **Profil** — choisi dans le scope (lecture seule, jamais de fallback).
2. **Projet** — choisi OU **créé directement depuis l'interface** :
   - bouton **+** (créer) ;
   - **⋮ (3 points verticaux)** → menu contextuel de gestion du projet
     (rename, archive, tags à terme…).
3. **Roadmap** — choisie OU créée, mêmes mécanismes (+ et ⋮) que pour le projet.
4. **Plan** — dans la roadmap : sélectionner un plan existant OU en **créer un** :

## 3. Création de plan = session chat « Vision »

- Bouton **Create** → ouvre une **session chat HD** (la même surface que les sessions
  habituelles, même UI), nommée **« Vision »**.
- Pierre discute uniquement avec l'agent : l'agent l'**aide et le guide** pour produire
  le plan le plus détaillé possible.
- L'agent dispose de **règles très précises** (contrainte qualité) pour garantir un
  plan **impeccable, solide, la meilleure voie** vers le résultat visé.
- **Le plan en construction est visualisé en parallèle** dans Roadmaps et peut être
  **modifié/refondu au fil de la discussion**.
- Une fois le plan terminé et **validé** : il est **parsé et décomposé** dans la
  section **Map**.

## 4. Map — arborescence multidirectionnelle

- **Logique de progression gauche → droite** : d'où je viens, où je suis, où je vais.
- **Réagencement manuel** : déplacement des blocs + **drag du fond** pour se déplacer
  dans l'arborescence.
- **Catégories de blocs** :
  - **Milestones** — gros sous-objectifs ;
  - **Epics** — étapes des sous-objectifs ;
  - **Tasks** — todos qui regroupent les tâches.
- **Chaque task est associée à une carte Kanban** et **reflète son état**.
- **Chaque bloc reflète son état ET son niveau de progression**.

## 5. Blocs et tâches — popup contextuel

Chaque bloc/tâche doit pouvoir afficher de façon intelligente un **popup
fond légèrement transparent** avec :

- les informations associées ;
- les **boutons d'action** ;
- les **commentaires** ;
- l'**ouverture d'une session dédiée** à ce sujet précis.

## 6. Copilot / Next action / In flight

- « Next action » et « In flight » doivent être **présentés différemment** (plus
  riches, plus actionnables).
- Un **panel contextuel légèrement transparent**, navigation fluide, compact si
  besoin, **clair et accessible**.

## 7. Besoins transverses

- Vue rapide des **todos attachées** à un plan/nœud (plan très détaillé et interactif).
- Agents et humain partagent la même vision structurée (backend canonique,
  toolset agents).
- UI native Hermes (thème, Codicons, densité, responsive mesuré).
- Toujours : zéro fixture, zéro écriture directe du plugin, erreurs génériques,
  scope explicite.

## 8. Implications backend (à valider par tranche)

- CRUD projets/roadmaps/plans exposés en RPC (create/list/update/archive).
- Plan = version + nœuds (milestone/epic/task) + relations + todos, parsé depuis
  la session Vision.
- Liaison task ↔ carte Kanban (réutiliser kanban ou aligner le modèle).
- Sessions « Vision » : lien session ↔ plan/roadmap.
- Tags projets (à terme).

## 9. Contrat de structure (validé Pierre 2026-08-14)

- **Modularité** : plugin découpé en `src/` modulaire + build esbuild →
  `plugin.js` unique ; chaque domaine cloisonné ; ajout de module = fichier +
  branchement dans index.js, rien d'autre.
- **Connectivité** : toute intégration native passe par `host.request` (couche
  `data.js`) ; config dans `src/config.json` ; logique métier versionnée backend.
- **Map par étapes** : V1 simple et exploitable rapidement (hiérarchique,
  relations canoniques), V2 vision finale (layout libre, drag, positions)
  branchable sans complication grâce au modèle de données basé sur les relations
  canoniques. Voir `docs/roadmaps-architecture-modulaire.md`.

## 10. Ambition finale : Roadmaps = surface principale de pilotage (Pierre 2026-08-15)

À terme, le plugin doit pouvoir **remplacer l'utilisation directe des sessions** :
Pierre met le plugin en plein écran, discute ET pilote ses projets depuis cette
interface unique.

### Capacités SDK déjà disponibles (audité dans apps/desktop/src/sdk/index.ts)

| Capacité | API SDK | Usage |
|---|---|---|
| Ouvrir une session existante (navigation core) | `host.openSession(id, {profile, intent})` | « aller voir » une session liée à un nœud |
| Démarrer un nouveau chat | `host.newChat(profile)` | nouveau draft ciblé |
| Écouter le flux gateway en direct | `host.onEvent(type, listener)` → disposer | deltas de messages, cycle de vie, activité outils |
| Piloter le gateway (JSON-RPC complet) | `host.request(method, params)` | `session.*`, `prompt`-like, `projects.*`, `roadmaps.*` |
| Navigation | `host.navigate(path)` | routes core |
| UI native | `Dialog`, `Popover`, `ContextMenu`, `DropdownMenu`, `Tabs`, `Input`, `Textarea`, `Switch`, `ConfirmDialog`, `useGrabScroll` (pan/scrub pour la Map V2) | toute la gestion projets/roadmaps/plans |
| Contribution de panneaux | `PANES_AREA` | ancrer une vue Roadmaps dans le shell |

### Décision d'architecture corrigée (retour produit Pierre 2026-08-15)

La session Vision doit être **visible et utilisable dans la fenêtre Roadmaps**.
Ouvrir une session core séparée (`host.openSession`) fait quitter le parcours et
ne satisfait pas ce contrat. Cette voie est donc abandonnée comme expérience
finale ; elle reste seulement un mécanisme de navigation secondaire vers une
session liée.

Le plugin ne doit pas pour autant réimplémenter transcript, composer, outils,
approbations ou streaming. La cible est une **surface de session native
réutilisable**, extraite du chat Desktop core et exposée par un seam SDK
générique. Roadmaps l'embarque dans son workbench en la liant explicitement à
la session Vision du scope `profile_id + project_id + roadmap_id`.

Invariant du parcours : **Plan est le premier objectif ; Vision est l'atelier
conversationnel intégré qui construit ce plan.** Tant qu'aucun plan n'est
validé et activé, Roadmaps reste en mode `Plan setup` et ne présente pas le
workspace d'exécution (Map, Thread, milestones, steering) comme destination
principale.
