import assert from 'node:assert/strict';
import {extractImportedRecords,safeJsonParse,sanitizeText,validateRecordShape} from './rc21Safety.js';
assert.equal(sanitizeText('abc\u0000def'),'abcdef');
assert.throws(()=>safeJsonParse('null'));
assert.equal(validateRecordShape({uuid:'u1'}).ok,true);
assert.equal(validateRecordShape({}).ok,false);
assert.equal(extractImportedRecords({type:'SECAB_BACKUP',records:[{uuid:'u1'}]}).length,1);
assert.throws(()=>extractImportedRecords({type:'SECAB_BACKUP',records:[]}));
console.log('RC21 safety tests OK');
