/**
 * Host half of Mana Orchestrate for DeepSeek Harness.
 *
 * On every proposed step with input messages, the plugin runs the installed Einzbern hook
 * launcher (`<deviceHome>/engine/hook.mjs user-prompt-submit`) and appends the recalled lines to
 * a downstream `enter` decision as one user message whose source kind is `mana-orchestrate`.
 * It never rejects a step and never throws into the loop.
 *
 * The 0.1.0 diagnostics shell (probes, M2 doctor surface, M3 hook panel, portal declaration,
 * TCRN Workflow 1.x knowledge and session-summary wiring) has been removed.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: declaration-merged subagent/start event.
import type {} from '@deepseek-ai/dsh-subagent'
import { detectBridgeDuplicate } from './bridge.ts'
import { readNavigationChoice, type NavigationChoice } from './navigation.ts'
import { resolveDeviceHome, runHook, type RecallResult, type RunHookOptions } from './recall.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'mana-orchestrate': { kind: 'mana-orchestrate' } & ContextFormed
  }
}

// The control-tree guard stays a pure-function export; it is not wired to any
// host seam (see README, "Control-tree guard").
export { controlTreeGuardReason, GUARDED_TREE_NAMES, GUARDED_WRITE_TOOLS, M4_GUARD_DENIAL_REASON, shouldDenyControlTreeWrite } from './guard.ts'
export { buildActivationClaim, isActivationClaim } from './activation.ts'
export { RECALL_REASON_CODES, runHook, type RecallReasonCode, type RecallResult } from './recall.ts'

export const name = 'dsh-mana-orchestrate'
export const MESSAGE_SOURCE_KIND = 'mana-orchestrate'

export interface Config {
  /** Einzbern device home; empty means EINZBERN_HOME, then ~/.einzbern. */
  deviceHome?: string
  /** Per-hook deadline in milliseconds. */
  timeoutMs?: number
  /**
   * The hooks-claude-code config to check for a duplicate Einzbern hook. Empty means the
   * configPath of every hooks-claude-code fiber loaded in this process.
   */
  bridgeConfigPath?: string
}

export const Config: z<Config> = z.object({
  deviceHome: z.string().default(''),
  timeoutMs: z.number().default(5000),
  bridgeConfigPath: z.string().default(''),
})

/** Where the recall cwd came from, recorded in diagnostics. */
export type CwdSource = 'session' | 'process'

/** The last recall the plugin ran, for the status route. */
export interface RecallObservation {
  readonly reasonCode: RecallResult['reasonCode']
  readonly at: string
  readonly event: RunHookOptions['event']
  readonly detail?: Record<string, unknown>
}

/** Model-facing context message carrying the recalled lines. */
export function createRecallMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: MESSAGE_SOURCE_KIND } })
}

