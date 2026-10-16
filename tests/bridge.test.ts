import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { configRunsEinzbernHook, detectBridgeDuplicate, isEinzbernHookCommand, loadedBridgeConfigPaths } from '../src/bridge.ts'

const dir = mkdtempSync(join(tmpdir(), 'mana-orchestrate-bridge-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const withHook = join(dir, 'with.json')
const without = join(dir, 'without.json')
writeFileSync(withHook, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "/h/.einzbern/engine/hook.mjs" user-prompt-submit' }] }] } }))
writeFileSync(without, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }))

/** Stand-in with the bridge's registry name; only its fiber config matters here. */
const fakeBridge = { name: 'hooks-claude-code', apply: (_ctx: Context, _config: { configPath: string }) => {} }

describe('bridge de-duplication', () => {
  it('matches the engine hook command per event word', () => {
    assert.equal(isEinzbernHookCommand('node "/x/engine/hook.mjs" user-prompt-submit', 'user-prompt-submit'), true)
    assert.equal(isEinzbernHookCommand('node C:\\x\\engine\\hook.mjs user-prompt-submit', 'user-prompt-submit'), true)
    assert.equal(isEinzbernHookCommand('node /x/engine/hook.mjs session-start', 'user-prompt-submit'), false)
    assert.equal(configRunsEinzbernHook({ hooks: { SessionStart: [{ hooks: [{ command: 'node /x/engine/hook.mjs session-start' }] }] } }, 'session-start'), true)
  })

  it('uses Config.bridgeConfigPath when set', async () => {
    const ctx = new Context()
    assert.equal((await detectBridgeDuplicate(ctx, withHook, 'user-prompt-submit')).duplicate, true)
    assert.equal((await detectBridgeDuplicate(ctx, without, 'user-prompt-submit')).duplicate, false)
    assert.equal((await detectBridgeDuplicate(ctx, join(dir, 'missing.json'), 'user-prompt-submit')).duplicate, false)
  })

  it('reads the configPath of a loaded hooks-claude-code fiber from the cordis registry', async () => {
    const ctx = new Context()
    assert.deepEqual(loadedBridgeConfigPaths(ctx), [])
    await ctx.plugin(fakeBridge, { configPath: withHook })
    assert.deepEqual(loadedBridgeConfigPaths(ctx), [withHook])
    const state = await detectBridgeDuplicate(ctx, '', 'user-prompt-submit')
    assert.equal(state.duplicate, true)
    assert.equal(state.bridgeLoaded, true)
    assert.equal((await detectBridgeDuplicate(ctx, '', 'session-start')).duplicate, false)
    await ctx.fiber.dispose()
  })
})
