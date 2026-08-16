# Roadmaps — Spécification autoritative Plan-first Workbench

Date : 2026-08-15
Statut : **spécification produit et technique autoritative pour la reprise de T5c**
Portée : Desktop core, SDK plugin, backend Roadmaps et plugin disk Roadmaps.

Ce document consolide les trois audits du 2026-08-15 et les corrections déjà
portées dans :

- `docs/roadmaps-product-vision-20260814.md` ;
- `docs/roadmaps-execution-plan-20260815.md`.

En cas de conflit avec les descriptions UI antérieures de
`docs/roadmaps-vision-t5c-ui.md` ou `docs/roadmaps-layout-t6a.md`, **le présent
document prévaut**. Les faits d'implémentation déjà établis restent décrits dans
`docs/roadmaps-vision-t5c.md` ; cette spécification ne transforme pas un travail
restant en résultat livré.

---

## 1. Décision produit non négociable

### 1.1 Invariant Plan-first / Vision

**Plan-first signifie que la planification est la première étape produit
incontournable, pas qu'un formulaire doit précéder la conversation.**

- **Plan** est l'objectif initial et l'artifact gouverné.
- **Vision** est la conversation Hermes native, intégrée à Roadmaps et liée au
  scope de la roadmap, qui construit et révise ce plan.
- L'aperçu de plan est la projection structurée et vivante de la conversation ;
  il ne constitue jamais une deuxième source d'autorité.
- Une roadmap vide arrive directement dans l'onboarding Plan / Vision.
- Aucun workspace ni aucune mutation d'exécution n'est disponible avant qu'une
  version proposée ait été explicitement validée puis activée.
- Valider et démarrer sont deux événements de gouvernance séparés :
  `plans.validate` n'active rien ; `plans.activate` démarre l'exécution.
- Une révision d'une roadmap active ne modifie jamais la version active en place.
  La version active `vN` reste autoritative jusqu'à la proposition, la
  validation et l'activation explicites de `vN+1`.

L'autorité canonique demeure backend dans `projects.db` : roadmap, versions,
nœuds, relations, todos, décisions représentées dans le plan, liens d'evidence
et association à la session Vision. Le plugin est un renderer : lectures et
écritures passent uniquement par RPC ; aucun SQL, aucune mutation directe de
`projects.db`, aucun état renderer présenté comme proposé, validé ou actif.

### 1.2 Statut de l'ancien flux T5c UI

Le flux déjà codé dans `desktop-plugins/roadmaps/src/views/plan.js` qui crée une
session puis appelle `host.openSession(...)` est :

> **T5c-UI external-open — SUPERSEDED**

Il est techniquement exploré, mais **n'est pas livré comme expérience produit
acceptée**. Il fait quitter Roadmaps et ne satisfait pas l'invariant Vision
intégrée. `host.openSession` reste permis uniquement comme navigation secondaire
vers une session liée ; il ne doit plus être invoqué par l'action primaire de
création ou reprise de Vision.

L'ancien document `docs/roadmaps-vision-t5c-ui.md` et l'ancien layout
`docs/roadmaps-layout-t6a.md` sont donc historiques pour leurs propositions UI ;
ils ne sont pas les spécifications d'implémentation du Workbench.

---

## 2. Modèle d'états produit autoritatif

L'état affiché est dérivé du snapshot backend et du scope explicite, jamais d'un
onglet local ou d'une supposition. Le profil est toujours affiché en lecture
seule et aucun profil, projet ou roadmap de repli n'est inféré.

| État produit | Condition autoritative | Route canonique | Indicateur visible | Action primaire |
|---|---|---|---|---|
| `NO_PROJECT` | profil valide, aucun projet sélectionné | `/roadmaps` | `Choose a project to begin` | `Create project` |
| `NO_ROADMAP` | projet sélectionné, aucune roadmap sélectionnée | `/roadmaps?project=:projectId` | `Create your first roadmap` | `New roadmap` |
| `DRAFT_NO_PLAN` | roadmap sélectionnée, aucune version proposée/validée exploitable et aucune version active | `/roadmaps/:roadmapId/setup/vision` | `Planning required` | `Start planning`, puis `Propose plan` |
| `PROPOSED` | candidat initial dans l'état backend `proposed`, sans version active | `/roadmaps/:roadmapId/setup/review` | `Awaiting validation` | `Validate plan` |
| `VALIDATED_NON_ACTIVE` | candidat initial `validated`, `active_version IS NULL` | `/roadmaps/:roadmapId/setup/launch` | `Validated · Not started` | `Start roadmap` |
| `ACTIVE` | `active_version` non nul et version active autoritative | `/roadmaps/:roadmapId/overview` | `Active · vN` | `Continue work` |

La version vide créée avec une nouvelle roadmap est un marqueur durable initial ;
elle ne doit pas faire sortir l'UI de `DRAFT_NO_PLAN` tant qu'elle ne représente
pas un plan structuré proposable.

