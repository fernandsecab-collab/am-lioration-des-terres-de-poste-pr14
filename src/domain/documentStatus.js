export const DOCUMENT_STATUSES = Object.freeze({
  DRAFT: 'BROUILLON', INCOMPLETE: 'DOSSIER INCOMPLET', PENDING: 'EN ATTENTE DE VALIDATION',
  APPROVED: 'VALIDÉ POUR ÉMISSION', AFTER_WORKS: 'RAPPORT APRÈS TRAVAUX', SUPERSEDED: 'ANNULÉ / REMPLACÉ'
});
export function resolveDocumentStatus({ready=false, approved=false, afterWorks=false, superseded=false}={}) {
  if (superseded) return DOCUMENT_STATUSES.SUPERSEDED;
  if (!ready) return DOCUMENT_STATUSES.INCOMPLETE;
  if (!approved) return DOCUMENT_STATUSES.PENDING;
  return afterWorks ? DOCUMENT_STATUSES.AFTER_WORKS : DOCUMENT_STATUSES.APPROVED;
}
