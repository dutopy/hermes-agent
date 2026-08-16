# Roadmaps — contrat de store Phase 1

## Décision

Roadmaps n’introduit pas de base `roadmaps.db`. L’autorité durable reste le
store backend-owned `projects.db`, résolu par le runtime via
`get_hermes_home()` pour le profil actif. Le plugin/UI ne crée pas de
connexion SQLite et ne migre pas le store.

**État de l’implémentation dans ce worktree :** le schéma Phase 1 est désormais
porté dans le runtime réel `hermes_cli/projects_db.py`, dans sa constante
`SCHEMA_SQL` consommée par `connect()`. Les tests d’intégration utilisent cet
import réel et des `db_path` sous `tmp_path`. Le checkout
`/home/hermes-sys/.hermes/hermes-agent/` reste explicitement hors périmètre de
modification.

## Audit du runtime de référence

Le module de référence :

- stocke `projects.db` sous le `get_hermes_home()` du profil courant ;
- accepte `db_path` explicite dans `connect()` pour les tests ;
- active les clés étrangères SQLite ;
- initialise avec `CREATE TABLE IF NOT EXISTS` ;
- applique les colonnes historiques manquantes avec une migration additive
  idempotente ;
- valide à chaque ouverture la compatibilité complète des tables Roadmaps
  préexistantes (colonnes, PK, FKs et contraintes SQL), au lieu de faire
  confiance à `CREATE TABLE IF NOT EXISTS` ;
- utilise un contrat runtime indépendant et immuable de `SCHEMA_SQL` pour cette
  validation ; une modification affaiblissante du DDL ne peut donc pas affaiblir
  le validateur ;
- réessaie à chaque ouverture la migration additive des colonnes historiques
  manquantes de `projects`, même lorsque les tables Roadmaps existent déjà ;
- possède actuellement `projects`, `project_folders`, `project_meta` et
  `discovered_repos` (pas de table `project_worktrees` dans le `SCHEMA_SQL`
  inspecté) ;
- identifie un projet par `projects.id`/`slug`, tandis que l’isolation de
  profil est assurée par le chemin de la base, pas par une colonne de
  `projects`.

Le portage est intégré au runtime de référence ; toute évolution future devra
étendre `SCHEMA_SQL`, le contrat indépendant et le chemin de migration existant
dans ce module, sans recréer ses helpers, ses dataclasses ou son `connect()`. Le `profile_id` Roadmaps est une clé de scope explicite dans les
tables nouvelles, mais sa valeur doit être fournie par le runtime du profil
actif et ne doit jamais servir à ouvrir une autre base.

## Modèle minimal durable

Toutes les tables Roadmaps portent le scope qualifié
`(profile_id, project_id, roadmap_id)`. Les enfants répètent les colonnes de
scope afin que SQLite puisse imposer des références composites et empêcher
les relations inter-roadmap. Les identifiants sont des chaînes opaques,
non vides et trimées ; les acteurs obligatoires (`created_by`, `updated_by`)
le sont aussi, et `owner_agent` est contrôlé lorsqu’il est renseigné. Ces
`CHECK` DDL ne remplacent pas la normalisation/validation applicative.

`profile_id` est une revendication de scope applicative à l’intérieur d’un
`projects.db` propre au profil, pas une frontière de sécurité. L’isolation
réelle vient du chemin `$HERMES_HOME` actif (et de l’autorisation backend) ;
une valeur de colonne ne doit jamais permettre d’ouvrir la base d’un autre
profil.

### `roadmaps`

| Colonne | Rôle |
|---|---|
| `profile_id TEXT NOT NULL` | profil propriétaire de la connexion |
| `project_id TEXT NOT NULL` | FK vers `projects(id)` |
| `roadmap_id TEXT NOT NULL` | identifiant unique dans le projet |
| `title TEXT NOT NULL` | titre humain |
| `purpose TEXT` | objectif |
| `lifecycle_state TEXT NOT NULL` | `draft`, `proposed`, `validated`, `in_progress`, `blocked`, `completed`, `archived` |
| `active_version INTEGER` | version normative active, nullable avant validation |
| `created_by TEXT NOT NULL`, `updated_by TEXT NOT NULL` | acteurs |
| `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL` | timestamps UTC epoch |