Une roadmap `ACTIVE` peut avoir en parallèle une révision `proposed` ou
`validated`. Son état produit reste `ACTIVE` : Execute continue sur `vN`, tandis
que Plan expose le sous-parcours de revue de `vN+1`. La présence d'une révision
ne doit ni masquer ni modifier l'exécution active.

### 2.1 Transitions et actions

| Depuis | Action utilisateur | Mutation / effet attendu | Vers |
|---|---|---|---|
| `NO_PROJECT` | `Create project` | création backend, sélection du nouveau projet | `NO_ROADMAP` |
| `NO_PROJECT` | choisir un projet | chargement scope explicite | `NO_ROADMAP` ou état de sa roadmap choisie |
| `NO_ROADMAP` | `New roadmap` | `roadmaps.create`, sélection et navigation atomique vers setup | `DRAFT_NO_PLAN` |
| `NO_ROADMAP` | choisir une roadmap | snapshot autoritatif et route dérivée | état dérivé |
| `DRAFT_NO_PLAN` | `Start planning` | créer ou reprendre la session Vision liée sans navigation hors plugin | `DRAFT_NO_PLAN` |
| `DRAFT_NO_PLAN` | `Propose plan` | persister une version immuable via `plans.create`, puis refetch | `PROPOSED` |
| `PROPOSED` | `Continue in Vision` | réouvrir/reprendre Vision dans le Workbench | `DRAFT_NO_PLAN` de révision, sans effacer silencieusement le candidat |
| `PROPOSED` | `Discard proposal` | mutation backend explicite ; aucun effacement renderer-only | `DRAFT_NO_PLAN` |
| `PROPOSED` | `Validate plan` | `plans.validate`, acteur explicite enregistré, puis refetch | `VALIDATED_NON_ACTIVE` |
| `VALIDATED_NON_ACTIVE` | `Create revision` | nouvelle révision via Vision ; version validée conservée | parcours Plan |
| `VALIDATED_NON_ACTIVE` | `Start roadmap` | `plans.activate` sur la version validée, puis snapshot autoritatif | `ACTIVE` |
| `ACTIVE` | `Create revision` | Vision reçoit `vN` comme base ; aucune mutation in-place | `ACTIVE` + candidat Plan |
| `ACTIVE` | mutations valides de nœud/todo | mutation versionnée puis refresh | `ACTIVE` |
| `ACTIVE` | activer `vN+1` validée | ancienne active `superseded`, nouvelle active | `ACTIVE` |

Règles de gate :

1. une seule action primaire adaptée à l'état est visuellement dominante ;
2. l'action reste visible au-dessus de la ligne de flottaison et sticky lors du
   scroll pour `DRAFT_NO_PLAN`, `PROPOSED` et `VALIDATED_NON_ACTIVE` ;
3. `Map`, `Work`, claim, progress, complete, block/unblock et actions Kanban
   d'exécution sont masqués ou désactivés avec explication jusqu'à activation ;
4. il n'existe aucun raccourci `Activate` depuis `PROPOSED` ;
5. les libellés `Save plan`, `Validate plan` et `Start roadmap` ne sont jamais
   interchangeables. La copie primaire doit employer `Propose plan`,
   `Validate plan`, puis `Start roadmap`.

---

## 3. Routes et règles de navigation

### 3.1 Routes canoniques

```text
/roadmaps
/roadmaps?project=:projectId
/roadmaps/:roadmapId/setup/vision
/roadmaps/:roadmapId/setup/review
/roadmaps/:roadmapId/setup/launch
/roadmaps/:roadmapId/overview
/roadmaps/:roadmapId/map
/roadmaps/:roadmapId/work
/roadmaps/:roadmapId/plans
/roadmaps/:roadmapId/evidence
```

Les trois routes `setup/*` sont des gates du mode **Plan**. Dans `ACTIVE` :

- `/overview` ouvre **Execute → Focus** et répond à « où en sommes-nous ? »,
  « que faire maintenant ? » et « qu'est-ce qui bloque ? » ;
- `/map` ouvre la représentation Map dans le mode courant ;
- `/work` approfondit les todos et la projection Kanban ;
- `/plans` ouvre **Plan** avec Outline / Map / Versions et le flux de révision ;
- `/evidence` expose les preuves, rapports, fichiers et événements réellement
  supportés par le backend, pas un placeholder vide.

Ces routes ne recréent pas cinq ou six tabs égaux. Elles sont des destinations
profondes organisées sous les deux modes Plan / Execute et leurs contrôles
contextuels.

### 3.2 Navigation déterministe

- Après `roadmaps.create`, la navigation va immédiatement vers
  `/roadmaps/:roadmapId/setup/vision` dans le même flux utilisateur.
