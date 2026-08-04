# Import GitHub RC52

1. Décompressez complètement le ZIP sur votre ordinateur.
2. Ouvrez le dossier décompressé : `package.json`, `src`, `electron`, `public` et `.github` doivent être visibles ensemble.
3. Dans GitHub, utilisez **Add file > Upload files** et déposez le contenu de ce dossier, pas le ZIP fermé et pas uniquement le dossier `.github`.
4. Vérifiez dans la page principale du dépôt que `package.json` est visible.
5. Ouvrez **Actions > Windows Electron Build > Run workflow**.

Le workflow RC52 sait aussi corriger automatiquement un seul dossier parent ajouté par erreur. En revanche, il ne peut pas reconstruire un dépôt dans lequel seuls les fichiers du workflow ont été importés.
