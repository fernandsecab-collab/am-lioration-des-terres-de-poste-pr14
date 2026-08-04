# RC49 — Correction du build GitHub Actions

## Correctif principal

Le composant `Measures` contenait deux blocs JSX successifs dans une expression conditionnelle sans fragment parent. Vite/Esbuild arrêtait la compilation avec :

```text
Expected "}" but found "{"
```

Le sélecteur du mode de mesure et l'avertissement du mode `Rc directe` sont maintenant regroupés dans un fragment React valide.

## Contrôles

- syntaxe JSX validée par le build Vite ;
- tests automatisés du dépôt exécutés ;
- version harmonisée en `2.0.0-RC49`.
