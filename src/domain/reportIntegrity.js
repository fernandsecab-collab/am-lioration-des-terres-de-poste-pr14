import { computeElectricalCase } from './electricalEngine.js';
import { validateReferenceRecord } from './referenceRegistry.js';
export function buildAuthoritativeResult(record={}, ruleset){
  const initial=computeElectricalCase(record,ruleset); const finalRecord={...record,...(record.finalMeasurements||{})}; const final=computeElectricalCase(finalRecord,ruleset);
  const reference=validateReferenceRecord(record.reference||{});
  const selected=String(record.solutionRetenue||record.solutionId||'').trim();
  const status=!initial.valid?'DOSSIER INCOMPLET':!reference.valid?'EN ATTENTE DE VALIDATION':selected&&final.valid&&final.ok?'RAPPORT APRÈS TRAVAUX':selected?'EN ATTENTE DE VALIDATION':'BROUILLON';
  return Object.freeze({initial,final,reference,selected,status,version:'RC47',generatedAt:new Date().toISOString()});
}
export function assertClientExport(result){const issues=[];if(!result.initial.valid)issues.push(...result.initial.issues);if(!result.reference.valid)issues.push(...result.reference.issues);if(result.selected&&!result.final.valid)issues.push('Mesures finales complètes et cohérentes requises.');if(issues.length)throw new Error(`Émission client bloquée : ${issues.join(' | ')}`);return true;}
