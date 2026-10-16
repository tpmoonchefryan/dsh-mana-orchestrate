import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hookEnv, resolveDeviceHome, runHook } from '../src/recall.ts'
import { createStubHome, nodeSubprocess, STUB_CONTEXT } from './helpers.ts'

const home = createStubHome()
after(() => home.cleanup())

const run = (prompt: string, timeoutMs = 5000) => {
  const subprocess = nodeSubprocess()
  return runHook(subprocess, {
    deviceHome: home.deviceHome,
    timeoutMs,
    event: 'user-prompt-submit',
    payload: { prompt, cwd: tmpdir() },
  }).then(result => ({ result, subprocess }))
}

describe('runHook reason codes', () => {
  it('answers with the additionalContext on a hit and passes EINZBERN_HOST=dsh', async () => {
    const { result, subprocess } = await run('please HIT')
    assert.equal(result.reasonCode, 'MANA_RECALL_ANSWERED')
    assert.ok(result.context?.includes(STUB_CONTEXT))
    assert.ok(result.context?.includes('host=dsh'))
    const spec = subprocess.specs[0]!
    assert.deepEqual(spec.argv.slice(1), [join(home.deviceHome, 'engine', 'hook.mjs'), 'user-prompt-submit'])
    assert.equal(spec.env?.['EINZBERN_HOST'], 'dsh')
    assert.equal(spec.env?.['EINZBERN_HOME'], home.deviceHome)
    assert.equal(spec.stdio.stdin, 'pipe')
  })
  it('reports empty output', async () => {
    assert.equal((await run('nothing here')).result.reasonCode, 'MANA_RECALL_EMPTY')
  })
  it('reports a timeout', async () => {
    assert.equal((await run('SLOW', 300)).result.reasonCode, 'MANA_RECALL_TIMEOUT')
  })
  it('reports non-JSON output', async () => {
    assert.equal((await run('GARBAGE')).result.reasonCode, 'MANA_RECALL_OUTPUT_INVALID')
  })
  it('reports an engine refusal with its code', async () => {
    const { result } = await run('REFUSE')
    assert.equal(result.reasonCode, 'MANA_RECALL_ENGINE_REFUSED')
    assert.equal(result.detail?.['engineReasonCode'], 'HOOK_INPUT_TOO_LARGE')
  })
  it('reports a missing subprocess service', async () => {
    const result = await runHook(undefined, { deviceHome: '', timeoutMs: 10, event: 'user-prompt-submit', payload: { cwd: '/' } })
    assert.equal(result.reasonCode, 'MANA_RECALL_NO_SUBPROCESS')
  })
  it('reports a spawn that throws', async () => {
    const result = await runHook({ spawn: () => { throw new Error('boom') } }, { deviceHome: '/x', timeoutMs: 10, event: 'user-prompt-submit', payload: { cwd: '/' } })
    assert.equal(result.reasonCode, 'MANA_RECALL_SPAWN_FAILED')
  })
})

describe('device home and env', () => {
  it('resolves config, then EINZBERN_HOME, then ~/.einzbern', () => {
    assert.equal(resolveDeviceHome('/a', { EINZBERN_HOME: '/b' }, '/h'), '/a')
    assert.equal(resolveDeviceHome('', { EINZBERN_HOME: '/b' }, '/h'), '/b')
    assert.equal(resolveDeviceHome('', {}, '/h'), '/h/.einzbern')
    // Same rule as the engine doctor (dsh-plugin.ts pluginDeviceHome): ~ expands, relative resolves against home.
    assert.equal(resolveDeviceHome('~', {}, '/h'), '/h')
    assert.equal(resolveDeviceHome('~/.einzbern', {}, '/h'), '/h/.einzbern')
    assert.equal(resolveDeviceHome('dev/einzbern', {}, '/h'), '/h/dev/einzbern')
  })
  it('always passes EINZBERN_HOST=dsh and EINZBERN_HOME only when configured', () => {
    assert.deepEqual(hookEnv(''), { EINZBERN_HOST: 'dsh' })
    assert.deepEqual(hookEnv('/a'), { EINZBERN_HOST: 'dsh', EINZBERN_HOME: '/a' })
  })
})
