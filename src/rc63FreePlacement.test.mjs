import fs from 'node:fs';
const source=fs.readFileSync(new URL('./main.jsx',import.meta.url),'utf8');
const checks=[
  ['pas de flyTo automatique',!source.includes('map.flyTo(')],
  ['pas d’autoPan actif',!source.includes('autoPan:true')],
  ['pas d’arrondi des offsets',!source.includes('Math.round(offsetX)')&&!source.includes('Math.round(offsetY)')],
  ['carte dédiée second ouvrage',source.includes('Affinage manuel du 2ᵉ ouvrage')],
  ['coordonnées neutre modifiées',source.includes("neutralGpsManual:true")],
  ['restauration GPS d’origine',source.includes('Revenir au GPS d’origine')],
  ['micro-ajustements 0,1 m',source.includes('← 0,1 m')&&source.includes('0,1 m →')]
];
const failed=checks.filter(([,ok])=>!ok);
for(const [label,ok] of checks)console.log(`${ok?'✓':'✗'} ${label}`);
if(failed.length)process.exit(1);
