# Roadmaps — panel procédural agent Phase 3

**Statut :** implémenté, lecture seule

Cette tranche expose Roadmaps aux agents sous forme du toolset natif
`roadmaps`, sans remplacer Projects, Kanban, `todo` ou les outils de session.

## Outils

- `roadmap_list(profile_id, project_id?)`
  - liste les Roadmaps du profil actif ;
  - accepte un Project explicite facultatif ;
  - ne crée pas de base et ne modifie aucun état.
- `roadmap_context(profile_id, project_id, roadmap_id)`
  - charge le snapshot durable complet ;
  - retourne les versions, nœuds, relations et todos ;
  - exige le scope complet et ne fait aucun fallback.

## Frontière d’activation

Le toolset est déclaré dans `toolsets.py`, mais n’est pas ajouté à la liste
core ni automatiquement à toutes les sessions Desktop/TUI. Il peut être activé
explicitement pour un agent rattaché à un projet orchestré. Une future étape
pourra l’activer dynamiquement à partir d’un contexte Roadmap associé à la
session, sans l’imposer aux conversations ordinaires.

## Autorité et sécurité

Les outils appellent `RoadmapsService`, qui lit uniquement le
`$HERMES_HOME/projects.db` du profil actif avec une connexion SQLite `mode=ro`.
Le plugin/UI ne reçoit aucun accès SQLite. Les identifiants de scope sont
obligatoires ; aucune mutation, aucun événement synthétique et aucun rapport
n’est créé dans cette phase.

## Écritures d’exécution (Phase 3 bis)

Le panel procédural expose désormais des mutations d’exécution de nœud, via
`RoadmapsWriter` (`hermes_cli/roadmaps_writer.py`) :

- `roadmap_claim_node` — `ready → in_progress`, assigne `owner_agent` ;
- `roadmap_update_progress` — progression 0-100 sur un nœud `in_progress` ;
- `roadmap_complete_node` — `in_progress | blocked → completed` ;
- `roadmap_block_node` — `in_progress → blocked`, raison persistée
  (`block_reason`, colonne additive) ;
- `roadmap_unblock_node` — `blocked → in_progress`, raison effacée.

Garanties identiques à la lecture, plus :

- acteur obligatoire et tracé (`updated_by` sur la roadmap) ;
- `expected_version` obligatoire : la mutation est rejetée si la version
  active du plan a changé depuis la lecture (verrou optimiste) ;
- transitions validées par le contrat pur `src.roadmaps_contract` ;
- transaction unique IMMEDIATE, rollback intégral en cas d’erreur ;
- une roadmap sans version active n’est jamais mutable.

Les opérations de structure du plan (proposer, valider, réviser une version)
restent réservées à la gouvernance et ne sont pas exposées.

## Suite

Le panel procédural couvre lecture et exécution de nœud. Les prochaines
tranches porteront sur :

- les événements canoniques et leur curseur de rattrapage (après
  identification de l’API/source canonique) ;
- les rapports et preuves structurés ;
- les opérations de gouvernance de plan (proposer/valider/réviser) ;
- l’activation dynamique du toolset pour les agents rattachés à un projet
  orchestré, sans l’imposer aux conversations ordinaires.