PK : `(profile_id, project_id, roadmap_id)`. FK : `project_id REFERENCES
projects(id) ON DELETE CASCADE`. `active_version` est une référence composite
nullable vers `(profile_id, project_id, roadmap_id, version)` de
`roadmap_versions`, avec `DEFERRABLE INITIALLY DEFERRED` ; une version active
orpheline est donc impossible au commit.

### `roadmap_versions`

Une version est immuable après publication ; les révisions créent une ligne
nouvelle. Colonnes : scope complet, `version INTEGER`, `state` (`draft`,
`proposed`, `validated`, `superseded`, `archived`), `source`, `reason`,
`created_by`, `created_at`, `content_hash` optionnel. PK :
`(profile_id, project_id, roadmap_id, version)`. FK composite vers
`roadmaps`. `version >= 1`.

### `roadmap_nodes`

Colonnes : scope complet, `node_id`, `version`, `parent_node_id` nullable,
`kind` (`objective`, `phase`, `milestone`, `step`, `decision`), `title`,
`description`, `state` (`planned`, `ready`, `in_progress`, `blocked`,
`completed`, `archived`), `progress` entre 0 et 100, `owner_agent`,
`block_reason` (nullable, raison de blocage persistée), `created_at`,
`updated_at`. PK : `(profile_id, project_id, roadmap_id,
version, node_id)`. FK composite vers `roadmap_versions`. Le parent est une
FK composite vers le même scope et la même version ; `parent_node_id` nul est
réservé à la racine. Un node ne peut pas être son propre parent.

`block_reason` a été ajouté en évolution additive après le port Phase 1, via
le mécanisme `_add_column_if_missing` appliqué à chaque ouverture, comme les
colonnes historiques de `projects`. Le DDL, le contrat indépendant et les
tests documentent cette colonne ; une base créée avec le DDL d’origine est
migrée en place à la première ouverture.

### `roadmap_relations`

Colonnes : scope complet, `version`, `relation_id`, `from_node_id`,
`to_node_id`, `kind` (`depends_on`, `blocks`, `enables`, `follows`,
`validates`, `supersedes`), `state` (`active`, `superseded`, `invalid`),
`reason`. PK : `(profile_id,
project_id, roadmap_id, version, relation_id)`. Deux FKs composites vers
`roadmap_nodes` garantissent l’existence des deux extrémités dans la même
roadmap et version. `from_node_id <> to_node_id`.

### `roadmap_todos`

Colonnes : scope complet, `version`, `todo_id`, `node_id`, `title`, `state`
(`open`, `in_progress`, `done`, `cancelled`), `position`, `created_at`,
`updated_at`. PK : `(profile_id, project_id, roadmap_id, version, todo_id)`.
FK composite vers la version et, si `node_id` est renseigné, vers un node de
la même version. Les todos ne sont pas une seconde source de vérité pour les
nodes.

## États persistés et périmètre

La persistance sépare :

- snapshot de plan : `roadmaps.active_version` + `roadmap_versions` ;
- état d’exécution : `roadmap_nodes.state` et `progress` ;
- état des todos : `roadmap_todos.state` ;
- relations structurelles : `roadmap_relations`.

**Différé :** `reports`, `proofs`, `events`, curseurs/replay et toute
projection d’agent. Leur propriétaire et leur contrat d’écriture ne sont pas
encore nécessaires pour le store de cette phase. Aucun champ JSON ou table
anticipée ne doit les préfigurer.

## Migration additive

Le portage réalisé dans le runtime de référence :

1. conserve toutes les tables, lignes, index et colonnes existants ;
2. exécute les `CREATE TABLE IF NOT EXISTS` Roadmaps via `SCHEMA_SQL` dans le
   chemin d’initialisation de `connect()` ;