- Un reload ou une resélection recalcule la route depuis le snapshot backend.
- Plan s'ouvre par défaut pour une roadmap draft/proposed/validated non active.
- Execute s'ouvre par défaut seulement si une version active existe, ou si la
  dernière destination explicitement choisie reste valide.
- Un changement de profil, projet ou roadmap conserve le shell, annule les
  abonnements Vision du scope précédent, libère la surface, efface sélection et
  détail transitoires invalides, puis charge le nouveau scope.
- Aucun événement de streaming en arrière-plan ne change la route, n'ouvre un
  pane ou ne vole le focus.

---

## 4. Composition du Roadmap Workbench

### 4.1 Shell persistant

Le header compact contient, dans cet ordre :

1. breadcrumb `Profile / Project / Roadmap` ;
2. titre et purpose de la roadmap ;
3. un unique indicateur sémantique de lifecycle ;
4. un menu calme `More actions` pour create, rename, archive et copies d'ID.

Le profil est read-only. Les copies utilisent `CopyButton` icon-only. Les
informations d'implémentation (`expected_version`, RPC, parser, `projects.db`,
acteur brut) n'apparaissent pas dans le chemin normal.

### 4.2 Deux modes primaires seulement

- **Plan** — toujours disponible ; destination par défaut avant activation.
  Contient Vision et l'artifact en construction. Les représentations
  secondaires sont `Outline`, `Map` et `Versions` via `SegmentedControl` ;
  Versions est un historique contextuel, pas un tab primaire.
- **Execute** — suite naturelle après activation. Ouvre sur `Focus` : une forte
  `Next action`, le travail `In flight`, les blockers et la critical path
  pertinente. `Map` est la représentation secondaire. Avant activation, le
  mode est désactivé avec `Validate and start a plan to unlock execution`.

Le Copilot est une couche contextuelle de la conversation unique : il clarifie
et signale les lacunes dans Plan ; il explique la prochaine action, les risques
et la trajectoire dans Execute. Il ne crée jamais un second transcript ou un
second composer.

### 4.3 Stage rail

Le rail de parcours est :

```text
Define → Shape → Validate → Run → Review
```

Il sert simultanément de guide, de navigation lorsque l'étape est accessible et
de résumé d'avancement. Il ne duplique pas les états machine en badges.

| Stage | Sens produit | États principaux | Destination / action |
|---|---|---|---|
| `Define` | établir outcome, contraintes, critères de succès, inconnues | `DRAFT_NO_PLAN` | Vision, `Start planning` |
| `Shape` | structurer objectifs, phases, milestones, steps, relations et todos | `DRAFT_NO_PLAN` | Outline / Map, `Propose plan` |
| `Validate` | contrôler qualité, questions, diff et gouvernance | `PROPOSED`, `VALIDATED_NON_ACTIVE` | `Validate plan`, puis `Start roadmap` |
| `Run` | exécuter la version active | `ACTIVE` | Execute → Focus / Map |
| `Review` | examiner evidence, résultats, écarts et prochaine révision | `ACTIVE` | Evidence, Versions, `Create revision` |

Une étape inaccessible expose sa condition d'accès en texte ; elle n'est ni un
lien mort ni une erreur vide.

### 4.4 Détail contextuel

La sélection d'un nœud ouvre un détail contextuel unique : description,
progression, dépendances, todos, owner, session liée, commentaires lorsqu'ils
existent, evidence et seulement les actions valides pour son état. L'ancien
Inspector permanent est supprimé ; ses informations utiles sont conservées dans
ce modèle de détail.

Milestones devient un groupement et un roll-up navigable dans Outline, Map et
Focus. Decisions apparaît dans le plan et sa revue. Files n'est exposé que comme
evidence réellement attachée ; aucun onglet placeholder n'est conservé.

---

## 5. Suppressions explicites

Les éléments suivants doivent être supprimés, pas simplement cachés derrière un
feature flag :

1. les six tabs primaires égaux `Thread`, `Map`, `Plan`, `Milestones`,
   `Decisions`, `Files` issus de `desktop-plugins/roadmaps/src/config.json` et
   dispatchés par `desktop-plugins/roadmaps/src/index.js` ;
2. l'ancienne grille wide `Thread | active tab | Inspector` ;
3. ses dérivés mid à deux colonnes et compact empilé définis dans
   `docs/roadmaps-layout-t6a.md` et codés dans
   `desktop-plugins/roadmaps/src/index.js` ;
4. la colonne Thread permanente ; son contenu actionnable devient Execute →
   Focus ;
5. la navigation Milestones autonome ;
6. les tabs placeholder Decisions et Files ;
7. l'Inspector permanent, les contrôles `Actor` et `expected_version` dans le
   chemin principal ;
8. les badges redondants de lifecycle/version/kind/state/progress ;
9. les boxed cards Vision, chips Copilot, groupes arrondis imbriqués, bordures
   et séparateurs gratuits ;
