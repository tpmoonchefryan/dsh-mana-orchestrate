export const ACTIVATION_RECEIPT_SCHEMA_VERSION = 'tcrn.dsh-twp.activation-claim.v1' as const
export const ACTIVATION_REVIEW_WINDOW_DAYS = 30 as const

export type ActivationAction = 'enable' | 'disable' | 'uninstall'

export interface ActivationClaim {
  schemaVersion: typeof ACTIVATION_RECEIPT_SCHEMA_VERSION
  action: ActivationAction
  actor: string
  hostApprovalFace: 'absent'
  installationDoesNotProveActivation: true
  evidenceClass: 'executor_claim'
  recordedAt: string
  reviewBy: string
  externalCheckCommand: string
}

const ACTOR_PATTERN = /^(?:agent|owner|profile):[a-z0-9][a-z0-9._:-]{0,127}$/u

const addDays = (instant: string, days: number): string => {
  const time = Date.parse(instant)
  if (!Number.isFinite(time)) throw new Error('ACTIVATION_INSTANT_INVALID')
  return new Date(time + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/u, 'Z')
}

/** Build a local executor claim; chain writing is intentionally outside this module. */
export function buildActivationClaim(action: ActivationAction, actor: string, recordedAt: string, externalCheckCommand: string): ActivationClaim {
  if (!ACTOR_PATTERN.test(actor)) throw new Error('ACTIVATION_ACTOR_INVALID')
  if (externalCheckCommand.length === 0 || /[\u0000-\u001f\u007f]/u.test(externalCheckCommand)) throw new Error('ACTIVATION_CHECK_COMMAND_INVALID')
  return {
    schemaVersion: ACTIVATION_RECEIPT_SCHEMA_VERSION,
    action,
    actor,
    hostApprovalFace: 'absent',
    installationDoesNotProveActivation: true,
    evidenceClass: 'executor_claim',
    recordedAt,
    reviewBy: addDays(recordedAt, ACTIVATION_REVIEW_WINDOW_DAYS),
    externalCheckCommand,
  }
}

export function isActivationClaim(value: unknown): value is ActivationClaim {
  if (value === null || typeof value !== 'object') return false
  const claim = value as Partial<ActivationClaim>
  return claim.schemaVersion === ACTIVATION_RECEIPT_SCHEMA_VERSION &&
    (claim.action === 'enable' || claim.action === 'disable' || claim.action === 'uninstall') &&
    typeof claim.actor === 'string' && ACTOR_PATTERN.test(claim.actor) &&
    claim.hostApprovalFace === 'absent' &&
    claim.installationDoesNotProveActivation === true &&
    claim.evidenceClass === 'executor_claim' &&
    typeof claim.recordedAt === 'string' && typeof claim.reviewBy === 'string' &&
    typeof claim.externalCheckCommand === 'string'
}
