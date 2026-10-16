/**
 * Test helpers: a stub Einzbern engine under a mkdtemp device home, and a minimal
 * node:child_process-backed subprocess runtime for unit tests. Nothing here touches
 * ~/.einzbern or ~/.dsh.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessLike } from '../src/recall.ts'

export const STUB_CONTEXT = 'MANA_STUB_RECALL_CONTEXT'
export const STUB_NAVIGATION = 'MANA_STUB_NAVIGATION_LINE'

/**
 * The stub launcher reads the JSON stdin and answers by prompt keyword:
 * HIT → protocol JSON (with the host it saw), SLOW → hangs, GARBAGE → non-JSON,
 * REFUSE → engine refusal on stderr, anything else → nothing.
 * session-start / subagent-start → one navigation line.
 */
const STUB_SOURCE = `
const event = process.argv[2]
let data = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { data += chunk })
process.stdin.on('end', () => {
  const payload = data.length > 0 ? JSON.parse(data) : {}
  const out = (name, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext: text } }) + '\\n')
  if (event === 'session-start') return out('SessionStart', '${STUB_NAVIGATION} host=' + process.env.EINZBERN_HOST)
  if (event === 'subagent-start') return out('SubagentStart', '${STUB_NAVIGATION} host=' + process.env.EINZBERN_HOST)
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  if (prompt.includes('HIT')) return out('UserPromptSubmit', '${STUB_CONTEXT} host=' + process.env.EINZBERN_HOST + ' cwd=' + payload.cwd)
  if (prompt.includes('SLOW')) { setTimeout(() => {}, 30000); return }
  if (prompt.includes('GARBAGE')) { process.stdout.write('not json\\n'); return }
  if (prompt.includes('REFUSE')) { process.stderr.write(JSON.stringify({ ok: false, reasonCode: 'HOOK_INPUT_TOO_LARGE', error: 'stub' }) + '\\n'); return }
})
process.exitCode = 0
`

export interface StubHome {
  readonly deviceHome: string
  readonly cleanup: () => void
}

/** A mkdtemp device home with engine/hook.mjs and, optionally, machine-settings.json. */
export function createStubHome(navigation?: string): StubHome {
  const deviceHome = mkdtempSync(join(tmpdir(), 'mana-orchestrate-home-'))
  mkdirSync(join(deviceHome, 'engine'), { recursive: true })
  writeFileSync(join(deviceHome, 'engine', 'hook.mjs'), STUB_SOURCE)
  if (navigation !== undefined) {
    writeFileSync(join(deviceHome, 'machine-settings.json'), JSON.stringify({
      schemaVersion: 'tcrn.machine-settings.v1',
      values: { 'agents.navigation': navigation },
    }))
  }
  return { deviceHome, cleanup: () => rmSync(deviceHome, { recursive: true, force: true }) }
}

/** A minimal subprocess runtime over node:child_process with the seam's collected-output shape. */
export function nodeSubprocess(): SubprocessLike & { readonly specs: SubprocessSpawnSpec[] } {
  const specs: SubprocessSpawnSpec[] = []
  return {
    specs,
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      specs.push(spec)
      const [command, ...args] = spec.argv
      const child = spawn(command!, args, {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        ...spec.signal === undefined ? {} : { signal: spec.signal },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
      child.on('error', () => { /* abort surfaces through close */ })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolveDone) => {
        child.on('close', (exitCode, signal) => resolveDone({ exitCode, signal }))
      })
      const reader = (read: () => string) => ({ readFrom: () => ({ text: read(), nextOffset: Buffer.byteLength(read()), lossy: false }) })
      return {
        pid: child.pid ?? -1,
        stdin: child.stdin,
        stdout: undefined,
        stderr: undefined,
        collected: { stdout: reader(() => stdout), stderr: reader(() => stderr) },
        done,
        terminate: () => { child.kill('SIGKILL') },
        waitForExit: async () => { await done; return true },
      }
    },
  }
}