/** The prompt text: every text block of the step's messages joined by newlines. */
export function promptText(messages: readonly UserMessage[]): string {
  return messages.flatMap(message => message.content).flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/** The session cwd, falling back to the process cwd. */
export function recallCwd(agent: Pick<Agent, 'session'>): { cwd: string; source: CwdSource } {
  const cwd = agent.session.header.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? { cwd, source: 'session' } : { cwd: process.cwd(), source: 'process' }
}

export type RecallRunner = (event: RunHookOptions['event'], payload: RunHookOptions['payload'], signal?: AbortSignal) => Promise<RecallResult>

type PreStepPayload = { agent: Agent; messages: UserMessage[]; signal: AbortSignal }

/**
 * The `agent/pre-step` listener. Recall starts first and runs while `next()` settles;
 * the context is appended only to a downstream `enter` decision.
 */
export function createPreStepHandler(runRecall: RecallRunner, observe: (observation: RecallObservation) => void = () => {}) {
  return async ({ agent, messages, signal }: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (messages.length === 0) return next()
    const { cwd, source } = recallCwd(agent)
    const recall = runRecall('user-prompt-submit', {
      hook_event_name: 'UserPromptSubmit',
      session_id: String(agent.session.id),
      prompt: promptText(messages),
      cwd,
    }, signal).catch((error: unknown): RecallResult => ({ reasonCode: 'MANA_RECALL_SPAWN_FAILED', detail: { error: String(error) } }))
    const downstream = await next()
    const result = await recall
    observe({
      reasonCode: result.reasonCode,
      at: new Date().toISOString(),
      event: 'user-prompt-submit',
      detail: { ...result.detail, cwdSource: source },
    })
    if (downstream.kind !== 'enter' || result.reasonCode !== 'MANA_RECALL_ANSWERED' || result.context === undefined) return downstream
    return { ...downstream, messages: [...downstream.messages, createRecallMessage(result.context)] }
  }
}

/**
 * Pointer hooks for a device whose navigation choice is `declined`: run the engine's
 * session-start / subagent-start and inject what it prints into the agent. The engine owns the
 * text. Any other choice injects nothing.
 */
export async function injectNavigation(
  agent: Pick<Agent, 'inject' | 'session'>,
  event: 'session-start' | 'subagent-start',
  choice: () => Promise<NavigationChoice>,
  runRecall: RecallRunner,
  observe: (observation: RecallObservation) => void = () => {},
): Promise<boolean> {
  if (await choice() !== 'declined') return false
  const { cwd, source } = recallCwd(agent)
  const result = await runRecall(event, {
    hook_event_name: event === 'session-start' ? 'SessionStart' : 'SubagentStart',
    session_id: String(agent.session.id),
    cwd,
  }).catch((error: unknown): RecallResult => ({ reasonCode: 'MANA_RECALL_SPAWN_FAILED', detail: { error: String(error) } }))
  observe({ reasonCode: result.reasonCode, at: new Date().toISOString(), event, detail: { ...result.detail, cwdSource: source } })
  if (result.reasonCode !== 'MANA_RECALL_ANSWERED' || result.context === undefined) return false
  agent.inject(createRecallMessage(result.context))
  return true
}

export function apply(ctx: Context, config: Config): void {
  const deviceHome = config.deviceHome ?? ''
  const timeoutMs = config.timeoutMs ?? 5000
  let last: RecallObservation | undefined
  const observe = (observation: RecallObservation): void => {
    last = observation
    ctx.logger.debug(`mana-orchestrate: ${observation.event} ${observation.reasonCode}`)
  }
  const bridgeConfigPath = config.bridgeConfigPath ?? ''
  const runRecall: RecallRunner = async (event, payload, signal) => {
    // Checked per event, so a bridge loaded after this plugin is still seen.
    const bridge = await detectBridgeDuplicate(ctx, bridgeConfigPath, event)
    if (bridge.duplicate) return { reasonCode: 'MANA_RECALL_BRIDGE_DUPLICATE', detail: { configPaths: bridge.configPaths, bridgeLoaded: bridge.bridgeLoaded } }
    return runHook(ctx.get('subprocess'), { deviceHome, timeoutMs, event, payload, signal })
  }
  const choice = (): Promise<NavigationChoice> => readNavigationChoice(resolveDeviceHome(deviceHome))
  ctx.on('agent/pre-step', createPreStepHandler(runRecall, observe))
  ctx.on('agent/created', ({ agent }) => {
    void injectNavigation(agent, 'session-start', choice, runRecall, observe)
      .catch((error: unknown) => { ctx.logger.warn(`mana-orchestrate: session-start navigation failed: ${String(error)}`) })
  })
  ctx.on('subagent/start', (info) => {
    const child = ctx.get('agents')?.get(info.id)
    if (child === undefined) return
    void injectNavigation(child, 'subagent-start', choice, runRecall, observe)
      .catch((error: unknown) => { ctx.logger.warn(`mana-orchestrate: subagent-start navigation failed: ${String(error)}`) })
  })

  // Read-only status route for the browser card. It serves the loopback web host; the plugin adds
  // no authentication and no second network binding.
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: STATUS_ROUTE,
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        void choice().then((navigation) => {
          const body = JSON.stringify(statusBody(last, navigation))
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          if (req.method === 'HEAD') res.end()
          else res.end(body)
        })
      },
    }), 'dsh-mana-orchestrate: status route')
  })
}

export const STATUS_ROUTE = '/mana-orchestrate/status'

/** The status route's JSON body. */
export interface StatusBody {
  readonly plugin: string
  readonly lastReasonCode: RecallResult['reasonCode'] | null
  readonly at: string | null
  readonly event: RunHookOptions['event'] | null
  readonly detail: Record<string, unknown> | null
  readonly bridgeDuplicate: boolean
  readonly navigation: NavigationChoice
}

export function statusBody(last: RecallObservation | undefined, navigation: NavigationChoice): StatusBody {
  return {
    plugin: name,
    lastReasonCode: last?.reasonCode ?? null,
    at: last?.at ?? null,
    event: last?.event ?? null,
    detail: last?.detail ?? null,
    bridgeDuplicate: last?.reasonCode === 'MANA_RECALL_BRIDGE_DUPLICATE',
    navigation,
  }
}
