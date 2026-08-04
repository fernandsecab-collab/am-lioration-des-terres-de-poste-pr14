export const PRODUCTION_CORE_VERSION='PC-1.1.0-RC4';

export async function sha256Hex(value){
  const data=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export function permissionFor(role,permission,roles={}){
  const grants=roles?.[role]?.permissions||[];
  return grants.includes('all')||grants.includes(permission);
}

export function validateOfficialReference(ref={}){
  const required=['id','title','issuer','index','effectiveDate','scope','location','status'];
  const missing=required.filter(k=>!String(ref[k]??'').trim());
  const placeholders=['à renseigner','a renseigner','n/a','inconnu','brouillon'];
  const placeholderFields=required.filter(k=>placeholders.includes(String(ref[k]??'').trim().toLowerCase()));
  const dateValid=/^\d{4}-\d{2}-\d{2}$/.test(String(ref.effectiveDate||''));
  const active=ref.status==='active';
  return {ok:missing.length===0&&placeholderFields.length===0&&dateValid&&active,missing,placeholderFields,dateValid,active};
}

export function referenceCoverage(references=[]){
  const checked=references.map(r=>({...validateOfficialReference(r),id:r.id,title:r.title}));
  return {total:checked.length,valid:checked.filter(x=>x.ok).length,invalid:checked.filter(x=>!x.ok),ready:checked.length>0&&checked.every(x=>x.ok)};
}

export function buildRevision(record={},actor='Utilisateur',reason='Validation'){
  const now=new Date().toISOString();
  const previous=Array.isArray(record.revisions)?record.revisions:[];
  const snapshot=JSON.parse(JSON.stringify({...record,revisions:undefined,audit:undefined}));
  return {number:previous.length+1,createdAt:now,actor,reason,snapshot,immutable:true};
}

export function buildCaseCatalogue(){
  const thresholds=[0,0.1499,0.15,0.1501,1];
  const decimalModes=['point','virgule'];
  const ouvrages=['poste-sol','h61','emergence-bt','terre-separee','terre-interconnectee'];
  const outcomes=['conforme','travaux','impossible','insuffisant','controle-final'];
  const cases=[];
  let n=1;
  for(const threshold of thresholds) for(const decimalMode of decimalModes) for(const ouvrage of ouvrages){
    cases.push({id:`NR-${String(n++).padStart(3,'0')}`,threshold,decimalMode,ouvrage,expected:threshold<=0.15?'admissible':'non-admissible'});
  }
  for(const outcome of outcomes) cases.push({id:`NR-${String(n++).padStart(3,'0')}`,outcome,expected:outcome});
  return cases;
}

export function testCatalogue(){
  const cases=buildCaseCatalogue();
  return {
    common:['seuil exactement égal à 0,15','virgule et point décimal','valeurs nulles et négatives','mesures physiquement incohérentes','rapport avec et sans prix','photos et carte absentes'],
    ouvrages:['poste au sol','H61','émergence BT','terre séparée','terre interconnectée'],
    decisions:['aucun travaux','solution retenue','solution impossible','données insuffisantes','contrôle final conforme','contrôle final non conforme'],
    cases,total:cases.length
  };
}

export function canIssueOfficialReport({references=[],record={},requiredPhotos=[]}={}){
  const refs=referenceCoverage(references);
  const missingData=['uuid','site','measurements'].filter(k=>!record?.[k]);
  const missingPhotos=requiredPhotos.filter(k=>!record?.[k]);
  const blockers=[];
  if(!refs.ready) blockers.push('Référentiel officiel incomplet');
  if(missingData.length) blockers.push(`Données obligatoires manquantes : ${missingData.join(', ')}`);
  if(missingPhotos.length) blockers.push(`Photos obligatoires manquantes : ${missingPhotos.join(', ')}`);
  return {ok:blockers.length===0,blockers,missingData,missingPhotos,referenceCoverage:refs};
}

export function productionReadiness({references=[],hasDatabase=false,hasAuth=false,hasSignedInstaller=false,pdfValidated=false,caseCount=0}={}){
  const refs=referenceCoverage(references);
  const checks=[
    {id:'references',label:'Référentiel officiel complet',ok:refs.ready,detail:refs.ready?`${refs.valid} référence(s) valide(s)`:`${refs.invalid.length} référence(s) à compléter`},
    {id:'database',label:'Base locale transactionnelle',ok:hasDatabase,detail:hasDatabase?'Écriture atomique, révisions et SHA-256 activés':'Mode local historique encore utilisé'},
    {id:'auth',label:'Comptes et rôles sécurisés',ok:hasAuth,detail:hasAuth?'Identités nominatives activées':'Profils encore locaux'},
    {id:'pdf',label:'PDF maître validé',ok:pdfValidated,detail:pdfValidated?'Gabarit de référence approuvé':'Recette PDF multi-postes à réaliser'},
    {id:'tests',label:'Cas métier de non-régression',ok:caseCount>=50,detail:`${caseCount}/50 cas disponibles`},
    {id:'installer',label:'Installeur Windows signé',ok:hasSignedInstaller,detail:hasSignedInstaller?'Signature contrôlée':'Signature et poste vierge à valider'}
  ];
  const score=Math.round(checks.filter(x=>x.ok).length/checks.length*100);
  return {score,level:score===100?'Diffusion nationale':score>=67?'Pilote encadré':'Préparation',checks,referenceCoverage:refs};
}
