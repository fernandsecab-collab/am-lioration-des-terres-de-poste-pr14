# RC59 — Cartographie allégée et rendu unique des ouvrages

- suppression du pane Leaflet personnalisé `secabLandmarkPane` ;
- suppression des forçages globaux de `z-index`, `display`, `visibility` et `opacity` ajoutés en RC58 ;
- suppression des marqueurs créés en double au montage puis au rafraîchissement ;
- un seul rendu du poste et du deuxième ouvrage dans l’effet de synchronisation cartographique ;
- retour aux panes natifs `markerPane` et `overlayPane` ;
- suppression du second moteur de glisser-déposer par événements `pointer`, le déplacement natif Leaflet restant actif ;
- suppression du `will-change` permanent sur toutes les couches cartographiques ;
- conservation du clic sur la carte, du glisser-déposer natif et des coordonnées GPS d’origine.

Cette version corrige le blocage à la source au lieu d’ajouter une nouvelle couche.
