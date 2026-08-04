export const REFERENCE_STATUS = Object.freeze({ DRAFT:'BROUILLON', VALIDATED:'VALIDE', REPLACED:'REMPLACE' });

export function normalizeReference(ref={}){
  return {
    id:String(ref.id||'').trim(), title:String(ref.title||'').trim(), issuer:String(ref.issuer||'').trim(),
    index:String(ref.index||'').trim(), effectiveDate:String(ref.effectiveDate||'').trim(), territory:String(ref.territory||'').trim(),
    scope:String(ref.scope||'').trim(), location:String(ref.location||'').trim(), validatedBy:String(ref.validatedBy||'').trim(),
    validatedAt:String(ref.validatedAt||'').trim(), status:String(ref.status||REFERENCE_STATUS.DRAFT).toUpperCase()
  };
}
export function validateReferenceRecord(ref={}){
  const r=normalizeReference(ref); const issues=[];
  for(const [key,label] of [['id','Identifiant'],['title','Titre'],['issuer','Émetteur'],['index','Indice'],['effectiveDate','Date d’effet'],['territory','Territoire'],['scope','Domaine'],['location','Page/paragraphe'],['validatedBy','Validateur'],['validatedAt','Date de validation']]) if(!r[key]) issues.push(`${label} manquant.`);
  if(r.status!==REFERENCE_STATUS.VALIDATED) issues.push('Référentiel non validé ou remplacé.');
  return {record:r,valid:issues.length===0,issues};
}
export function referenceLabel(ref={}){ const {record:r,valid}=validateReferenceRecord(ref); return valid?`${r.issuer} — ${r.title} — ${r.id} — indice ${r.index} — ${r.location}`:'Référentiel à valider'; }
