const finite=v=>Number.isFinite(Number(v));
export function repeatabilityAssessment(values=[], tolerancePercent=5){
  const nums=(Array.isArray(values)?values:[]).map(Number).filter(Number.isFinite).filter(v=>v>0);
  if(nums.length<2) return {status:'not-assessed',valid:false,count:nums.length,mean:nums[0]||NaN,spreadPercent:NaN,label:'Répétabilité non évaluée'};
  const mean=nums.reduce((a,b)=>a+b,0)/nums.length; const spread=(Math.max(...nums)-Math.min(...nums))/mean*100;
  return {status:spread<=tolerancePercent?'stable':'unstable',valid:spread<=tolerancePercent,count:nums.length,mean,spreadPercent:spread,label:spread<=tolerancePercent?'Série stable':'Série instable — mesure à reprendre'};
}
export function validateMeasurementProtocol(model={}){
  const p=model.protocol||{}; const issues=[]; const warnings=[];
  const checks=[['earthIsolated','Prise de terre isolée'],['noParasiticBond','Absence de liaison parasite contrôlée'],['auxiliariesPositioned','Auxiliaires correctement positionnés'],['interferenceChecked','Interférences évidentes contrôlées'],['connectionsPhotographed','Photo du branchement disponible']];
  for(const [key,label] of checks) if(p[key]!==true) issues.push(`${label} : confirmation requise.`);
  if(!String(p.method||'').trim()) issues.push('Méthode de mesure non renseignée.');
  if(model.mode==='direct'){
    if(p.directRcAuthorised!==true) issues.push('Mode Rc directe non autorisé pour ce dossier.');
    if(!String(p.directRcMethod||'').trim()) issues.push('Méthode d’obtention de Rc directe non renseignée.');
    if(!String(p.directRcReference||'').trim()) issues.push('Référence autorisant la mesure directe de Rc non renseignée.');
  }
  const reps=model.repeatedMeasurements||{};
  for(const key of ['rm', model.terreConfig==='interconnectee'?'rng':model.mode==='direct'?'rcDirect':'rni', ...(model.terreConfig==='separee'&&model.mode!=='direct'?['rmn']:[])]){
    const a=repeatabilityAssessment(reps[key]); if(a.count>0 && !a.valid) issues.push(`${key.toUpperCase()} : ${a.label} (${Number.isFinite(a.spreadPercent)?a.spreadPercent.toFixed(1):'—'} %).`); else if(a.count===0) warnings.push(`${key.toUpperCase()} : répétabilité non renseignée.`);
  }
  return {valid:issues.length===0,issues,warnings};
}
