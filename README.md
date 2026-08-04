# Mesure & amélioration des terres de poste de transformation — RC49

**RC49 Stable** centralise le calcul électrique, bloque les régimes inconnus, sépare la faisabilité des solutions de toute prédiction électrique et renforce la qualification avant émission client.

Voir `RC49_CORRECTION_BUILD.md` pour le correctif de compilation et les contrôles réalisés.

# RC40

Rapport SECAB fidèle et thèmes premium illustrés.

## Version 2.0 RC39

Build GitHub fiabilisé : package.json validé et restaurable automatiquement avant npm install.

# RC34 — Mesure & amélioration des terres de poste de transformation

Cette version ajoute un moteur de contraste sémantique chargé après les feuilles historiques. Les huit thèmes premium et toutes les fonctions RC27 sont conservés.

# Mesure & amélioration des terres de poste de transformation — V2.0 RC14 Stable

Application métier SECAB pour le diagnostic, l’amélioration, l’implantation et la traçabilité des terres de postes de transformation.


## Règle métier de métré
La longueur de cuivre est calculée automatiquement selon la règle SECAB : **1 m de tranchée = 3 m de cuivre**. Le calcul est centralisé et utilisé dans l’exécution et le chiffrage interne.

## Protection du rapport client
Les coûts, durées, effectifs et estimations chantier sont strictement réservés au bureau et ne sont jamais intégrés aux exports client PDF, Portfolio ou Word.

## Périmètre volontaire
Aucun générateur automatique de mémoire technique n’est inclus.

---

# SECAB Couplage Expert Premium V2.0 RC5 — SQLite Pro

Cette version remplace le stockage transactionnel JSON par une vraie base SQLite native : WAL, transactions immédiates, migrations, révisions immuables, audit SHA-256, sauvegardes natives et migration automatique RC4.

> Installation développeur : `npm install` puis `npm run test:all`. Le pilote `better-sqlite3` est automatiquement reconstruit pour Electron par le script `postinstall`.

Voir `CHANGELOG_V2.0_RC5_SQLITE_PRO.md` pour le détail.

---

# SECAB Couplage Expert Premium — V2.0 RC2 National

Version recentrée sur la simplicité d’usage, l’expertise explicable et un rapport à double lecture client/professionnel.

# SECAB Couplage Expert Premium V134

Version bureau et terrain avec diagnostic déterministe, classement robuste des solutions, cartographie, implantation, rapports et synchronisation.

## Nouveautés V134
- Indice de confiance, robustesse et sensibilité terrain des solutions.
- Module **Coûts estimatifs** disponible exclusivement dans la version bureau.
- Tous les prix sont saisis manuellement et le total général est calculé automatiquement.
- Contraste renforcé globalement pour tous les textes et champs.


## Nouvelle phase : historique et restauration sécurisée

- nouvel onglet **Historique / restauration** ;
- création manuelle d’un point de sauvegarde avant une modification sensible ;
- liste chronologique des révisions de chaque affaire ;
- restauration d’une ancienne version avec sauvegarde automatique préalable de l’état courant ;
- export JSON individuel d’une révision ;
- journal d’audit des clôtures, restaurations, synchronisations et opérations importantes ;
- état Drive et date de dernière modification visibles immédiatement ;
- interface cohérente avec la charte bleu SECAB.

## Vérification

Utiliser `npm run verify` pour contrôler ESLint et générer le build Vite.


## Phase V111 — Travaux
Le workflow comprend désormais une étape dédiée à la réalisation, aux contrôles avant remblaiement, aux photos et au relevé des écarts chantier.


## V114 — Schémas techniques intelligents
La phase Implantation génère maintenant un schéma vectoriel d’exécution à partir de la solution et des paramètres réels du chantier. Le module fournit une vue en plan cotée, une coupe de pose, des contrôles de cohérence et un export SVG. Aucun calcul de coût ni critère financier n’est utilisé.


## V115 — Fiabilité visuelle et positionnement manuel
- Contraste renforcé sur les cartes et panneaux clairs.
- Numéros de parcelles directement cliquables et sélection persistante dans le panneau foncier.
- Repère de l’ouvrage déplaçable librement après géolocalisation, avec verrouillage indépendant.
- Retour à la position GPS source sans perte des données GPS originales.
- Prise de terre toujours positionnée au mètre près.


## V117 — Filtrage coefficient de couplage

- L’onglet Diagnostic & Solutions présente les solutions techniquement envisageables sans prédire ni garantir leur résultat électrique.
- Les solutions insuffisantes sont masquées automatiquement.
- Si aucune géométrie classique ne permet d’atteindre la cible, le logiciel propose une procédure renforcée de découplage : suppression des liaisons parasites, déplacement de la MALT du neutre, prise dédiée hors zone d’influence commune et nouvelle campagne de mesures.
- Aucune conformité n’est déclarée sur la seule simulation : RM, RNi et RMN finales restent obligatoires.


## V123
- Interface Carte & implantation homogène selon la maquette premium validée.
- Poste transformateur représenté par le symbole électrique et déplaçable librement.
- Symbole de terre placé à côté du schéma réel pour ne pas masquer la prise de terre à créer.
- GPS d’origine conservé, précision affichée et recentrage possible.
- Contraste renforcé dans tout le logiciel.
- Rapport premium réagencé pour éviter les chevauchements.


## V123
Le poste se géolocalise dans Terrain / GPS. Le deuxième ouvrage se géolocalise séparément dans Diagnostic & solutions. Les deux positions peuvent être corrigées librement sans perdre la position GPS originale.


