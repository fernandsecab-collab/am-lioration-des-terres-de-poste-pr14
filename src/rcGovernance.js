export const DEFAULT_WEIGHTS={technical:35,margin:15,cost:15,duration:10,impact:10,maintainability:10,evidence:5};
export const DEFAULT_ROLES={
  technicien:{label:'Technicien terrain',permissions:['measure','photo','gps','execute','final_measure']},
  chef:{label:'Chef d’équipe',permissions:['measure','photo','gps','execute','final_measure','review_execution']},
  conducteur:{label:'Conducteur de travaux',permissions:['review','approve_solution','edit_quantities','approve_execution']},
  charge_affaires:{label:'Chargé d’affaires',permissions:['review','approve_solution','edit_costs','export_priced_report']},
  responsable:{label:'Responsable de service',permissions:['review','approve_solution','edit_costs','export_priced_report','unlock','approve_report']},
  administrateur:{label:'Administrateur',permissions:['all']},
  lecture:{label:'Lecture seule',permissions:['read']}
};
export const DEFAULT_REFERENCES=[
 {id:'B13-23',title:'Mémento de réalisation des prises de terre',issuer:'EDF SEI / Enedis',index:'À renseigner',effectiveDate:'',scope:'Prises de terre des ouvrages HTA/BT',location:'Page ou paragraphe à renseigner',status:'draft'},
 {id:'SECAB-RC-2.0',title:'Règles de calcul — Mesure & amélioration des terres de poste de transformation',issuer:'SECAB',index:'RC 2.0',effectiveDate:new Date().toISOString().slice(0,10),scope:'Contrôles de cohérence, calculs et classement multicritère',location:'Référentiel interne versionné',status:'active'}
];
export function loadGovernance(){
 try{return JSON.parse(localStorage.getItem('secab-governance-rc')||'null')||{weights:DEFAULT_WEIGHTS,roles:DEFAULT_ROLES,references:DEFAULT_REFERENCES,currentRole:'responsable',rulesVersion:'RC-2.0.0'}}catch{return {weights:DEFAULT_WEIGHTS,roles:DEFAULT_ROLES,references:DEFAULT_REFERENCES,currentRole:'responsable',rulesVersion:'RC-2.0.0'}}
}
export function saveGovernance(v){localStorage.setItem('secab-governance-rc',JSON.stringify(v));return v}
export function weightedScore(notes,weights=DEFAULT_WEIGHTS){
 const keys=Object.keys(DEFAULT_WEIGHTS), total=keys.reduce((a,k)=>a+Math.max(0,Number(weights[k]||0)),0)||1;
 return Math.round(keys.reduce((a,k)=>a+Math.max(0,Math.min(100,Number(notes[k]||0)))*Math.max(0,Number(weights[k]||0)),0)/total);
}
export function chainAudit(entries=[]){
 let previous='GENESIS';return entries.map((entry,index)=>{const payload=JSON.stringify({index,previous,date:entry.date||entry.at||'',actor:entry.actor||'',action:entry.action||'',details:entry.details||entry.detail||''});let h=2166136261;for(let i=0;i<payload.length;i++){h^=payload.charCodeAt(i);h=Math.imul(h,16777619)}const hash=(h>>>0).toString(16).padStart(8,'0');previous=hash;return {...entry,previousHash:index?entries[index-1]?.hash||'LEGACY':'GENESIS',hash}})}
export function frozenRevision(record,reason='Validation du rapport'){
 const now=new Date().toISOString(), revisions=Array.isArray(record.revisions)?record.revisions:[];
 const revision={number:revisions.length+1,createdAt:now,reason,snapshot:JSON.parse(JSON.stringify({...record,revisions:undefined}))};
 return {...record,revisions:[...revisions,revision],validation:{...(record.validation||{}),locked:true,lockedAt:now},updatedAt:now};
}
export function photoEvidence(photo={},record={}){return {photoId:photo.photoId||photo.name||crypto?.randomUUID?.()||String(Date.now()),capturedAt:photo.capturedAt||photo.lastModified||'',author:photo.author||record.technicien||'',gpsLat:photo.gpsLat||record.gpsLat||'',gpsLng:photo.gpsLng||record.gpsLng||'',gpsAccuracy:photo.gpsAccuracy||record.gpsAccuracy||'',original:Boolean(photo.originalData||photo.originalSize),sourceAffaire:record.uuid||record.id||'',mime:photo.type||'',size:photo.originalSize||photo.size||0}}
export function validateReference(ref){const fields=['title','issuer','index','effectiveDate','scope','location'];const placeholder=/^(à renseigner|a renseigner|manquant|inconnu|page ou paragraphe à renseigner)$/i;const missing=fields.filter(k=>{const value=String(ref?.[k]||'').trim();return !value||placeholder.test(value)});if(String(ref?.status||'').toLowerCase()==='draft')missing.push('status');return {ok:missing.length===0,missing:[...new Set(missing)]}}
export function daoQuantities(record={}){
 const annotations=Array.isArray(record.implantation?.annotations)?record.implantation.annotations:[];
 const out={trenchEarth:0,trenchAsphalt:0,trenchConcrete:0,asphaltM2:0,conductor:0,stakes:0};
 annotations.forEach(a=>{const len=Number(a.lengthM||a.measuredLengthM||0);if(a.surface==='earth')out.trenchEarth+=len;if(a.surface==='asphalt')out.trenchAsphalt+=len;if(a.surface==='concrete')out.trenchConcrete+=len;if(a.surface==='asphalt')out.asphaltM2+=len*Number(a.widthM||0.5);if(['cable','conductor','trench','line','polyline'].includes(a.type))out.conductor+=len;if(a.type==='stake'||a.symbol==='piquet')out.stakes+=1});
 const smart=record.implantation?.smartDesign||{};if(!out.conductor)out.conductor=Number(smart.actualLengthM||smart.lengthM||0);if(!out.stakes)out.stakes=Number(smart.piquets||0);return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,Math.round(v*100)/100]));
}
