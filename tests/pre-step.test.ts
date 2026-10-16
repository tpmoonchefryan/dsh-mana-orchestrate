import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createPreStepHandler, type RecallObservation, type RecallRunner } from '../src/index.ts'

const agent = { session: { id: 'session-1', header: { cwd: '/work' } } } as unknown as Agent
const user = (text: string): UserMessage => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const signal = new AbortController().signal
const hit: RecallRunner = async () => ({ reasonCode: 'MANA_RECALL_ANSWERED', context: 'RECALLED' })

describe('agent/pre-step handler', () => {
  it('passes through without running recall when there are no messages', async () => {
    let ran = false
    const handler = createPreStepHandler(async () => { ran = true; return { reasonCode: 'MANA_RECALL_EMPTY' } })
    const decision = await handler({ agent, messages: [], signal }, async () => ({ kind: 'enter', messages: [] }))
    assert.equal(ran, false)
    assert.deepEqual(decision, { kind: 'enter', messages: [] })
  })

  it('leaves a downstream reject untouched', async () => {
    const decision = await createPreStepHandler(hit)({ agent, messages: [user('x')], signal }, async () => ({ kind: 'reject' }))
    assert.deepEqual(decision, { kind: 'reject' })
  })

  it('appends one mana-orchestrate message to a downstream enter, after next()', async () => {
    const order: string[] = []
    const observations: RecallObservation[] = []
    let payload: Record<string, unknown> | undefined
    const runner: RecallRunner = async (_event, input) => { payload = input; order.push('recall'); return { reasonCode: 'MANA_RECALL_ANSWERED', context: 'RECALLED' } }
    const original = user('hello\nworld')
    const decision = await createPreStepHandler(runner, o => observations.push(o))(
      { agent, messages: [original], signal },
      async (): Promise<PreStepDecision> => { order.push('next'); return { kind: 'enter', messages: [original] } },
    )
    assert.equal(decision.kind, 'enter')
    if (decision.kind !== 'enter') return
    assert.equal(decision.messages.length, 2)
    assert.equal(decision.messages[0], original)
    const injected = decision.messages[1]!
    assert.equal(injected.source.kind, 'mana-orchestrate')
    assert.deepEqual(injected.content, [{ type: 'text', text: 'RECALLED' }])
    assert.equal(payload?.['prompt'], 'hello\nworld')
    assert.equal(payload?.['cwd'], '/work')
    assert.equal(observations[0]?.reasonCode, 'MANA_RECALL_ANSWERED')
    assert.equal(observations[0]?.detail?.['cwdSource'], 'session')
  })

  it('does not inject when recall has no answer', async () => {
    const original = user('x')
    const decision = await createPreStepHandler(async () => ({ reasonCode: 'MANA_RECALL_EMPTY' }))(
      { agent, messages: [original], signal }, async () => ({ kind: 'enter', messages: [original] }))
    assert.deepEqual(decision, { kind: 'enter', messages: [original] })
  })

  it('contains a recall runner that rejects', async () => {
    const original = user('x')
    const decision = await createPreStepHandler(async () => { throw new Error('boom') })(
      { agent, messages: [original], signal }, async () => ({ kind: 'enter', messages: [original] }))
    assert.deepEqual(decision, { kind: 'enter', messages: [original] })
  })
})
