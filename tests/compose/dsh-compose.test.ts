/**
 * Real composition test: the DSH kernel (Context + AgentLoop + LocalSubprocessRuntime, pinned
 * 0.1.0-rc.7 from npm) with this plugin loaded and a stub Einzbern engine under a mkdtemp device
 * home. Only the model is mocked. Nothing touches ~/.dsh, ~/.einzbern or port 19387.
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as ManaOrchestrate from '../../src/index.ts'
import { createStubHome, STUB_CONTEXT } from '../helpers.ts'
import { MockAdapter } from './mock-adapter.ts'

const home = createStubHome('written')
const workdir = mkdtempSync(join(tmpdir(), 'mana-orchestrate-cwd-'))
after(() => { home.cleanup(); rmSync(workdir, { recursive: true, force: true }) })

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ManaOrchestrate, { deviceHome: home.deviceHome, timeoutMs: 10_000, bridgeConfigPath: '' })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

const textOf = (message: Message): string => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')

async function send(prompt: string): Promise<{ adapter: MockAdapter; ctx: Context; agent: ReturnType<Context['agentLoop']['create']> }> {
  const adapter = new MockAdapter()
  const ctx = await harness(adapter)
  const agent = ctx.agentLoop.create(SessionId(`compose-${Math.random().toString(36).slice(2)}`), { provider: 'mock', model: 'mock' }, { cwd: workdir })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
  await agent.whenIdle()
  return { adapter, ctx, agent }
}

describe('DSH kernel composition', () => {
  it('a hit puts the recalled text into the model request with source mana-orchestrate, and the session events restore it', async () => {
    const { adapter, ctx, agent } = await send('please HIT the engine')
    try {
      const last = adapter.requests.at(-1)
      assert.ok(last !== undefined, 'the model was called')
      const injected = last.messages.filter(message => message.source.kind === 'mana-orchestrate')
      assert.equal(injected.length, 1)
      const text = textOf(injected[0]!)
      assert.ok(text.includes(STUB_CONTEXT), text)
      assert.ok(text.includes('host=dsh'), text)
      assert.ok(text.includes(`cwd=${workdir}`), text)

      // rc.7 exposes the committed log as `session.events` (later releases add snapshotEvents()).
      const events = agent.session.events
      // A user/message event's data is the UserMessage itself.
      const restored = events.flatMap((event) => {
        if (event.type !== 'user/message') return []
        const message = event.data as Message
        return message.source.kind === 'mana-orchestrate' ? [message] : []
      })
      assert.equal(restored.length, 1, JSON.stringify(events.map(event => event.type)))
      assert.equal(restored[0]!.id, injected[0]!.id)
      assert.equal(textOf(restored[0]!), text)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('no hit injects nothing', async () => {
    const { adapter, ctx } = await send('nothing to recall here')
    try {
      const last = adapter.requests.at(-1)
      assert.ok(last !== undefined, 'the model was called')
      assert.equal(last.messages.filter(message => message.source.kind === 'mana-orchestrate').length, 0)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
