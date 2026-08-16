# T6a-layout — Exploitation de l'espace + responsive colonne étroite

Retour Pierre (2026-08-15, capture upload_20260815_112838_1.png) :
« Avec tout l'espace dispo tu vas pouvoir exploiter mieux l'espace pour
l'affichage, néanmoins veille à ce que ça reste lisible et utilisable lorsque
réduit en colonne sur un côté. »

## Constat actuel (code audité, src/index.js)

- Layout = une seule colonne verticale : TabView (Thread/Map/…) occupe
  `flex-1` en haut ; Inspector est confiné en bas avec `max-h-72 shrink-0`.
- Résultat sur écran large : beaucoup de vide sous le Thread, Inspector écrasé.
- `useCompactLayout` existe (ResizeObserver + seuil 900) mais ne change que des
  détails (purpose masqué, grille 1 col) — il ne redistribue pas l'espace.

## Objectif

**Large (≥ ~1280 px de contenu)** : disposition multi-colonnes pour que les
trois surfaces majeures soient visibles en parallèle et l'espace exploité :

```
┌────────────────────────────────────────────────────────────┐
│ header scope · Next action · In flight · tabs               │
├──────────────────────┬─────────────────────┬───────────────┤
│ THREAD (Fil)         │ CARTE / PLAN /      │ INSPECTOR     │
│ (list dense nœuds    │ (vue active de      │ (détails +     │
│  + critical path)    │  l'onglet courant)  │  mutations)   │
│ flex-1               │ flex-1              │ ~320-380px    │
└──────────────────────┴─────────────────────┴───────────────┘
```

- Colonne 1 : Fil (toujours, c'est le « que faire maintenant »).
- Colonne 2 : la vue active de l'onglet (Carte/Plan/Jalons/…).
- Colonne 3 : Inspecteur (fixe ~340px, ScrollArea interne, plus de `max-h-72`).
- Le critical path reste un bandeau horizontal au-dessus du Fil.
- Espace vertical réparti ; chaque colonne scrollable indépendamment.

**Étroit (< ~900 px ou colonne latérale)** : retour à l'empilement actuel mais
**lisible** : tabs en haut, vue active seule, Inspecteur accessible par un
bouton/panneau repliable (pas un onglet perdu en bas) ; tout scrollable ;
aucun élément indispensable coupé.

**Intermédiaire (900-1280 px)** : 2 colonnes — Fil + (vue active OU inspecteur
selon la sélection), bascule propre.

## Principes

- Seuil actuel 900 px conservé comme base compact ; ajouter un seuil large
  (config.json : `breakpoints.compact < 900`, `breakpoints.wide >= 1280`).
- Utiliser la largeur RÉELLE du conteneur via ResizeObserver (déjà en place),
  pas la fenêtre.
- L'Inspecteur ne doit jamais être écrasé : largeur fixe en grand, hauteur
  naturelle + ScrollArea en étroit.
- Sélection cohérente entre colonnes (déjà en place) ; le scroll des colonnes
  ne doit pas casser le compact.
- Vérifier la densité : colonne Fil compacte (titre + état + progress sur une
  ligne quand possible), pas de doublons de libellés.

## Tranche associée (T5a en cours)

T5a ajoute les boutons + / ⋮ au header scope. La grille ci-dessus doit être
conçue pour laisser la place à ces contrôles sans pousser le contenu.

## Validation

- Rebuild esbuild + node --check + ESLint + greps habituels.
- Déploiement MBP + validation visuelle de Pierre sur : fenêtre large,
  colonne étroite, seuil intermédiaire, changement de profil/projet.
