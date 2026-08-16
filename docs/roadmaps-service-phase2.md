# Roadmaps — contrat backend/RPC Phase 2

**Statut :** implémenté — lecture seule + mutations d’exécution

Phase 2 ajoute le plus petit chemin vertical backend pour lire Roadmaps depuis
`$HERMES_HOME/projects.db` (le chemin actif du profil). Il n’existe pas de
`roadmaps.db` et le service de lecture ne crée aucune écriture métier. Les
mutations d’exécution passent par `RoadmapsWriter`
(`hermes_cli/roadmaps_writer.py`), qui applique acteur obligatoire,
`expected_version` (verrou optimiste), transitions du contrat pur et
transaction IMMEDIATE unique.

## Service

`hermes_cli.roadmaps_service.RoadmapsService` ouvre uniquement le fichier
`projects.db` déjà existant avec une connexion SQLite URI `mode=ro` et expose :

- `list(profile_id, project_id=None)` — liste déterministe triée par projet puis
  identifiant de roadmap ;
- `get(profile_id, project_id, roadmap_id)` — métadonnées, `active_version` et
  versions avec `nodes`, `relations` et `todos` triés ;
- `snapshot(...)` — même snapshot complet que `get`.

Le profil est toujours explicite. Un scope absent est une erreur structurée
RPC ; un scope inconnu retourne `found: false` (ou une liste vide), sans repli
vers un autre profil ou projet. Les résultats sont composés uniquement de
valeurs SQLite JSON-safe.

## RPC

Le gateway enregistre :

```text
roadmaps.list
roadmaps.get
roadmaps.snapshot
roadmaps.claim_node
roadmaps.update_progress
roadmaps.complete_node
roadmaps.block_node
roadmaps.unblock_node
```

Les paramètres de lecture utilisent `profile`, `project_id` et `roadmap_id`.
Les mutations exigent en plus `node_id`, `actor`, `expected_version`, et pour
`block_node` une `reason` non vide ; `update_progress` exige `progress`
(entier 0-100).

Codes d’erreur structurés :

- `5063` — validation de scope/paramètres (y compris profil inconnu) ;
- `5064` — `expected_version` périmé (le plan a été révisé) ;
- `5065` — roadmap/nœud introuvable pour le scope donné ;
- `5066` — transition d’état invalide ;
- `5061` — store indisponible ou erreur interne.

Les cinq méthodes de mutation sont inscrites dans `_LONG_HANDLERS` : elles
ouvrent `projects.db` (validation de schéma + WAL) et prennent une
transaction d’écriture IMMEDIATE, elles ne doivent donc jamais bloquer le
reader thread WS.

## Événements différés

`roadmaps.events` n’est volontairement **pas enregistré**. La table
`events` et un journal local ne sont pas inventés. Aucun événement canonique
persistant n’est actuellement disponible dans ce chemin ; une future phase
pourra exposer un curseur uniquement après identification de l’API/source
canonique. Le client doit donc recharger `roadmaps.snapshot` après reconnexion
ou invalidation.

