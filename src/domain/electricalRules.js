export const ELECTRICAL_RULESET_VERSION = 'SECAB-RC47-2026.07';
export const ELECTRICAL_EPSILON = 1e-9;

export const DEFAULT_RULESET = Object.freeze({
  id: 'SECAB_REUNION_PILOT',
  status: 'A_VALIDER',
  document: Object.freeze({ id:'A_RENSEIGNER', title:'Référentiel technique applicable', index:'', effectiveDate:'', territory:'La Réunion', scope:'Prises de terre HTA/BT', location:'', validatedBy:'', validatedAt:'' }),
  territory: 'La Réunion',
  coupling: Object.freeze({ limit: 0.15, unit: 'ratio', sourceRequired: true }),
  interconnected: Object.freeze({
    '150 A': Object.freeze({ limit: 2.5, unit: 'ohm', sourceRequired: true }),
    '300 A': Object.freeze({ limit: 2.5, unit: 'ohm', sourceRequired: true }),
    '1000 A': Object.freeze({ limit: 1, unit: 'ohm', sourceRequired: true })
  })
});

export function resolveRuleContext(input = {}, ruleset = DEFAULT_RULESET) {
  const regime = String(input.regime || '').trim();
  const couplingLimit = Number(ruleset?.coupling?.limit);
  const interconnectedRule = ruleset?.interconnected?.[regime] || null;
  return {
    rulesetId: ruleset?.id || 'NON_RENSEIGNE',
    rulesetStatus: ruleset?.status || 'A_VALIDER',
    regime,
    couplingLimit: Number.isFinite(couplingLimit) ? couplingLimit : NaN,
    interconnectedLimit: interconnectedRule && Number.isFinite(Number(interconnectedRule.limit))
      ? Number(interconnectedRule.limit) : NaN,
    knownRegime: Boolean(interconnectedRule),
    officiallyValidated: ruleset?.status === 'VALIDE'
  };
}
