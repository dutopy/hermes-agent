# Roadmaps — contrat d’orchestration Phase 0

**Statut :** contrat de conception exécutable, lecture seule

**Périmètre :** Hermes Roadmaps, par profil et par projet

## 1. Autorité

Roadmaps n’est pas une base autonome. L’autorité métier appartient au backend Hermes :

```text
Desktop Roadmaps
  -> host.request / host.onEvent
  -> tui_gateway JSON-RPC et services Hermes
  -> projects.db du profil actif
```

`projects.db` est l’unique autorité durable backend-owned du projet et du domaine Roadmaps. Les migrations sont backend-owned, additives et exécutées par le service Hermes. Le plugin Desktop ne crée aucune table et n’écrit aucun fichier métier.

Le `canonical event bus` et son journal persistant `canonical_events.db` ne sont pas une seconde autorité : ils transportent et conservent uniquement des faits metadata-only, permettent les notifications live et le rattrapage par curseur. Toute reconstruction relit d’abord le snapshot de `projects.db`.

`state.db` reste le store des sessions et messages. Kanban peut être référencé par `project_id`, `task_id` ou `worktree_id`, mais ne porte pas l’autorité des plans Roadmaps.

## 2. Scope obligatoire

Toute entité Roadmaps est qualifiée par :

```text
profile_id / project_id / roadmap_id
```

Tout nœud est identifié par :

```text
profile_id / project_id / roadmap_id / node_id
```

Une relation doit référencer deux nœuds du même scope complet. Un `node_id` seul n’est jamais suffisant pour charger ou muter une entité.

Le changement de profil réinitialise avant rechargement : projet sélectionné, nœud sélectionné, snapshot, curseur d’événements, caches et abonnements.

## 3. Snapshot et projections

Le snapshot sépare les dimensions suivantes :

- `plan_snapshot` : version et contenu du plan validé ou proposé ;
- `execution_state` : état opérationnel calculé ;
- `reported_state` : dernier état déclaré par un agent ;
- `verification_state` : état vérifié par une preuve ou une autorité ;
- `todos` : liste d’actions atomiques et leur état ;
- `relations` : dépendances et blocages typés.

Un rapport agent ne vaut pas automatiquement vérification. Une preuve peut faire évoluer `verification_state` selon une règle explicite, jamais par simple présence d’un texte.

## 4. Événements

Les événements canoniques sont des faits **metadata-only**, versionnés et rejouables : ils décrivent l’identité, la portée, la version et le hash d’un fait, mais ne deviennent jamais une seconde autorité durable. `EventEnvelope` ne conserve donc jamais le payload (ni secret, transcript ou autre contenu sensible) : seule son empreinte `payload_hash` est conservée. La factory peut recevoir un payload en mémoire uniquement pour calculer cette empreinte. `projects.db` reste la seule source de vérité. Les notifications live (`host.onEvent`) ne sont que des signaux d’optimisation ; elles ne sont ni autoritaires ni suffisantes pour reconstruire l’état. Le rattrapage depuis un curseur recharge le snapshot backend puis les événements ; il ne remplace pas ce snapshot et ne peut pas réécrire silencieusement un agrégat plus récent.

```json
{
  "schema_version": 1,
  "event_id": "evt-...",
  "event_type": "roadmap.node.progressed",
  "profile_id": "...",
  "project_id": "...",
  "roadmap_id": "...",
  "aggregate_type": "roadmap|node|todo|report|proof",
  "aggregate_id": "...",
  "aggregate_version": 3,
  "actor": "profile-or-agent-id",
  "occurred_at": "UTC",
  "received_at": "UTC",
  "causation_id": "...",
  "correlation_id": "...",
  "payload_hash": "sha256(...)"
}
```

La réception doit être idempotente par `event_id`. Un doublon strictement identique (même scope, agrégat, acteur, version, hash, causation/correlation et timestamps) est ignoré sans second effet. Le même `event_id` avec une différence d’identité, de métadonnée ou de `payload_hash` est un conflit et doit être rejeté. Les timestamps `occurred_at` et `received_at`, normalisés en UTC, font partie de cette identité contractuelle.

`event_type` est obligatoire et doit être un nom lowercase qualifié par points (par exemple `roadmap.node.progressed`). Il fait partie de l’identité en cas de conflit. Le validateur de replay parcourt et valide tout le flux, puis déduplique strictement les `event_id` dans le suffixe retourné : un consommateur ne reçoit jamais deux fois le même événement, même si la source contient des doublons identiques.

