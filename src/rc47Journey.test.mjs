import assert from 'node:assert/strict';
import {buildAuthoritativeResult,assertClientExport} from './domain/reportIntegrity.js';
const base={terreConfig:'separee',mode:'edf',rm:10,rni:12,rmn:19,solutionRetenue:'none',reference:{id:'R1',title:'Guide',issuer:'EDF',index:'A',effectiveDate:'2026-01-01',territory:'Réunion',scope:'HTA/BT',location:'§4',validatedBy:'Responsable',validatedAt:'2026-07-31',status:'VALIDE'}};
const result=buildAuthoritativeResult(base); assert.equal(result.initial.ok,true); assert.equal(assertClientExport(result),true);
const work={...base,solutionRetenue:'piquet3',finalMeasurements:{rm:'10',rni:'12',rmn:'19'}}; const wr=buildAuthoritativeResult(work); assert.equal(wr.final.ok,true); assert.equal(wr.status,'RAPPORT APRÈS TRAVAUX');
const incomplete=buildAuthoritativeResult({...base,rm:''}); assert.throws(()=>assertClientExport(incomplete));
console.log('RC47 journey: OK');
