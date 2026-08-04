const number = value => Number.isFinite(Number(value)) ? Number(value) : NaN;
export const FEASIBILITY_CRITERIA = Object.freeze(['accessibility','footprint','civilWorks','cost','delay','authorisations','maintainability','compatibility','evidence']);

export function scoreSolutionFeasibility(solution = {}, context = {}) {
  const blockers = [];
  if (context.referenceRequired && !context.referenceValidated) blockers.push('Référentiel ou prescription ouvrage non validé.');
  if (solution.requiresPublicDomainApproval && !context.publicDomainApproval) blockers.push('Autorisation du domaine public absente.');
  if (solution.requiresSpace && context.availableSpace === false) blockers.push('Emprise insuffisante.');
  const ratings = FEASIBILITY_CRITERIA.map(key => {
    const value = number(solution?.feasibility?.[key]);
    return Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 2.5;
  });
  const score = Math.round((ratings.reduce((a,b)=>a+b,0) / (ratings.length * 5)) * 100);
  return {
    feasible: blockers.length === 0,
    blockers,
    score,
    meaning: 'Score de faisabilité uniquement. Il ne prédit aucune résistance ni conformité électrique future.',
    performance: 'À confirmer exclusivement par les mesures après travaux.'
  };
}
