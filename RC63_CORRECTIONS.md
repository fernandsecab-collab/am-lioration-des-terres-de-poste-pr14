# RC63 — déplacement libre et affinage du 2ᵉ ouvrage

- suppression du recentrage automatique de la carte à chaque changement de coordonnées ;
- suppression de l’auto-pan Leaflet pendant le déplacement des ouvrages, de la prise de terre et du raccordement ;
- déplacement exact au curseur, sans grille, route, parcelle, réseau ni point d’attraction ;
- ajout d’une carte dédiée d’affinage manuel du 2ᵉ ouvrage, identique au principe utilisé pour le poste ;
- mise à jour directe de `neutralGpsLat` / `neutralGpsLng` lors du déplacement du second ouvrage ;
- conservation des coordonnées GPS d’origine et bouton de restauration ;
- micro-ajustements ramenés à 0,1 m sans arrondi préalable ;
- suppression des textes d’interface évoquant encore un accrochage à une grille de 1 m ;
- les coordonnées affinées restent utilisées par l’implantation, la liaison et le rapport.
