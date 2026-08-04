# RC48 — Nettoyage et optimisation

Cette version allège le dépôt sans retirer les fonctions de production de la RC47.

## Éléments supprimés

- notes de correction historiques RC14 à RC47 ;
- anciens fichiers `CONTENU_GITHUB_*` ;
- ancienne visualisation HTML RC31 ;
- tests de présence de texte propres aux anciennes RC, remplacés par les tests métier et parcours actuels ;
- répertoires vides.

## Éléments conservés

- application React/Electron complète ;
- moteur électrique central ;
- protocole terrain et contrôles de cohérence ;
- cartographie, GPS et implantation ;
- rapports Word/PDF/Excel ;
- stockage SQLite et synchronisation ;
- builds Windows et Android ;
- ressources documentaires utilisées par l'application ;
- tests de gouvernance, métier, stockage, SQLite, intégration et parcours RC48.

## Commandes

```bash
npm ci
npm run test:all
npm run test:e2e
npm run build
```