## V123 — stabilisation terrain et diagnostic
- Poste transformateur géolocalisé dans Terrain / GPS puis déplaçable librement par glisser-déposer.
- Deuxième ouvrage géolocalisé séparément dans Diagnostic & solutions puis déplaçable librement.
- Positions GPS originales conservées pour permettre un recentrage.
- Contraste global renforcé dans tous les onglets.
- Photos de rapport conservées jusqu’à 2560 px avec une compression haute qualité.


## V123 — fiabilisation cartographique et lisibilité
- Étiquettes cadastrales centrées et contrastées.
- Liaison ouvrage–prise de terre raccordée au nœud réel du schéma.
- Schémas de prises de terre conservés selon la bibliothèque métier.
- Contraste global renforcé sur tous les onglets et états.

## V125 — thèmes et cartographie
Le sélecteur de thème reste disponible dans Administration. Les trois thèmes appliquent maintenant une règle de contraste stricte à tous les onglets. Les fonds de carte restent sélectionnables depuis le contrôle des couches : IGN/Géoportail, Google, Esri et OpenStreetMap. IGN est utilisé par défaut et comme solution de repli lorsque l'imagerie satellite choisie ne répond pas.

## Build Windows V129

Le workflow `.github/workflows/build-windows.yml` génère automatiquement :

- `SECAB-Couplage-Expert-Premium-Setup-1.29.0-x64.exe` ;
- `SECAB-Couplage-Expert-Premium-Portable-1.29.0-x64.exe`.

Le téléchargement d’Electron est mis en cache et le packaging est relancé automatiquement en cas de coupure réseau temporaire.


## V133
- Architecture Poste de pilotage généralisée.
- Fond blanc cassé confortable et contraste renforcé.
- Retour visuel au clic sur tous les boutons.
- Rapport enrichi avec schéma technique et planche photographique systématiques.

## V135 — rapports client
La version bureau propose désormais deux livrables séparés : un rapport technique sans prix et un rapport complet avec estimation financière. Les cartes du rapport utilisent IGN / Géoportail en haute définition et les photographies sont optimisées jusqu’à 4096 px pour préserver les détails.

## V137
Le rapport explique désormais pourquoi la solution retenue fonctionne, avec une lecture client, une justification professionnelle, la référence documentaire validée et rattachée au dossier et la réserve de validation par mesures finales.

## V2.0 Premium — rapport d'expertise

La V2.0 ajoute un moteur d'expertise explicable et pondéré, un comparatif avant/simulé/après mesuré, des risques contextualisés, un glossaire client/professionnel, un quantitatif chantier, un registre documentaire et un historique de traçabilité. Les coûts restent réservés au bureau et les rapports peuvent être exportés avec ou sans prix.

> Important : l'indice affiché est un indice technique d'aide à la décision, pas une probabilité statistique. La conformité définitive est confirmée par les mesures après travaux.

## RC3 National — objectif de diffusion

La RC3 ajoute un tableau de préparation nationale. Il ne masque pas les limites : une diffusion officielle reste conditionnée par un référentiel documentaire complet, des cas métier réels validés, une authentification nominative, une base locale transactionnelle, une recette PDF et un installeur Windows signé.

Commandes de contrôle :

```bash
npm install
npm run test:all
npm run verify
```

## RC4 National — stockage et preuve
La RC4 ajoute un stockage local transactionnel (`transactional-json-sha256`) avec écriture atomique, révisions immuables et audit chaîné SHA-256. L’API est exposée via `window.secabDesktop.saveTransactionalRecord`, `loadTransactionalRecord`, `listTransactionalRecords` et `verifyTransactionalStore`.

Le stockage n’est pas présenté comme SQLite : il s’agit d’une couche de persistance robuste et testable, conçue pour permettre une migration ultérieure sans modifier le parcours métier.

## RC6 National Pro — première ouverture

Sur le logiciel Windows, la première ouverture demande la création du compte administrateur nominatif. Le mot de passe doit contenir au moins 8 caractères. Après connexion, SQLite devient la source de vérité : le registre est chargé depuis la base et chaque modification est enregistrée transactionnellement.

Les rapports officiels sont bloqués lorsque le référentiel documentaire comporte encore une référence incomplète.
## RC9 — ouverture directe

Sur Windows, le logiciel s’ouvre désormais directement sans écran d’identification. Une session locale est créée automatiquement en arrière-plan afin de conserver le fonctionnement de SQLite, des révisions, de l’audit, des rapports et de la synchronisation.


## RC10 — correction de l’erreur globale `c is not defined`

Le contrôle qualité global et le contrôle de clôture utilisent désormais la variable calculée `initial`. Cette correction restaure tous les onglets, car le bandeau de qualité est commun au parcours complet.

## RC22 — Contrastes consolidés
La RC22 applique un thème métier clair déterministe. Les textes foncés ne sont utilisés que sur des fonds blancs ou clairs. Les textes blancs sont réservés à la navigation et aux bandeaux explicitement sombres. Ces règles sont entièrement CSS et n'ajoutent aucun traitement dynamique pendant l'utilisation.


## RC48 — principe de fiabilité
La conformité est prononcée uniquement à partir des mesures réelles, du protocole terrain confirmé et d’un référentiel validé. Les scores de solutions sont des aides de faisabilité et ne prédisent jamais une résistance ou un coefficient futur.