10. toute implémentation de transcript/composer propre au plugin.

`Thread`, `view` et `Inspector` ne doivent plus servir de vocabulaire de
navigation primaire visible.

---

## 6. Contrat public `SessionSurface`

### 6.1 API SDK

Le Desktop core doit extraire du chemin des session tiles un composant générique
et l'exporter depuis `@hermes/plugin-sdk` :

```ts
export interface SessionSurfaceIdentity {
  profile: string
  storedSessionId: string
  runtimeSessionId?: string
}

export interface SessionSurfaceProps {
  session: SessionSurfaceIdentity
}

export function SessionSurface(props: SessionSurfaceProps): JSX.Element
```

Sémantique des identités :

- `profile + storedSessionId` est l'ancre durable de reprise ; le profil fait
  partie de l'identité et n'est jamais implicite ;
- `runtimeSessionId` est un hint éphémère d'adoption immédiate de la session
  renvoyée par `session.create` ; il peut être invalide après reconnect/restart ;
- `runtimeSessionId` ne doit jamais être persisté par Roadmaps ;
- après compression, la résolution durable suit la lineage root et les aliases
  core au lieu de figer un tip devenu obsolète.

### 6.2 Composition core obligatoire

`SessionSurface` réutilise exactement la pile native :

```text
SessionSurface
└─ SessionViewProvider
   └─ ComposerScopeProvider
      └─ ChatView
         ├─ Thread / markdown / tools / streaming
         ├─ ChatBar / attachments
         └─ PromptOverlays: approval / clarify / sudo / secret
```

Il reprend les actions submit, slash, steer, edit, reload, restore, interrupt,
attachments, modèle, reprise/hydratation et retry. Exporter `ChatView` seul est
interdit : sans ses providers, ses actions, son cache et son delegate, il
retomberait sur la session primaire et détournerait l'état global.

Le tile existant doit consommer le même `SessionSurface`. Il ne doit subsister
qu'une seule implémentation du transcript et du composer.

### 6.3 Isolation et routage

Le montage, le streaming et les actions d'une surface embarquée ne modifient
jamais :

- `$activeSessionId` ;
- `$selectedStoredSessionId` ;
- `$activeGatewayProfile` ;
- la route ;
- le layout ou `$sessionTiles`.

Le routage gateway est profile-bound :

- local multi-profile : socket secondaire du profil, sans `setActive` ;
- SSH/cloud : gateway primaire, avec `profile` explicitement transmis à chaque
  RPC ;
- profil courant : fast path permis, identité toujours vérifiée.

`useGatewayRequest` vers le gateway actif et `ensureGatewayProfile` ne sont pas
des solutions acceptables pour la surface embarquée : le premier peut viser le
mauvais backend, le second détourne le foreground.

Chaque binding et chaque événement est qualifié et vérifié par profil + identité
durable + runtime. Une collision d'ID inter-profils ne doit jamais alimenter une
autre surface. `session.resume`, `prompt.submit`, `session.redirect` et
`session.interrupt` doivent tous viser le même backend/profile.

### 6.4 Lifecycle de surface

- Avec un `runtimeSessionId` issu de `session.create`, la surface adopte
  immédiatement ce runtime sans `session.resume`; le premier prompt peut partir
  avant que la ligne session durable existe.
- Sans runtime utilisable, elle reprend une seule fois depuis l'identité durable
  profile-scoped, hydrate le transcript et adopte le nouveau runtime.
- La surface montée retient le runtime dans `runtimeReferenced` par retain/release
  ref-counté sans créer de tile ni persister du layout.
- Un unmount libère la référence UI mais n'interrompt pas la session backend et
  ne supprime pas un état busy.
- Un remount reprend depuis l'identité durable.
- Loading, session absente, erreur de reprise et reconnexion sont honnêtes ; les
  retries sont bornés et proposent `Retry`.
- Le composant reste monté lorsque sa lane est temporairement masquée par le
  responsive afin de préserver draft, prompts bloquants et abonnements.

### 6.5 Flux Roadmaps

```text
Roadmaps route contribution
→ session.create(seed rules + roadmap context)
→ {stored_session_id, session_id}
→ keep {profile, storedSessionId, runtimeSessionId} in mounted Workbench state
→ render <SessionSurface session={visionSession} />
→ observe the same runtime only for structured plan preview
→ persist only the durable lineage association
```

L'action Create/Start Vision n'appelle pas `host.openSession`. L'aperçu peut
extraire le dernier bloc JSON complet pour présentation, mais l'acceptation et
la persistance restent backend-authoritatives.

---

## 7. Contrat durable `roadmap_sessions`

`roadmap_sessions` est une migration additive requise par **T5c-data**. Elle
n'existe pas encore dans le schéma lu dans `hermes_cli/projects_db.py` ; ce
paragraphe définit la cible, il ne prétend pas qu'elle est livrée.