3. active `PRAGMA foreign_keys=ON` comme aujourd’hui ;
4. ne traite aucun cache de chemin comme autorité : une vérification légère du
   schéma Roadmaps est rejouée à chaque `connect()` ; si le fichier est
   supprimé puis recréé dans le même processus, toutes les tables sont donc
   réinitialisées ;
5. rend chaque ouverture idempotente lorsque l’initialisation va à son terme ;
6. ne reconstruit/supprime aucune table existante et ne remplit pas
   automatiquement de données Roadmaps.

L’initialisation conserve le comportement transactionnel historique de
`connect()` (qui utilise `executescript` et ses conventions SQLite). Une
atomicité de migration plus forte en cas d’interruption n’est donc pas
revendiquée par cette phase. La validation de compatibilité et la fermeture
propre en cas d’erreur ne constituent pas une garantie d’atomicité runtime.

Aucune migration de `projects` n’est requise pour la Phase 1 : sa clé `id`
est déjà disponible. Le `profile_id` n’est pas ajouté à `projects`, car le
profil est une propriété du fichier `projects.db` résolu par le runtime. Dans
un même `projects.db`, la FK DDL `roadmaps.project_id -> projects.id` n’est
donc pas profil-qualifiée : la validation de cohérence entre `profile_id` et
le profil actif relève de l’application. Qualifier cette identité dans
SQLite nécessiterait de modifier la table `projects` existante
(clé/contrainte composite), ce qui est hors périmètre et ne doit pas être
inventé.

## Rollback documentaire

Avant portage : sauvegarder le fichier `projects.db` du profil concerné et
prendre une copie SQLite cohérente (`VACUUM INTO` ou sauvegarde applicative,
base inactive). Pour revenir en arrière, restaurer cette copie ; ne pas
supprimer les tables nouvelles dans une base en production et ne pas exécuter
un `DROP TABLE` automatique. La migration est additive et le code précédent
peut ignorer les tables inconnues. Une future migration destructive nécessitera
un numéro de schéma et une procédure séparée, jamais un rollback implicite.

## Invariants et tests

Les tests préparatoires de `tests/test_roadmaps_store_phase1_contract.py`
restent une vérification DDL isolée et exhaustive du contrat. Les tests
runtime de `tests/hermes_cli/test_projects_db_roadmaps.py` rejouent le chemin
réel `hermes_cli.projects_db.connect()` avec un `db_path` temporaire et
vérifient :

- initialisation répétée sans erreur et sans duplication de tables ;
- `PRAGMA foreign_keys`, le contrat de schéma (noms/types, `NOT NULL`, ordre
  ordinal des PK), les FKs et les marqueurs SQL des `CHECK`/contraintes ;
- active version composite, identifiants/acteurs vides ou whitespace et enums ;
- FK projet, FK de scope/version/node, cascade, parents et relations/todos
  manquants ou croisés ;
- rejet des identifiants dupliqués par les PK ;
- conservation de plusieurs tables, lignes et index legacy après migration
  additive, et rejet explicite d’une table `roadmaps` incompatible ;
- absence de `reports`, `proofs`, `events`, projections d’agent et de
  `roadmaps.db`, ainsi que l’absence d’accès au home réel.

La fixture préparatoire est transactionnelle : elle ouvre une transaction
explicite, exécute chaque instruction DDL séparément, valide la compatibilité
avant `COMMIT` et annule toute création en cas d’échec. Le runtime réel
conserve `executescript` ; les tests d’intégration valident son initialisation
idempotente et la préservation legacy, mais ne revendiquent pas l’atomicité
d’une migration interrompue. Les fonctions CRUD Roadmaps, RPC/UI, rapports,
preuves, événements et projections d’agent restent différés.

## Suite différée

Le portage DDL est terminé. Il reste à concevoir et tester séparément les
fonctions CRUD/RPC/UI Roadmaps et les écritures atomiques runtime ; aucune de
ces surfaces n’est ajoutée par la Phase 1.
