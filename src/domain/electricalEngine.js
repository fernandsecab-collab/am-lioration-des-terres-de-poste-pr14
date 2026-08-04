import { DEFAULT_RULESET, ELECTRICAL_EPSILON, resolveRuleContext } from './electricalRules.js';
import { validateMeasurementProtocol } from './measurementProtocol.js';

export const parseElectricalNumber = value => {
  const raw = String(value ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!raw) return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
};
const stable = (value, digits = 6) => Number.isFinite(value) ? Number(value.toFixed(digits)) : NaN;
export const atMost = (value, limit) => Number.isFinite(value) && Number.isFinite(limit) && value <= limit + ELECTRICAL_EPSILON;

export function computeElectricalCase(model = {}, ruleset = DEFAULT_RULESET) {
  const mode = model.terreConfig === 'interconnectee' ? 'interconnectee' : 'separee';
  const calculationMode = model.mode === 'direct' ? 'direct' : 'edf';
  const rules = resolveRuleContext(model, ruleset);
  const rm = stable(parseElectricalNumber(model.rm));
  const rng = stable(parseElectricalNumber(model.rng));
  const rni = stable(parseElectricalNumber(model.rni));
  const rmn = stable(parseElectricalNumber(model.rmn));
  const rcDirect = stable(parseElectricalNumber(model.rcDirect));
  const issues = [];
  const warnings = [];
  const protocol = validateMeasurementProtocol(model);

  if (mode === 'interconnectee') {
    if (!rules.knownRegime) issues.push('Régime inconnu ou non renseigné : aucune cible RNg ne peut être sélectionnée.');
    if (!Number.isFinite(rng)) issues.push('RNg doit être renseignée.');
    else if (rng <= 0) issues.push('RNg doit être strictement positive.');
    if (Number.isFinite(rm) && rm <= 0) issues.push('RM doit être strictement positive.');
    const valid = issues.length === 0;
    const ok = valid && atMost(rng, rules.interconnectedLimit);
    return {
      rm, rng, rni, rmn, rc: NaN, c: NaN,
      target: rules.interconnectedLimit, ok, valid,
      status: !valid ? 'invalid' : ok ? 'compliant' : 'non-compliant',
      mode, calculationMode, issues, warnings, rules, protocol, protocol,
      diagnostic: !valid ? 'Mesures ou règle applicables incomplètes : aucune conclusion technique ne peut être émise.'
        : ok ? 'Prise de terre globale conforme à la cible configurée.' : 'Prise de terre globale à améliorer.',
      initial: rng
    };
  }

  if (!Number.isFinite(rm)) issues.push('RM doit être renseignée.');
  else if (rm <= 0) issues.push('RM doit être strictement positive.');
  if (!Number.isFinite(rules.couplingLimit)) issues.push('Seuil de couplage non configuré.');

  if (calculationMode === 'edf') {
    if (!Number.isFinite(rni)) issues.push('RNi doit être renseignée.'); else if (rni <= 0) issues.push('RNi doit être strictement positive.');
    if (!Number.isFinite(rmn)) issues.push('RMN doit être renseignée.'); else if (rmn <= 0) issues.push('RMN doit être strictement positive.');
    if (Number.isFinite(rm) && Number.isFinite(rni) && Number.isFinite(rmn)) {
      if (rmn > rm + rni + ELECTRICAL_EPSILON) issues.push('Incohérence physique : RMN ne peut pas dépasser RM + RNi.');
      if (rmn + ELECTRICAL_EPSILON < Math.abs(rm - rni)) issues.push('Incohérence physique : RMN doit être supérieure ou égale à |RM − RNi|.');
    }
  } else {
    if (!protocol.valid) issues.push(...protocol.issues);
    if (!Number.isFinite(rcDirect)) issues.push('Rc directe doit être renseignée.');
    else if (rcDirect < 0) issues.push('Rc directe ne peut pas être négative.');
  }

  warnings.push(...protocol.warnings);
  if (Number.isFinite(rni) && Number.isFinite(rng) && rni <= rng) warnings.push('RNi ≤ RNg : vérifier la configuration réseau et le protocole, sans invalider automatiquement la mesure.');
  const rc = stable(calculationMode === 'direct' ? rcDirect :
    (Number.isFinite(rm) && Number.isFinite(rni) && Number.isFinite(rmn) ? (rm + rni - rmn) / 2 : NaN));
  if (Number.isFinite(rc) && rc < -ELECTRICAL_EPSILON) issues.push('Rc calculée négative : reprendre les trois mesures.');
  if (Number.isFinite(rc) && Number.isFinite(rm) && rc > rm + ELECTRICAL_EPSILON) issues.push('Rc calculée supérieure à RM : série de mesures incohérente.');
  const c = stable(Number.isFinite(rm) && rm > 0 && Number.isFinite(rc) ? rc / rm : NaN);
  if (Number.isFinite(c) && (c < -ELECTRICAL_EPSILON || c > 1 + ELECTRICAL_EPSILON)) issues.push('Coefficient hors domaine physique [0 ; 1] : reprendre les mesures.');
  const valid = issues.length === 0 && Number.isFinite(c);
  const ok = valid && atMost(c, rules.couplingLimit);
  return {
    rm, rng, rni, rmn, rc, c, target: rules.couplingLimit, ok, valid,
    status: !valid ? 'invalid' : ok ? 'compliant' : 'non-compliant',
    mode, calculationMode, issues, warnings, rules, protocol,
    diagnostic: !valid ? 'Mesures invalides ou incomplètes : aucune conclusion technique ne peut être émise.'
      : ok ? 'Couplage conforme à la cible configurée.' : 'Couplage non conforme à la cible configurée.',
    initial: rm
  };
}

export function classifyMeasuredEvolution(kind, initialValue, finalValue, target = NaN) {
  if (!Number.isFinite(finalValue)) return { key: 'not-measured', label: 'À mesurer' };
  if (kind === 'rm' || kind === 'rng' || kind === 'coefficient' || kind === 'rc') {
    if (Number.isFinite(target)) return atMost(finalValue, target)
      ? { key: 'criterion-met', label: 'Critère satisfait' }
      : { key: 'criterion-not-met', label: 'Critère non satisfait' };
    return Number.isFinite(initialValue) && finalValue < initialValue
      ? { key: 'favourable', label: 'Évolution favorable — conformité non démontrée' }
      : { key: 'information', label: 'Information — cible non définie' };
  }
  if (kind === 'rmn' || kind === 'rni') return { key: 'isolated-information', label: 'Information — non interprétable isolément' };
  return { key: 'information', label: 'Information' };
}
