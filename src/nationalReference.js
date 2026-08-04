export const NATIONAL_RULESET_VERSION='NR-1.0.0';

const finite=v=>String(v??'').trim()!==''&&Number.isFinite(Number(String(v).replace(',','.')));
const value=v=>Number(v);

export function readinessAssessment(record={},calculation={}){
  const blockers=[]; const warnings=[]; const strengths=[];
  if(!record.typeOuvrage) blockers.push('Identifier précisément le type d’ouvrage.');
  if(!record.terreConfig) blockers.push('Confirmer la configuration des terres.');
  if(record.terreConfig==='separee'){
    ['rm','rni','rmn'].forEach(k=>{if(!finite(record[k])) blockers.push(`Renseigner ${k.toUpperCase()}.`)});
  }else if(!finite(record.rng)) blockers.push('Renseigner RNg.');
  if(calculation?.issues?.length) blockers.push(...calculation.issues);
  if(!finite(record.resistivite)) warnings.push('Résistivité du sol non renseignée : la comparaison des solutions reste indicative.');
  if(!finite(record.gpsLat)||!finite(record.gpsLng)) warnings.push('Position GPS non confirmée.');
  if(Number(record.gpsAccuracy||0)>15) warnings.push('Précision GPS supérieure à 15 m.');
  const photoCount=Object.values(record.measurePhotos||{}).filter(Boolean).length;
  if(photoCount<3) warnings.push('Jeu photographique initial incomplet.'); else strengths.push('Mesures documentées par photographies.');
  if(record.referenceValidated) strengths.push('Référence technique validée dans le dossier.');
  if(record.solutionRetenue) strengths.push('Décision technique enregistrée et traçable.');
  const status=blockers.length?'blocked':warnings.length?'review':'ready';
  return {status,blockers:[...new Set(blockers)],warnings:[...new Set(warnings)],strengths:[...new Set(strengths)],canRecommend:!blockers.length};
}

export function plainLanguageExplanation(record={},calculation={}){
  if(!Number.isFinite(calculation?.c) && record.terreConfig!=='interconnectee') return 'Les mesures disponibles ne permettent pas encore de calculer l’influence entre les prises de terre. Le logiciel bloque volontairement la recommandation jusqu’à obtention d’un jeu de mesures cohérent.';
  if(calculation?.ok) return 'Les mesures enregistrées respectent le critère configuré : aucune correction automatique n’est nécessaire. Le résultat reste lié aux valeurs relevées et doit être conservé avec les preuves de mesure.';
  if(record.terreConfig==='interconnectee') return 'La résistance globale du neutre dépasse l’objectif configuré. Une amélioration de la prise de terre est étudiée afin de faciliter la dispersion du courant dans le sol.';
  return 'L’influence électrique entre la terre des masses et la terre du neutre est trop importante. La solution recherchée doit réduire cette influence, puis être confirmée par une nouvelle série de mesures après travaux.';
}

export function expertExplanation(record={},calculation={},solution=null){
  const target=record.terreConfig==='interconnectee'?`RNg ≤ ${calculation?.target??'—'} Ω`:'c = Rc / RM ≤ 0,15';
  const chosen=solution?.title||'Aucune solution technique validée';
  return {
    basis:`Décision fondée sur les mesures enregistrées, le critère ${target}, la cohérence physique du jeu de mesures et les contraintes d’implantation renseignées.`,
    choice:`${chosen} est retenue uniquement si elle satisfait le critère simulé, reste réalisable sur l’emprise disponible et présente le meilleur compromis selon la grille multicritère active.`,
    limits:'La simulation ne constitue pas une garantie de résultat : la résistivité réelle, l’humidité, la géologie, la profondeur de pose et les réseaux enterrés peuvent modifier la valeur obtenue.',
    verification:'Après travaux, reprendre les mesures dans les mêmes conditions, joindre les photographies, vérifier les connexions et recalculer le critère avant clôture du dossier.'
  };
}

export function executiveSnapshot(record={},calculation={},finalCalculation={}){
  const initial=record.terreConfig==='interconnectee'?calculation?.rng:calculation?.c;
  const final=record.terreConfig==='interconnectee'?finalCalculation?.rng:finalCalculation?.c;
  return {
    status:finalCalculation?.ok?'confirmed':calculation?.ok?'initially-compliant':'action-required',
    initial:Number.isFinite(initial)?initial:null,
    final:Number.isFinite(final)?final:null,
    target:record.terreConfig==='interconnectee'?calculation?.target:0.15,
    nextAction:finalCalculation?.ok?'Clôturer après vérification documentaire.':calculation?.ok?'Conserver les preuves et clôturer sans travaux.':'Réaliser la solution retenue puis effectuer les mesures finales.'
  };
}

export function referenceCitation(reference={}){
  const parts=[reference.issuer,reference.title,reference.id&&`réf. ${reference.id}`,reference.index&&`indice ${reference.index}`,reference.effectiveDate&&`du ${reference.effectiveDate}`,reference.location].filter(Boolean);
  return parts.join(' · ');
}
