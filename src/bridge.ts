/**
 * Bridge de-duplication. When the hooks-claude-code bridge already runs the Einzbern hook for an
 * event (its hooks JSON has an `engine/hook.mjs <word>` command under that event), this plugin
 * stays out of that event so the context is not injected twice.
 *
 * Which config file: `Config.bridgeConfigPath` when set; otherwise the `configPath` of every live
 * hooks-claude-code fiber in the cordis registry (`ctx.registry.values()` → runtime.fibers →
 * fiber.config). Detection never throws; an unreadable file counts as no duplicate.
 */
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { HookEventWord } from './recall.ts'

export const BRIDGE_PLUGIN_NAME = 'hooks-claude-code'

/** The Claude Code hook key each launcher word belongs to. */
export const BRIDGE_HOOK_KEYS: Readonly<Record<HookEventWord, string>> = {
  'user-prompt-submit': 'UserPromptSubmit',
  'session-start': 'SessionStart',
  'subagent-start': 'SubagentStart',
}

/** Same meaning as the engine's isEinzbernHookCommand (host-hooks.ts), for one event word. */
export function isEinzbernHookCommand(command: string, word: HookEventWord): boolean {
  return new RegExp(`engine[\\\\/]hook\\.mjs"?\\s+${word}\\b`, 'u').test(command)
}

/** Whether a parsed hooks JSON (bare or a settings file with a `hooks` key) runs the Einzbern hook for `word`. */
export function configRunsEinzbernHook(config: unknown, word: HookEventWord): boolean {
  if (config === null || typeof config !== 'object') return false
  const hooks = (config as { hooks?: unknown }).hooks
  if (hooks === null || typeof hooks !== 'object') return false
  const groups = (hooks as Record<string, unknown>)[BRIDGE_HOOK_KEYS[word]]
  if (!Array.isArray(groups)) return false
  return groups.some((group: unknown) => {
    const entries = group !== null && typeof group === 'object' ? (group as { hooks?: unknown }).hooks : undefined
    return Array.isArray(entries) && entries.some((entry: unknown) => {
      const command = entry !== null && typeof entry === 'object' ? (entry as { command?: unknown }).command : undefined
      return typeof command === 'string' && isEinzbernHookCommand(command, word)
    })
  })
}

/** The configPath of every loaded hooks-claude-code fiber. */
export function loadedBridgeConfigPaths(ctx: Pick<Context, 'registry'>): string[] {
  const paths: string[] = []
  try {
    for (const runtime of ctx.registry.values()) {
      if (runtime.name !== BRIDGE_PLUGIN_NAME) continue
      for (const fiber of runtime.fibers) {
        const configPath = (fiber.config as { configPath?: unknown } | undefined)?.configPath
        if (typeof configPath === 'string' && configPath.length > 0) paths.push(configPath)
      }
    }
  } catch { /* registry shape differs: no bridge observed */ }
  return paths
}

export interface BridgeState {
  readonly duplicate: boolean
  /** Whether a hooks-claude-code fiber is loaded in this process. */
  readonly bridgeLoaded: boolean
  readonly configPaths: readonly string[]
}

/** Detect whether the bridge already runs the Einzbern hook for `word`. */
export async function detectBridgeDuplicate(ctx: Pick<Context, 'registry'>, bridgeConfigPath: string, word: HookEventWord): Promise<BridgeState> {
  const loaded = loadedBridgeConfigPaths(ctx)
  const configPaths = bridgeConfigPath.length > 0 ? [bridgeConfigPath] : loaded
  for (const path of configPaths) {
    try {
      if (configRunsEinzbernHook(JSON.parse(await readFile(path, 'utf8')), word)) return { duplicate: true, bridgeLoaded: loaded.length > 0, configPaths }
    } catch { /* unreadable: not a duplicate */ }
  }
  return { duplicate: false, bridgeLoaded: loaded.length > 0, configPaths }
}
