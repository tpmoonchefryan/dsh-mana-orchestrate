import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { injectNavigation, type RecallRunner } from '../src/index.ts'
import { readNavigationChoice } from '../src/navigation.ts'
import { createStubHome } from './helpers.ts'

const declined = createStubHome('declined')
const written = createStubHome('written')
const unset = createStubHome()
after(() => { declined.cleanup(); written.cleanup(); unset.cleanup() })

const fakeAgent = () => {
  const injected: UserMessage[] = []
  const agent = { session: { id: 's', header: { cwd: '/work' } }, inject: (m: UserMessage) => { injected.push(m) } } as unknown as Agent
  return { agent, injected }
}

describe('navigation choice', () => {
  it('reads declined, written, and unset', async () => {
    assert.equal(await readNavigationChoice(declined.deviceHome), 'declined')
    assert.equal(await readNavigationChoice(written.deviceHome), 'written')
    assert.equal(await readNavigationChoice(unset.deviceHome), null)
  })

  it('injects the engine line on declined', async () => {
    const { agent, injected } = fakeAgent()
    let event = ''
    const runner: RecallRunner = async (e) => { event = e; return { reasonCode: 'MANA_RECALL_ANSWERED', context: 'NAV' } }
    assert.equal(await injectNavigation(agent, 'session-start', async () => 'declined', runner), true)
    assert.equal(event, 'session-start')
    assert.equal(injected.length, 1)
    assert.equal(injected[0]?.source.kind, 'mana-orchestrate')
  })

  it('injects nothing and runs nothing otherwise', async () => {
    for (const choice of ['written', null] as const) {
      const { agent, injected } = fakeAgent()
      let ran = false
      const runner: RecallRunner = async () => { ran = true; return { reasonCode: 'MANA_RECALL_ANSWERED', context: 'NAV' } }
      assert.equal(await injectNavigation(agent, 'subagent-start', async () => choice, runner), false)
      assert.equal(ran, false)
      assert.equal(injected.length, 0)
    }
  })
})