### 7.1 Autorité et identité

L'association minimale canonique est :

```text
(profile_id, project_id, roadmap_id, role) → lineage_root_session_id
```

Pour T5c, `role = 'vision'`. `lineage_root_session_id` est l'identité durable
persistée. Le runtime courant et le tip stored courant sont résolus par le core
et ne sont jamais enregistrés comme autorité Roadmaps.

Schéma cible normatif :

```sql
CREATE TABLE IF NOT EXISTS roadmap_sessions (
    profile_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    roadmap_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('vision', 'node')),
    node_id TEXT,
    lineage_root_session_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, project_id, roadmap_id, role, node_id),
    FOREIGN KEY (profile_id, project_id, roadmap_id)
      REFERENCES roadmaps(profile_id, project_id, roadmap_id)
      ON DELETE CASCADE
);
```

Comme SQLite traite plusieurs `NULL` comme distincts dans une contrainte
unique, l'implémentation doit ajouter un index unique partiel garantissant une
seule association Vision par roadmap :

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_sessions_vision
ON roadmap_sessions(profile_id, project_id, roadmap_id, role)
WHERE role = 'vision' AND node_id IS NULL;
```

Contraintes applicatives obligatoires :

- `vision` impose `node_id IS NULL` ;
- `node` impose un `node_id` appartenant au scope/version approprié lorsque le
  support des sessions de nœud est introduit ; T5c peut rejeter `role='node'`
  tant que ce support n'est pas implémenté ;
- chaîne non vide pour chaque identifiant et `created_by` ;
- upsert/rebind atomique et versionné côté writer ;
- aucune colonne `runtime_session_id` ;
- aucune association éphémère renderer-only présentée comme durable.

### 7.2 Contrat read/write

Le backend expose, via les couches writer/service puis RPC :

- attacher ou remplacer explicitement la lineage Vision du scope ;
- lire l'association Vision d'une roadmap ;
- retourner au renderer l'identité durable et, si elle est résolue par le core,
  le `stored_session_id` courant utilisable pour `SessionSurface` ;
- refuser scope inconnu, spoofing profile, session vide et version périmée selon
  les conventions Roadmaps (`5063`, `5064`, `5065`, `5067`, `5061`) ;
- effectuer un refetch autoritatif après mutation.

Le plugin ne suit pas lui-même les rotations de tip liées à la compression. Au
reload, il demande l'association durable au backend/core, reçoit le stored id
résolu, puis laisse `SessionSurface` reprendre la session.

---

## 8. Responsive piloté par le conteneur

Le breakpoint est calculé sur la largeur réelle du conteneur Roadmaps via
`ResizeObserver`, pas sur `window.innerWidth` ou seulement
`host.state.viewport`. Les seuils autoritatifs sont :

- wide : `>= 1280px` ;
- mid : `900–1279px` ;
- compact : `< 900px`.

L'identité React de `SessionSurface` reste stable lors d'un changement de mode.
Les lanes masquées restent montées ; scope, sélection, draft et scroll valides
sont préservés.

### 8.1 Wireframe wide — UI copy in English

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ Profile: default / Project / Roadmap     Roadmap title     Planning required   More actions │
├──────────────┬──────────────────────────────────────────────┬────────────────────────────────┤
│ DEFINE       │ PLAN · Outline | Map | Versions             │ VISION                         │
│ SHAPE        │                                              │ Connected · autosaved          │
│ VALIDATE     │ Outcome                                      │                                │
│ RUN          │ Objectives                                   │ [Native Hermes transcript]     │
│ REVIEW       │ Phases and milestones                        │ [Streaming and tool states]    │
│              │ Steps and todos                              │ [Approval / clarify prompts]   │
│              │ Decisions                                    │                                │
│              │ Dependencies and blockers                    │                                │
│              │ Success criteria                             │ [Message Vision…]       [Send]│
├──────────────┴──────────────────────────────────────────────┴────────────────────────────────┤
│ 3 issues must be resolved before proposal.       [Continue in Vision] [Propose plan]       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Le rail est étroit, le workspace central est dominant, la lane Vision/détail est
redimensionnable et repliable. Il ne s'agit pas de trois colonnes égales. En
Execute, le centre devient `Focus | Map` et la lane droite conserve la
conversation contextuelle ou affiche temporairement le détail sélectionné.

### 8.2 Wireframe mid — UI copy in English

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Profile / Project / Roadmap       Awaiting validation       More actions │
├───────────┬───────────────────────────────────┬────────────────────────────┤
│ VALIDATE  │ PLAN · Outline | Map | Versions  │ Conversation | Details     │
│           │                                   │                            │
│           │ Proposed plan vN                  │ [Contextual side pane]     │
│           │ Checks, warnings and diff         │                            │
│           │                                   │                            │
├───────────┴───────────────────────────────────┴────────────────────────────┤
│ [Continue in Vision]                                      [Validate plan]│
└────────────────────────────────────────────────────────────────────────────┘
```

