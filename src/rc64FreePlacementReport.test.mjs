import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('./main.jsx',import.meta.url),'utf8');
assert.ok(source.includes('solutionShape(solution.id,angle,scale,0,0)'), 'La géométrie ne doit plus réappliquer les offsets.');
assert.ok(source.includes('const connectionTarget=[lng,lat]'), 'Le raccordement doit viser le centre exact choisi.');
assert.ok(source.includes('const reportM=m;'), 'Le rapport ne doit plus recentrer une implantation enregistrée.');
assert.ok(source.includes('fromSavedPlacement:true'), 'Le rapport doit reprendre la géométrie sauvegardée.');
assert.ok(source.includes('centerLat:hasCenter?String(current.centerLat)'), 'La position choisie doit être conservée lors du déplacement de l’ouvrage.');
console.log('RC64 placement libre et cohérence rapport : OK');
