#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checker = resolve(repositoryRoot, 'scripts/adversarial-passes-check.mjs')
const run = (args) => spawnSync(process.execPath, [checker, ...args], {
  cwd: repositoryRoot,
  encoding: 'utf8',
})
const green = run(['--records', 'TCRN-CROSS-STORY-310', 'TCRN-CROSS-STORY-311', 'TCRN-CROSS-STORY-312', 'TCRN-CROSS-STORY-313', 'TCRN-CROSS-STORY-314', 'TCRN-CROSS-STORY-315'])
const red = run(['--records', 'TCRN-CROSS-STORY-310', 'TCRN-CROSS-STORY-DOES-NOT-EXIST'])
const checks = [
  {
    name: 'multi-record green',
    ok: green.status === 0 && green.stdout.includes('ADVERSARIAL_PASS_REGISTERED'),
    detail: { status: green.status, stdout: green.stdout.trim(), stderr: green.stderr.trim() },
  },
  {
    name: 'multi-record red',
    ok: red.status !== 0 && red.stderr.includes('missing ledger entry'),
    detail: { status: red.status, stdout: red.stdout.trim(), stderr: red.stderr.trim() },
  },
]
const failures = checks.filter(check => !check.ok)
const result = {
  ok: failures.length === 0,
  reasonCode: failures.length === 0 ? 'R1A_MULTI_RECORD_SELFTEST_GREEN' : 'R1A_MULTI_RECORD_SELFTEST_FAILED',
  checks,
}
console.log(JSON.stringify(result, null, 2))
if (failures.length > 0) process.exit(1)
