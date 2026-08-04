# RC58 — Symbole du poste toujours visible

## Cause précise corrigée

Les règles CSS ajoutées au fil des versions remettaient les `z-index` des panes Leaflet à `auto`. Selon le fond de carte et les couches rechargées, les tuiles IGN, le cadastre ou le SVG d’implantation pouvaient alors créer un contexte d’empilement au-dessus du marqueur. Le poste existait bien dans Leaflet, mais il était visuellement recouvert.

## Corrections

- création d’un pane Leaflet dédié `secabLandmarkPane` ;
- pane forcé au-dessus des tuiles, du cadastre, des réseaux et de l’implantation ;
- symbole principal, repère permanent du poste et 2e ouvrage placés dans ce pane ;
- restauration explicite de l’ordre standard des panes Leaflet ;
- styles de visibilité renforcés sur le conteneur, le SVG et le libellé ;
- glisser-déposer et clic sur la carte conservés.
