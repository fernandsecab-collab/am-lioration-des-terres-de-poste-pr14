# RC57 — Cartographie fiabilisée

## Corrections fonctionnelles

- Le poste HTA/BT utilise exclusivement ses coordonnées propres (`gpsLat` / `gpsLng`) et reste affiché après chaque rafraîchissement Leaflet.
- Les repères permanents sont placés dans une couche dédiée `landmarks`, distincte des tracés métier et des réseaux.
- Les coordonnées temporaires du second ouvrage ne peuvent plus écraser celles du poste.
- La géolocalisation du second ouvrage reste disponible en permanence dès qu'une solution neutre est retenue, même lorsqu'une position existe déjà.
- La cible masses/neutre est déduite de la solution réellement retenue ou de son instantané, et non plus uniquement de `improvementTarget`.
- La récupération des anciennes affaires examine tous les champs historiques de solution au lieu de s'arrêter au premier champ renseigné.
- La solution retenue conserve un `solutionSnapshot` complet et un `geometrySnapshot` persistant.
- Si un recalcul devient momentanément impossible, la carte et le rapport réutilisent la dernière géométrie validée au lieu d'afficher un plan vide.
- Le rapport cartographique utilise la même solution restaurée et la même géométrie que l'onglet Carte & implantation.

## Compatibilité

- Les anciens dossiers RC48 à RC56 restent relus grâce à la normalisation des identifiants et des libellés historiques.
- Les règles de validation Terrain/Bureau et l'export de rapport RC56 sont conservés.
