import assert from 'node:assert/strict';
import {readinessAssessment,plainLanguageExplanation,expertExplanation,executiveSnapshot,referenceCitation} from './nationalReference.js';

const good={typeOuvrage:'Poste HTA/BT au sol',terreConfig:'separee',rm:'10',rni:'30',rmn:'35',resistivite:'100',gpsLat:'-20.9',gpsLng:'55.5',gpsAccuracy:'5',measurePhotos:{a:{},b:{},c:{}},solutionRetenue:'patte'};
assert.equal(readinessAssessment(good,{issues:[]}).status,'ready');
assert.equal(readinessAssessment({...good,rm:''},{issues:[]}).status,'blocked');
assert.match(plainLanguageExplanation(good,{c:0.3,ok:false}),/influence électrique/i);
assert.match(expertExplanation(good,{target:.15},{title:'Patte d’oie'}).choice,/Patte d’oie/);
assert.equal(executiveSnapshot(good,{c:.3,ok:false},{c:.1,ok:true}).status,'confirmed');
assert.match(referenceCitation({issuer:'EDF',title:'Mémento',id:'B13-23',index:'2'}),/B13-23/);
console.log('nationalReference tests: OK');
