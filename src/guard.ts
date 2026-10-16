/** M4 control-tree guard model. This module has no engine or filesystem access. */
export const GUARDED_TREE_NAMES = [['.tcrn', 'workspace'].join('-'), ['.tcrn', 'workflow'].join('-')] as const
export const GUARDED_WRITE_TOOLS = [
  'write',
  'edit',
  'str_replace_editor',
  'file_write',
  'fs.write',
  'bash',
  'bash-persistent',
  'pwsh',
  'cordis_run',
  'run_code',
] as const
export const M4_GUARD_DENIAL_REASON = 'TCRN_CONTROL_TREE_WRITE_DENIED'

type UnknownRecord = Record<string, unknown>

const containsGuardedTree = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (typeof value === 'string') {
    const normalized = value.replaceAll('\\', '/')
    return GUARDED_TREE_NAMES.some(name => {
      const escaped = name.replace(/[.*+?^${}()|[\[\]\\]/gu, '\\$&')
      return new RegExp(`(?:^|[\\s/"'])${escaped}(?=$|[\\s/"'])`, 'u').test(normalized)
    })
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(item => containsGuardedTree(item, seen))
  return Object.values(value as UnknownRecord).some(item => containsGuardedTree(item, seen))
}

export interface GuardExecutionLike {
  name?: unknown
  arguments?: unknown
}

/** Return a stable denial reason for a write-like tool targeting a guarded tree. */
export function controlTreeGuardReason(execution: GuardExecutionLike): string | undefined {
  if (typeof execution.name !== 'string') return undefined
  if (!(GUARDED_WRITE_TOOLS as readonly string[]).includes(execution.name)) return undefined
  return containsGuardedTree(execution.arguments) ? M4_GUARD_DENIAL_REASON : undefined
}

export function shouldDenyControlTreeWrite(execution: GuardExecutionLike): boolean {
  return controlTreeGuardReason(execution) !== undefined
}
