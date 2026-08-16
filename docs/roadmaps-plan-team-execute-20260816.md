# Roadmaps — Plan → Team → Execute

Date : 2026-08-16
Statut : **spécification produit et technique autoritative**
Portée : backend Roadmaps (`hermes_cli/projects_db.py`, `hermes_cli/roadmaps_*`), lien
Kanban (`hermes_cli/kanban_db.py`), plugin disk Roadmaps (`desktop-plugins/roadmaps/`),
Desktop core (`SessionSurface` via `@hermes/plugin-sdk`).

Succède à `docs/roadmaps-plan-first-workbench-20260815.md` pour le modèle de données et
le pipeline. Le **contrat `SessionSurface` (§6 de ce dernier) reste inchangé et en vigueur**.

---

## 1. Décisions produit non négociables

1. Le scope utilisateur est **`Profile / Project`**. Le sélecteur Roadmap disparaît.
2. Chaque projet porte **une roadmap unique** (auto-créée à la création du projet, vide →
   `DRAFT_NO_PLAN`) et **un board unique** (la cartographie visuelle du plan), tous deux
   attachés au projet.
3. Le **Kanban existant** (`hermes_cli/kanban_db.py`, `~/.hermes/kanban.db`) est
   **l'exécutant**. On ne le duplique pas : le board Roadmaps **ne** contient **pas** un
   second moteur d'exécution.
4. La **roadmap** est le plan ; le **Kanban** exécute par lot (jalon) ; le **board**
   visualise le plan complet et l'état live des cartes kanban liées.

---

## 2. Hiérarchie du plan

```
Jalon (milestone) → Phase → Todo list → Todo (= carte kanban)
```

- **Jalon** (`milestone`) : objectif intermédiaire du plan.
- **Phase** : découpage d'un jalon.
- **Todo** : unité de travail. **Chaque todo est liée 1:1 à une carte kanban.**
- Jalons et phases sont des **groupements structurants** (jamais des cartes) ; ils
  n'apparaissent pas comme cartes d'exécution.

Mapping au schéma courant (`roadmap_nodes` / `roadmap_todos`) :

- `objective` = racine du plan (outcome, critères de succès) ;
- `milestone` = jalon ;
- `phase` = phase ;
- `todo` (table `roadmap_todos`) = unité de travail → **carte kanban** ;
- `step` et `decision` : à réconcilier en étape 1a (un `step` se plie soit dans une todo,
  soit disparaît ; `decision` reste un node de décision hors hiérarchie d'exécution).

---

## 3. Pipeline

```
Plan → Team → Readiness → Execute
```

Chaque étape est fermée par sa **batterie** (§4) : rien ne passe à l'étape suivante tant
que la batterie de l'étape courante n'est pas entièrement verte.

1. **Plan** — Vision embarquée (`SessionSurface`) construit un plan très détaillé
   (jalons → phases → todos). L'ancien flux `host.openSession` (`views/plan.js`) est
   supprimé : l'embarqué est l'unique flux. Gate : **Batterie Plan**.
2. **Team** — élaboration des Lane workers selon les besoins du plan (§5). Gate :
   **Batterie Team**.
3. **Readiness** — blockers anticipés + autorisations fournies en amont. Gate :
   **Batterie Readiness**.
4. **Execute** — le Kanban exécute par lot (jalon) ; chaque todo = une carte.

---

## 4. Les trois batteries

Chaque batterie retourne la **liste des échecs** (code + libellé stable anglais), jamais un
booléen muet. Une batterie ne « valide » pas par basculement d'état : elle contrôle
réellement, puis l'étape suivante s'ouvre.

**Auto-résolution** : un échec n'est pas une impasse. La batterie déclenche une boucle
`check → résolution automatique → re-check` jusqu'à ce qu'elle soit verte. L'agent
résout ce qui est résolvable en autonomie (compléter une todo, ajouter une phase, casser
un cycle, assigner un owner, ajuster toolsets/skills). Seuls les blockers **non
résolvables en autonomie** (secret absent du vault, accès externe manquant) remontent à
l'utilisateur via une carte UX ciblée — jamais de contournement silencieux, jamais de
fallback implicite.

### 4.1 Batterie Plan — le plan est impeccable et détaillé

1. outcome et critères de succès définis au niveau `objective` ;
2. chaque jalon a ≥ 1 phase ;
3. chaque phase a ≥ 1 todo ;
4. chaque todo a un intitulé **et** un critère d'acceptation non vides ;
5. aucun node/todo orphelin hors la racine `objective` ;
6. dépendances cohérentes : aucune relation vers un node inexistant, aucun cycle.

### 4.2 Batterie Team — la team est bien sculptée

1. chaque todo a un owner (lane worker) ;
2. chaque lane worker a un modèle (matrice de sélection) + un niveau de thinking explicite ;
3. chaque lane worker a les bons toolsets ;
4. chaque lane worker a les bons skills ;
5. la team couvre tous les types de travail du plan (aucune lane manquante).

### 4.3 Batterie Readiness — tout est prêt avant lancement

1. tous les blockers futurs anticipés (dépendances externes, risques, inconnues) ;
2. chaque blocker a un plan de résolution — résolu en amont ;
3. toutes les autorisations requises listées (secrets, tokens, accès repo/API/réseau) ;
4. chaque autorisation fournie et vérifiée **avant** de lancer ;
5. aucun blocker inconnu ni accès manquant non traité.

---

## 5. Team / Lane workers

- Après validation, la team est **élaborée à partir des besoins du plan** (par lane : quel
  type de travail, quelles compétences).
- Chaque **Lane worker** est sculpté avec attention : **modèle** (via la matrice de
  sélection documentée — Codex, Claude, Zai, DeepSeek, gratuits Nous), **toolsets** et
  **skills** adaptés à sa lane.
- Aucune substitution silencieuse de modèle : le couple provider/modèle + niveau de
  thinking est décidé explicitement par la matrice, jamais déduit du nom.

---

## 6. Lien todo ↔ carte kanban

- Table de lien durable :
  `(profile_id, project_id, roadmap_id, version, todo_id) → kanban task id (+ board_slug)`.
- **Spawn batch** : à l'activation d'un jalon, ses todos créent leurs cartes kanban.
- **État live** : RPC dédié pour lire l'état des cartes liées (pour le board).
- Identités durables uniquement ; aucune colonne runtime éphémère ; le lien est
  backend-authoritatif (le renderer ne suit pas lui-même les rotations de tip).

---

## 7. Board visuelle

- Cartographie du plan complet (jalons → phases → todos), **claire, lisible, ludique**.
- Chaque todo affiche l'état **live** de sa carte kanban liée.
- Le board est une **projection** : pas un second transcript, pas un second moteur
  d'exécution, pas un doublon du Kanban.

---

## 8. Étapes de réalisation

1. Hiérarchie jalon→phase→todo + **lien todo↔carte** + **batterie de validation** (fondation).
2. **Team + Lane workers** (modèle/toolsets/skills par lane).
3. **Board visuelle** + état live des cartes.

Chaque étape se déploie en live via `roadmaps-sync.sh push` (plugin) et le redéploiement
backend (patch `tui_gateway/server.py` + `hermes_cli/projects_db.py` + fichiers nouveaux,
puis restart du serve isolé desktop).