Le rail devient indicateur vertical compact ou dropdown labellé. Le workspace
reste dominant. `Conversation` et `Details` sont mutuellement exclusifs dans la
lane contextuelle ; Thread n'est jamais permanent. La lane occupe au maximum
38 % de la largeur et n'entraîne aucun scroll horizontal de page.

### 8.3 Wireframe compact — UI copy in English

```text
┌──────────────────────────────────────┐
│ Project                         More │
│ Roadmap                 Planning required │
├──────────────────────────────────────┤
│ Define  Shape  Validate  Run  Review│
├──────────────────────────────────────┤
│ Plan                         Execute│
│ Outline | Map | Versions            │
│                                      │
│ [One full-width plan workspace]      │
│                                      │
├──────────────────────────────────────┤
│ [Chat] [Details]    3 issues remaining│
│                         [Propose plan]│
└──────────────────────────────────────┘

Chat sheet:
┌──────────────────────────────────────┐
│ Vision                         Close │
│ [Native Hermes transcript]           │
│ [Message Vision…]             [Send]│
└──────────────────────────────────────┘
```

Le breadcrumb tient sur deux lignes, le stage rail devient stepper horizontal et
le workspace est pleine largeur. Chat et Details s'ouvrent en bottom sheet à
état persistant ou panneau pleine hauteur avec un seul switch. Le composer et
l'action lifecycle restent au-dessus du clavier écran. Le contenu masqué signale
live/unread et reste monté.

---

## 9. Style, accessibilité et résilience

### 9.1 Style natif

- Appliquer `apps/desktop/DESIGN.md` littéralement : flat over boxed, tokens
  plutôt que literals, whitespace et au plus un hairline
  `--ui-stroke-tertiary` entre régions majeures.
- Utiliser le gutter natif Hermes, `Button`, `SegmentedControl`, `SearchField`
  seulement lorsque nécessaire, `CopyButton`, `StatusDot`, `Loader`,
  `ErrorState`, `EmptyState` et `PanelEmpty`.
- Un seul `StatusDot` et un libellé lisible par état ; pas de pile badge + chip +
  dot + machine value.
- Progression sous forme de piste fine tokenisée ; pourcentage tabulaire
  seulement lorsque sa précision est utile.
- Codicons cohérents dans les contrôles denses ; aucun icon décoratif.
- Mouvement fonctionnel proche de 100 ms ; pas de `transition-all`, animation
  ornementale, ouverture automatique de pane ou vol de focus.
- Toute copie produit visible, y compris empty/error/loading states et
  wireframes, est concise et **en anglais**.

### 9.2 Accessibilité

- Chaque action lifecycle possède un label texte ; les contrôles icon-only ont
  un `aria-label` précis.
- L'ordre de focus suit le flux visuel : scope, stage, workspace, conversation,
  action primaire.
- Focus visible, ownership clavier par surface, Escape ferme une seule couche à
  la fois.
- Le streaming est annoncé via une live region polie et ne replace pas le focus
  à chaque delta.
- Les étapes et actions désactivées exposent la raison et la condition de
  déverrouillage.
- Segmented controls, rail et sheets sont utilisables au clavier et annoncent
  sélection, état courant et unread.
- Les tailles compactes conservent le composer et l'action primaire visibles
  avec clavier virtuel et zoom texte.

### 9.3 Résilience

- Loading utilise `Loader`, erreurs `ErrorState`, vides guidés
  `EmptyState`/`PanelEmpty` ; aucun message backend brut.
- Stale `expected_version` propose `Reload` et ne réessaie pas aveuglément.
- Échec réseau ou resume propose un `Retry` borné.
- Reconnexion, remount ou double clic ne dupliquent ni prompt Vision, ni
  proposition de plan, ni association durable.
- Les résultats asynchrones tardifs sont rejetés par scope/génération et ne
  peuvent pas écraser une sélection plus récente.
- Changer de scope dispose les listeners précédents et empêche toute fuite de
  transcript ou preview.
- Une ContribBoundary peut contenir un crash renderer, mais un unload/hot reload
  du plugin ne doit pas interrompre le turn backend ; retain/release est
  ref-counté.

---

## 10. Gates UX mesurables

La tranche ne sort pas sur la seule base d'un build vert. Les gates suivants
sont obligatoires et leurs résultats doivent être consignés ; cette
spécification ne prétend pas qu'ils ont déjà été exécutés.

1. **Discoverability** — après création d'une roadmap, 9 utilisateurs sur 10
   identifient `Build the plan` comme prochaine étape en moins de 5 secondes,
   sans choisir un tab.