La lecture live via `host.onEvent` est une notification, pas l’autorité. Après reconnexion, le client recharge le snapshot puis les événements depuis son curseur. Les événements en retard ou régressifs (`aggregate_version` inférieur ou égal à la version déjà appliquée) sont rejetés ou placés en erreur selon la politique du service ; ils ne doivent pas réécrire silencieusement un agrégat plus récent.

## 5. États normatifs

### Plan

```text
draft -> proposed -> validated -> in_progress -> completed -> archived
                         |              |
                         v              v
                  revision_requested <- blocked
```

Transitions minimales :

- `draft -> proposed` ;
- `proposed -> validated | revision_requested` ;
- `validated -> in_progress | revision_requested` ;
- `in_progress -> blocked | completed | revision_requested` ;
- `blocked -> in_progress | revision_requested` ;
- `completed -> archived | revision_requested` ;
- `revision_requested -> proposed | archived` ;
- `archived` est terminal.

Une révision d’un plan validé est une nouvelle version liée à la précédente. Elle ne remplace pas silencieusement l’historique.

### Nœud

```text
planned -> ready -> in_progress -> completed -> archived
                         |
                         v
                       blocked
```

- `planned -> ready` seulement si les préconditions sont satisfaites ;
- `ready -> in_progress` quand un agent prend l’étape ;
- `in_progress -> blocked | completed` ;
- `blocked -> in_progress | completed` après résolution ou décision explicite ;
- `completed -> archived` ;
- `archived` est terminal.

Les transitions sont contrôlées par le service, avec `expected_version` pour éviter les écrasements concurrents.

## 6. Résolution du projet

Ordre de résolution :

1. `project_id` explicitement choisi dans Roadmaps ;
2. projet Desktop courant, s’il fournit une identité explicite ;
3. cwd uniquement pour proposer une correspondance ;
4. absence ou ambiguïté : état vide guidé.

Il est interdit de retomber silencieusement sur `default`, le dernier projet ou le premier résultat trouvé.

## 7. RPC prévus

La frontière Phase 0 `RoadmapRepository` est strictement read-only et ne fait aucune persistance. Elle expose seulement `list`, `get`, `get_snapshot` et `get_events_after(scope, cursor)` ; le fixture injecté implémente cette frontière en mémoire. Le replay valide le flux complet (identités et versions strictement croissantes par agrégat), puis retourne uniquement le suffixe demandé par le curseur, dédupliqué par `event_id`.

Lecture :

```text
projects.list
roadmaps.list
roadmaps.get
roadmaps.get_snapshot
roadmaps.get_events
```

Écriture future :

```text
roadmaps.propose_revision
roadmaps.validate_revision
roadmaps.update_node
roadmaps.update_todo
roadmaps.publish_report
roadmaps.attach_proof
roadmaps.resolve_blocker
```

Les méthodes doivent toujours recevoir le scope explicite, retourner une erreur structurée en cas de scope absent ou incorrect, et ne jamais exposer de secret ou de transcript complet dans les événements.

## 8. Agents et permissions

Les agents peuvent lire le scope du projet auquel ils sont associés. Ils peuvent publier progression, rapport, preuve ou todo selon leur rôle. La validation d’un plan et la modification de sa structure exigent l’autorité de l’orchestrateur ou une permission explicite.

Chaque écriture future doit être :

- authentifiée par le service ;
- scoped par profil/projet/roadmap/nœud ;
- idempotente ;
- versionnée ;
- auditée ;
- testée contre les accès inter-profils et inter-projets.

## 9. Phase 0 et fixture

La Phase 0 ne fait que définir et tester les invariants purs. Son fixture est en mémoire, injecté derrière un futur `RoadmapRepository`, et strictement read-only. Il ne crée ni `projects.db`, ni `state.db`, ni `canonical_events.db`, ni cache persistant.

La Phase 0 est terminée uniquement lorsque :

- les clés complètes sont testées ;
- les relations hors scope sont refusées ;
- les collisions d’événements sont refusées ;
- les replays identiques sont idempotents ;
- les transitions invalides sont refusées ;
- aucun fichier durable n’est créé par le fixture ;
- la documentation et les tests décrivent le même contrat.
