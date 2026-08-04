# RC54 — Poste visible et géolocalisation du 2ᵉ ouvrage

- Le symbole du poste HTA/BT possède maintenant une taille Leaflet explicite et reste visible sur les cartes Terrain/GPS et Carte & implantation.
- Le repère est toujours déplaçable par glisser-déposer et par clic sur la carte.
- L’onglet **4B. Amélioration RN seule** contient désormais directement le choix, la géolocalisation, la carte de repositionnement, la résistivité et la photo du 2ᵉ ouvrage.
- L’ouverture de 4B force correctement la cible métier `neutral`; l’ouverture de 4A force `masses`.
- Le passage à l’implantation depuis 4B est bloqué tant que le type du 2ᵉ ouvrage et ses coordonnées ne sont pas renseignés.
- Les repères permanents POSTE HTA/BT et 2ᵉ OUVRAGE NEUTRE ont une taille explicite pour éviter leur disparition après rafraîchissement des couches.
