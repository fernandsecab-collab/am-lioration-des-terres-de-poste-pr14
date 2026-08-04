import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
const quality = source.match(/function qualityAssessment\(m\)\{([\s\S]*?)\n\}/)?.[1] || '';
const finalization = source.match(/function finalizationGate\(m\)\{([\s\S]*?)\n\}/)?.[1] || '';

assert.ok(quality.includes('const initial=compute(m)'), 'qualityAssessment doit calculer initial');
assert.ok(!/\bc\.ok\b/.test(quality), 'qualityAssessment ne doit pas utiliser c.ok sans déclaration');
assert.ok(!/\bc\.c\b/.test(quality), 'qualityAssessment ne doit pas utiliser c.c sans déclaration');
assert.ok(quality.includes('initial.ok'), 'Le statut du rapport doit utiliser initial.ok');
assert.ok(quality.includes('initial.c'), 'Les anomalies doivent utiliser initial.c');

assert.ok(finalization.includes('const initial=compute(m)'), 'finalizationGate doit calculer initial');
assert.ok(!/\bc\.rm\b/.test(finalization), 'finalizationGate ne doit pas utiliser c.rm sans déclaration');
assert.ok(!/initial\.rn\b/.test(finalization), 'initial.rn est une propriété inexistante');
assert.ok(finalization.includes("initial.mode==='interconnectee'"), 'Le contrôle doit distinguer les terres interconnectées');
assert.ok(finalization.includes('initial.rni'), 'Le contrôle séparé doit vérifier RNi');
assert.ok(finalization.includes('initial.rmn'), 'Le mode indirect doit vérifier RMN');

console.log('RC10 runtime regression: qualityAssessment et finalizationGate OK');
