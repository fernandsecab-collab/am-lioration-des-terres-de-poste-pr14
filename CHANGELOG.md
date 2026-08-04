# RC57

- Fiabilisation complète de l’affichage du poste, du second ouvrage neutre et de la solution retenue sur la carte.
- Persistance de la géométrie validée et reprise identique dans le rapport.
- Géolocalisation du second ouvrage toujours accessible pour les solutions neutres.

# RC40

Rapport SECAB fidèle et thèmes premium illustrés.

## RC36
- Correction de compilation Vite : littéral JavaScript non terminé dans l’export Word.
- Ajout du test de non-régression `rc36BuildSyntax.test.mjs`.
- Aucun autre changement de couleur ou de fonction.

# RC34 — 8 thèmes premium fidèles aux maquettes

- Reconstruction depuis la RC29 neutre.
- Sélecteur instantané et persistant.
- Ancien bleu sombre supprimé hors thème Dark Navy choisi.
- Fonctions métier inchangées.

# RC29 — Remise à zéro visuelle

- Suppression complète des thèmes et règles CSS de couleur forcée.
- Conservation des fonctionnalités métier de la RC29.

# RC25

- Correction du test GitHub bloqué sur RC22.
- Tests de version rendus compatibles avec les prochaines RC.
- Test du thème clair RC24 intégré à la chaîne automatique.
- Artefacts GitHub renommés RC25.

# RC17

- Build GitHub corrigé : versions et test UI harmonisés.
- Boutons sélectionnés clairement différenciés dans tous les onglets.
- Contrastes RC16 conservés et renforcés.

# Journal des modifications

## 2.0.0 RC14 — Correction générale

- correction de l'erreur `ReferenceError: c is not defined` dans la comparaison des solutions ;
- remplacement des références erronées par les résultats `initial` réellement calculés ;
- nouvelle couche de contraste finale commune à tous les onglets ;
- correction dédiée de la fenêtre de diagnostic, des champs, tableaux, menus flottants, boutons et états désactivés ;
- préservation des couleurs adaptées à l'impression des rapports ;
- ajout d'un test de non-régression RC14.

## 2.0.0 RC14 — Stabilisation

- synchronisation de la version application/package ;
- suppression des tests et documents obsolètes des anciennes RC ;
- correction du pipeline GitHub Actions Windows ;
- contraste final renforcé sur les panneaux sombres et les cartes claires ;
- conservation des fonctions métier, SQLite, imports/exports, rapports et coûts estimatifs.

## 2.0.0 RC22
- Refonte complète et statique des contrastes de tous les écrans.
- Suppression des fonds sombres derrière les textes foncés dans l'espace métier.
- Normalisation des formulaires, tableaux, listes, boutons et états désactivés.
- Zones sombres limitées à la navigation et aux bandeaux premium avec texte blanc imposé.
- Aucun observateur DOM ni recalcul permanent de contraste.

## RC29

- Reconstruction du contraste par héritage sémantique.
- 8 thèmes premium conservés.
- Correctif global des panneaux clairs et sombres.
- Rapports maintenus sur fond blanc.

## RC35
- Rapport Word aligné sur le DOM et les styles du rapport premium affiché.
- Fond sombre appliqué uniquement à l’aperçu du rapport.
- Corbeille centralisée, accessible depuis tous les onglets et enregistrée immédiatement.

## 2.0.0-RC37
- Coût estimatif replacé immédiatement après Carte & implantation.
- Poste principal et deuxième ouvrage repositionnables par glisser-déposer ou clic direct sur la carte après GPS.
- Correction du blocage Leaflet qui interceptait le début du déplacement.
- Export Word remplacé par un vrai DOCX premium illustré avec couverture, KPI, tableaux, graphique, schéma, photos et visas.

## RC44 — Qualification client
- Contrôle de libération client de bout en bout.
- Exports client bloqués en cas de dossier incomplet ou incohérent.
- Suppression de la référence normative fixe résiduelle.
- Harmonisation des versions et des rapports.

## RC45 — Qualification finale
- Cas de référence électriques automatisés.
- Indice de confiance visible dans le rapport client.
- Traçabilité et distinction stricte entre valeurs initiales, finales et absentes.
- Suite de non-régression RC45 ajoutée.

## RC46 — Consolidation réelle
- Moteur électrique centralisé et partagé entre interface, rapports et tests.
- Règles électriques versionnées ; régimes inconnus bloqués sans valeur par défaut.
- Score de solutions limité à la faisabilité, sans prédiction électrique.
- Études unilatérales renommées en études de sensibilité mathématique.
- États documentaires normalisés et qualification RC46 ajoutée.
- Suite complète de tests source exécutée avec succès.

## RC56 — 2026-08-02
- Export Word basé sur la capture exacte des pages de l’aperçu premium.
- Suppression de la mise en page Word parallèle qui divergeait du logiciel.


## RC59

- suppression du pane Leaflet personnalisé `secabLandmarkPane` ;
- suppression des forçages globaux de `z-index`, `display`, `visibility` et `opacity` ajoutés en RC58 ;
- suppression des marqueurs créés en double au montage puis au rafraîchissement ;
- un seul rendu du poste et du deuxième ouvrage dans l’effet de synchronisation cartographique ;
- retour aux panes natifs `markerPane` et `overlayPane` ;
- suppression du second moteur de glisser-déposer par événements `pointer`, le déplacement natif Leaflet restant actif ;
- suppression du `will-change` permanent sur toutes les couches cartographiques ;
- conservation du clic sur la carte, du glisser-déposer natif et des coordonnées GPS d’origine.

Cette version corrige le blocage à la source au lieu d’ajouter une nouvelle couche.

## RC60
- Ajout du choix du point de raccordement : automatique, poste, deuxième ouvrage neutre ou libre sur carte.
- Correction du rapport afin qu'il reproduise strictement l'implantation validée.
