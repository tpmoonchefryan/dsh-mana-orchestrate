/**
 * Recall: run the installed Einzbern hook launcher (`<deviceHome>/engine/hook.mjs <event>`)
 * through the DSH subprocess seam and classify what it printed. Pure logic over an injected
 * subprocess runtime, so it is unit-testable with a stub engine. It never throws.
 *
 * Contract (engine side): stdin is one JSON object; on a hit stdout is one line
 * `{"hookSpecificOutput":{"hookEventName","additionalContext"}}`; no hit prints nothing; a failure
 * prints nothing on stdout and one `{"ok":false,"reasonCode","error"}` line on stderr. Exit code is 0.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

export const RECALL_REASON_CODES = [
  'MANA_RECALL_ANSWERED',
  'MANA_RECALL_EMPTY',
  'MANA_RECALL_TIMEOUT',
  'MANA_RECALL_SPAWN_FAILED',
  'MANA_RECALL_OUTPUT_INVALID',
  'MANA_RECALL_ENGINE_REFUSED',
  'MANA_RECALL_NO_SUBPROCESS',
  'MANA_RECALL_BRIDGE_DUPLICATE',
] as const
export type RecallReasonCode = typeof RECALL_REASON_CODES[number]

/** The host value every spawn passes explicitly (split §1: the bridge would otherwise make the engine infer claude-code). */
export const EINZBERN_HOST = 'dsh'
export const STDOUT_MAX_BYTES = 1_048_576
export const STDERR_MAX_BYTES = 4096
export const GRACE_MS = 500

/** The launcher words this plugin runs. */
export type HookEventWord = 'user-prompt-submit' | 'session-start' | 'subagent-start'

/** The part of the subprocess runtime recall needs. */
export interface SubprocessLike {
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

export interface RunHookOptions {
  /** Explicit device home; empty means EINZBERN_HOME, then ~/.einzbern. */
  readonly deviceHome: string
  readonly timeoutMs: number
  readonly event: HookEventWord
  /** The JSON object written to the hook's stdin; `cwd` is also the spawn directory. */
  readonly payload: { readonly cwd: string } & Record<string, unknown>
  readonly signal?: AbortSignal | undefined
  /** Test seam for the ambient environment. */
  readonly env?: NodeJS.ProcessEnv | undefined
}

export interface RecallResult {
  readonly reasonCode: RecallReasonCode
  /** The additionalContext text, only with MANA_RECALL_ANSWERED. */
  readonly context?: string
  readonly detail?: Record<string, unknown>
}

/**
 * A configured device home, resolved by the same rule the engine's doctor uses
 * (dsh-plugin.ts pluginDeviceHome): `~` and `~/x` expand to the user's home, an absolute path is
 * kept, and a relative path resolves against the home, never against the DSH process cwd.
 */
export function expandConfiguredHome(configured: string, home: string = homedir()): string {
  if (configured === '~' || configured.startsWith('~/')) return join(home, configured.slice(1))
  return isAbsolute(configured) ? configured : resolve(home, configured)
}

/** Device home as the engine resolves it (hook.mjs deviceDirectory): config, then EINZBERN_HOME, then ~/.einzbern. */
export function resolveDeviceHome(configured: string, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  if (configured.length > 0) return expandConfiguredHome(configured, home)
  const fromEnv = env['EINZBERN_HOME']
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? resolve(fromEnv) : join(home, '.einzbern')
}

export function hookLauncherPath(deviceHome: string): string {
  return join(deviceHome, 'engine', 'hook.mjs')
}

/** The environment layered over the runtime's scrubbed parent base for every hook spawn. */
export function hookEnv(configuredDeviceHome: string): Record<string, string> {
  return configuredDeviceHome.length > 0
    ? { EINZBERN_HOST, EINZBERN_HOME: expandConfiguredHome(configuredDeviceHome) }
    : { EINZBERN_HOST }
}

/** Parse the hook's stdout into additionalContext, or undefined when it is not the protocol shape. */
export function parseHookStdout(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text.trim())
    if (value === null || typeof value !== 'object') return undefined
    const output = (value as { hookSpecificOutput?: unknown }).hookSpecificOutput
    if (output === null || typeof output !== 'object') return undefined
    const context = (output as { additionalContext?: unknown }).additionalContext
    return typeof context === 'string' ? context : undefined
  } catch {
    return undefined
  }
}

/** The engine's reasonCode from a stderr refusal line, if there is one. */
export function parseEngineRefusal(text: string): string | undefined {
  for (const line of text.split('\n')) {
    try {
      const value: unknown = JSON.parse(line)
      if (value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
        const code = (value as { reasonCode?: unknown }).reasonCode
        if (typeof code === 'string') return code
      }
    } catch { /* not a refusal line */ }
  }
  return undefined
}

/** Run one hook event and classify the outcome. Every failure is contained. */
export async function runHook(subprocess: SubprocessLike | undefined, options: RunHookOptions): Promise<RecallResult> {
  if (subprocess === undefined) return { reasonCode: 'MANA_RECALL_NO_SUBPROCESS' }
  const deviceHome = resolveDeviceHome(options.deviceHome, options.env)
  const launcher = hookLauncherPath(deviceHome)
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
  let handle: SubprocessHandle
  try {
    handle = subprocess.spawn({
      argv: [process.execPath, launcher, options.event],
      cwd: options.payload.cwd,
      stdio: { stdin: 'pipe', stdout: { maxBytes: STDOUT_MAX_BYTES }, stderr: { maxBytes: STDERR_MAX_BYTES } },
      graceMs: GRACE_MS,
      env: hookEnv(options.deviceHome),
      signal,
    })
  } catch (error: unknown) {
    return { reasonCode: 'MANA_RECALL_SPAWN_FAILED', detail: { launcher, error: String(error) } }
  }
  try {
    const stdin = handle.stdin
    if (stdin !== undefined) {
      stdin.on('error', () => { /* a child that exits before reading stdin is classified by its output */ })
      stdin.end(JSON.stringify(options.payload))
    }
    const outcome = await handle.done
    // The seam does not classify deadlines (types.ts: the caller owns them).
    if (timeout.aborted) return { reasonCode: 'MANA_RECALL_TIMEOUT', detail: { launcher, timeoutMs: options.timeoutMs } }
    if (options.signal?.aborted === true) return { reasonCode: 'MANA_RECALL_TIMEOUT', detail: { launcher, aborted: true } }
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (stdout.trim().length === 0) {
      const engineCode = parseEngineRefusal(stderr)
      if (engineCode !== undefined) return { reasonCode: 'MANA_RECALL_ENGINE_REFUSED', detail: { engineReasonCode: engineCode } }
      if (outcome.exitCode !== 0) return { reasonCode: 'MANA_RECALL_SPAWN_FAILED', detail: { launcher, exitCode: outcome.exitCode, signal: outcome.signal } }
      return { reasonCode: 'MANA_RECALL_EMPTY' }
    }
    const context = parseHookStdout(stdout)
    if (context === undefined) return { reasonCode: 'MANA_RECALL_OUTPUT_INVALID', detail: { bytes: Buffer.byteLength(stdout) } }
    if (context.length === 0) return { reasonCode: 'MANA_RECALL_EMPTY' }
    return { reasonCode: 'MANA_RECALL_ANSWERED', context }
  } catch (error: unknown) {
    if (timeout.aborted) return { reasonCode: 'MANA_RECALL_TIMEOUT', detail: { launcher, timeoutMs: options.timeoutMs } }
    return { reasonCode: 'MANA_RECALL_SPAWN_FAILED', detail: { launcher, error: String(error) } }
  }
}
