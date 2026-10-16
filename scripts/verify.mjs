#!/usr/bin/env node

/**
 * Local verification train: typecheck, build, license inventory, unit tests,
 * and the real DSH kernel composition test, run serially. It prints one JSON
 * summary and exits non-zero when any step fails. It writes no evidence file.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const commands = [
  { name: 'typecheck', command: npm, args: ['run', 'typecheck'] },
  { name: 'build', command: npm, args: ['run', 'build'] },
  { name: 'verify:licenses', command: npm, args: ['run', 'verify:licenses'] },
  { name: 'test', command: npm, args: ['run', 'test'] },
  { name: 'test:compose', command: npm, args: ['run', 'test:compose'] },
]

const results = []
for (const entry of commands) {
  const started = Date.now()
  const child = spawnSync(entry.command, entry.args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const ok = child.status === 0
  results.push({
    name: entry.name,
    command: [entry.command, ...entry.args].join(' '),
    durationMs: Date.now() - started,
    status: child.status,
    ok,
    ...ok ? {} : { stdout: child.stdout ?? '', stderr: child.stderr ?? '' },
  })
}
const failures = results.filter(result => !result.ok)
console.log(JSON.stringify({
  ok: failures.length === 0,
  reasonCode: failures.length === 0 ? 'MANA_LOCAL_VERIFY_GREEN' : 'MANA_LOCAL_VERIFY_FAILED',
  results,
}, null, 2))
if (failures.length > 0) process.exit(1)