2. **Vision intégrée** — wide, mid et compact permettent de lire l'historique,
   envoyer, voir le streaming, répondre à un prompt bloquant, récupérer un turn
   échoué et observer l'aperçu changer sans quitter Roadmaps.
3. **Gate incontournable** — dans `DRAFT_NO_PLAN`, `PROPOSED` et
   `VALIDATED_NON_ACTIVE`, l'unique action primaire est au-dessus de la ligne de
   flottaison et sticky ; zéro mutation d'exécution est invocable.
4. **Clarté lifecycle** — un participant distingue roadmap vide, draft,
   proposed, validated et active depuis le seul indicateur et l'action primaire.
5. **Gouvernance** — `Validate plan` enregistre acteur/version sans activation ;
   `Start roadmap` n'active qu'une version validée et refetch avant Execute.
6. **Autorité canonique** — reload reconstruit état, versions, nœuds, relations,
   todos, active version et association Vision depuis RPC ; aucune SQL ou vérité
   locale plugin.
7. **Scope safety** — changement de profile/project/roadmap produit zéro contenu
   inter-scope et ne change pas silencieusement le profil foreground.
8. **Qualité de proposition** — `Propose plan` reste indisponible tant que le
   backend n'accepte pas : outcome, critères de succès mesurables, au moins une
   step actionnable, parents/références valides, aucun cycle de dépendance,
   blockers non résolus explicites et todos attachés validement.
9. **Sécurité des révisions** — `vN` active demeure inchangée et exécutable
   pendant la construction/revue de `vN+1` ; historique et diff restent lisibles.
10. **Responsive** — à `>=1280px`, artifact et Vision sont simultanément
    visibles ; à `900–1279px`, ils restent accessibles sans scroll horizontal ;
    à `<900px`, chacun est accessible en un tap, avec état, draft et scroll
    conservés et actions au-dessus du clavier.
11. **Compréhension navigation** — en état actif, 8 utilisateurs sur 10 trouvent
    au premier essai next work, dependency map, plan history et evidence.
12. **A11y/résilience** — parcours clavier complet, annonces streaming non
    intrusives, erreurs stale/network récupérables, aucune duplication après
    reconnect.
13. **Isolation SessionSurface** — les tests prouvent que route,
    `$activeSessionId`, `$selectedStoredSessionId`, `$activeGatewayProfile` et
    autre surface restent inchangés pendant resume, submit, steer, edit, reload,
    interrupt et attachments.

---

## 11. Ordre d'implémentation obligatoire

L'ordre est strict :

```text
T5c-core → T5c-data → T5c-workbench → validation MBP → T6a
```

T6a reste suspendu tant que la validation réelle MBP du Workbench intégré n'est
pas passée.

### 11.1 T5c-core — surface de session générique

Objectif : extraire l'infrastructure session tile en API core générique, sans
implémenter encore le nouveau Workbench.

Chemins exacts :

- créer `apps/desktop/src/app/chat/session-surface.tsx` ;
- créer `apps/desktop/src/app/chat/session-surface.test.tsx` ;
- modifier `apps/desktop/src/app/chat/session-tile.tsx` pour consommer
  `SessionSurface` ;
- généraliser `apps/desktop/src/app/chat/session-tile-actions.ts`, idéalement en
  `apps/desktop/src/app/chat/session-surface-actions.ts` ;
- généraliser
  `apps/desktop/src/app/contrib/hooks/use-session-tile-delegate.ts` et son test,
  ou créer le successeur explicitement nommé session-surface ;
- modifier `apps/desktop/src/app/contrib/wiring.tsx` ;
- modifier `apps/desktop/src/store/session-states.ts` pour retain/release ;
- modifier `apps/desktop/src/store/gateway.ts` et
  `apps/desktop/src/store/gateway-switch.test.ts` pour le routage profile-bound ;
- exporter seulement le composant et ses types depuis
  `apps/desktop/src/sdk/index.ts` ;
- couvrir le shim dans `apps/desktop/src/sdk/runtime.ts` et le loader dans
  `apps/desktop/src/contrib/runtime-loader.test.ts` sans dupliquer React.

Gate de sortie : parité tile, isolation foreground, trois topologies gateway,
adoption runtime avant persistance, cold resume, compression/rebind, prompts
bloquants, retain/release et plugin disk SDK testés.

### 11.2 T5c-data — association durable et identité Vision

Objectif : rendre la session Vision durablement retrouvable par scope avant de
composer l'UI finale.

Chemins exacts :

- migration/schema dans `hermes_cli/projects_db.py` ;
- mutations atomiques dans `hermes_cli/roadmaps_writer.py` ;
- reads dans `hermes_cli/roadmaps_service.py` ;
- handlers RPC dans `tui_gateway/methods_roadmaps.py` et enregistrement long
  handler dans `tui_gateway/server.py` si la méthode ouvre `projects.db` ;
