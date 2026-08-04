import assert from 'node:assert/strict';
import {weightedScore,validateReference,daoQuantities,DEFAULT_WEIGHTS} from './rcGovernance.js';
assert.equal(weightedScore({technical:100,margin:100,cost:100,duration:100,impact:100,maintainability:100,evidence:100},DEFAULT_WEIGHTS),100);
assert.equal(weightedScore({technical:0,margin:0,cost:0,duration:0,impact:0,maintainability:0,evidence:0},DEFAULT_WEIGHTS),0);
assert.equal(validateReference({title:'x',issuer:'y',index:'1',effectiveDate:'2026-01-01',scope:'s',location:'p'}).ok,true);
assert.equal(validateReference({title:'x'}).ok,false);
assert.deepEqual(daoQuantities({implantation:{annotations:[{type:'trench',surface:'earth',lengthM:12},{type:'line',surface:'asphalt',lengthM:4,widthM:.6},{type:'stake'}]}}),{trenchEarth:12,trenchAsphalt:4,trenchConcrete:0,asphaltM2:2.4,conductor:16,stakes:1});
console.log('RC governance tests: OK');
