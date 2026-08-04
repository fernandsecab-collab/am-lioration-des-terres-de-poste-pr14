# RC64 — placement réellement libre et rapport strictement identique

## Corrections
- Suppression du double déplacement de la prise de terre (coordonnées + offsets).
- La position `centerLat/centerLng` devient l'unique source de vérité géométrique.
- Les offsets X/Y restent uniquement informatifs pour le métrage par rapport à l'ouvrage.
- Aucun accrochage à une grille, route, parcelle, bâtiment ou réseau.
- Conservation de la position choisie lors du déplacement manuel du poste ou du 2e ouvrage.
- Suppression du recentrage automatique du rapport lors d'un changement de coordonnées ouvrage.
- Le rapport reprend systématiquement le `geometrySnapshot` validé à l'écran.
- La liaison arrive au centre exact de la prise de terre choisie.

## Résultat attendu
Le poste, le 2e ouvrage et la prise de terre sont positionnables librement. Après enregistrement, le rapport restitue exactement la même implantation, orientation et liaison.