- tests dans les familles Roadmaps existantes sous `tests/hermes_cli/` et
  `tests/tui_gateway/` ;
- wrappers RPC uniquement dans `desktop-plugins/roadmaps/src/data.js` ;
- assertions d'identité et non-persistance runtime dans
  `desktop-plugins/roadmaps/.validate/data-layer.test.mjs`.

Cette tranche conserve les éléments T5c-backend déjà décrits dans
`hermes_cli/roadmaps_planning_rules.py`,
`hermes_cli/roadmaps_plan_parser.py` et `roadmaps.planning_rules`. Elle ne doit
pas prétendre que `parse_plan` est déjà câblé dans `plans.create` : le contrat
d'entrée RPC reste un payload structuré tant que le toolset/backend n'effectue
pas explicitement cet appel.

Gate de sortie : reload retrouve la lineage Vision du bon scope, résout un
stored id courant, n'a enregistré aucun runtime id et rejette spoofing,
collision et writes périmés.

### 11.3 T5c-workbench — composition Plan-first

Objectif : remplacer l'UI actuelle, pas l'empiler au-dessus.

Chemins exacts :

- refondre `desktop-plugins/roadmaps/src/index.js` autour du shell, de Plan /
  Execute et du stage rail ;
- refondre `desktop-plugins/roadmaps/src/views/plan.js` pour conserver
  `{profile, storedSessionId, runtimeSessionId}`, rendre `SessionSurface`,
  supprimer l'appel primaire `host.openSession` et séparer propose/validate/start ;
- adapter `desktop-plugins/roadmaps/src/state.js` au routage par état et au
  conteneur responsive ;
- adapter `desktop-plugins/roadmaps/src/scope.js` au breadcrumb compact ;
- remplacer la configuration six-tabs de
  `desktop-plugins/roadmaps/src/config.json` par modes, stages et breakpoints ;
- transformer les capacités utiles de
  `desktop-plugins/roadmaps/src/copilot.js`,
  `desktop-plugins/roadmaps/src/inspector.js`,
  `desktop-plugins/roadmaps/src/views/fil.js`,
  `desktop-plugins/roadmaps/src/views/map.js` et
  `desktop-plugins/roadmaps/src/views/milestones.js` en Focus, Map, roll-ups et
  détail contextuel ;
- retirer les destinations placeholder de
  `desktop-plugins/roadmaps/src/views/decisions.js` et
  `desktop-plugins/roadmaps/src/views/files.js` de la navigation primaire ;
- étendre `desktop-plugins/roadmaps/.validate/data-layer.test.mjs` et ajouter les
  tests de rendu nécessaires pour route stable, Vision + artifact simultanés,
  scope switch et responsive state preservation.

Gate de sortie : états/routes/actions de cette spécification, absence des six
tabs et de l'ancienne grille, chat natif unique, aucune navigation hors plugin,
copy visible anglaise et gates automatiques plugin/Desktop verts.

### 11.4 Validation MBP — gate produit réelle

Sur le MBP, avec plugin disk reconstruit et backend réel compatible :

- créer projet et roadmap ;
- constater l'arrivée directe dans setup Vision ;
- créer/reprendre Vision intégrée, envoyer, streamer et répondre aux prompts ;
- produire un plan de démonstration réel sans fixture ;
- vérifier preview, proposal, validation séparée, launch puis Execute ;
- reload entre les étapes pour vérifier l'association durable ;
- tester wide, mid, compact/colonne latérale, clavier et erreurs réseau/stale ;
- consigner les résultats réels, captures et écarts ; ne déclarer aucun résultat
  non observé.

### 11.5 T6a — seulement après le Workbench

T6a implémente ensuite Map V1 hiérarchique et détail contextuel dans la
composition autoritative Plan / Execute. Il ne réintroduit ni l'ancienne grille
3/2/1, ni Thread permanent, ni Inspector permanent, ni les six tabs.

---

## 12. Gates techniques attendues lors de l'implémentation

Ces commandes sont des exigences futures de tranche, pas des résultats annoncés
par ce document :

```text
apps/desktop: npm run typecheck
apps/desktop: npm run test:ui
apps/desktop: npm run build
desktop-plugins/roadmaps: node build.mjs
desktop-plugins/roadmaps: node --check plugin.js
desktop-plugins/roadmaps: ESLint du bundle
repo: suite canonique Roadmaps backend/RPC
repo: git diff --check -- docs
```

La validation finale doit également prouver :

- aucun import interne `@/…` depuis le plugin disk ;
- `SessionSurface` fourni par le singleton `@hermes/plugin-sdk` ;
- aucune deuxième copie de React/JSX ;
- aucun `runtimeSessionId` dans `projects.db` ou la persistance plugin ;
- aucun `host.openSession` dans le flux primaire Vision ;
- aucun résultat annoncé sans exécution observée.
