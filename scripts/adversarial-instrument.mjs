#!/usr/bin/env node

/**
 * Minimal, repeatable R1a instrument. It creates review briefs only; it never
 * invokes a model, reads a session archive, or writes the governed chain.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const value = flag => {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const record = value('--record')
const outDir = value('--out-dir')
const checkDir = value('--dir')

const fail = (reasonCode, message, checks = []) => {
  console.error(JSON.stringify({ ok: false, reasonCode, message, checks }, null, 2))
  process.exit(1)
}

if (has('--template')) {
  if (!record || !outDir) fail('R1A_INSTRUMENT_ARGUMENT_MISSING', '--template requires --record and --out-dir')
  const target = resolve(outDir)
  mkdirSync(target, { recursive: true })
  const files = {
    'lens-1.md': `# R1a lens 1 — ${record}\n\nauthor-context: <independent-author-context-lens-1>\nexecution-form: independent-subagent\nscope: ${record} local delivery\n\n## Blind review\n\n- finding: <record one independently observed finding>\n- evidence: <absolute or repository-relative file and line>\n- disposition: <survives | refuted | registered>\n`,
    'lens-2.md': `# R1a lens 2 — ${record}\n\nauthor-context: <independent-author-context-lens-2>\nexecution-form: independent-subagent\nscope: ${record} local delivery\n\n## Blind review\n\n- finding: <record one independently observed finding>\n- evidence: <absolute or repository-relative file and line>\n- disposition: <survives | refuted | registered>\n`,
    'lens-3.md': `# R1a lens 3 — ${record}\n\nauthor-context: <independent-author-context-lens-3>\nexecution-form: independent-subagent\nscope: ${record} local delivery\n\n## Blind review\n\n- finding: <record one independently observed finding>\n- evidence: <absolute or repository-relative file and line>\n- disposition: <survives | refuted | registered>\n`,
    'rebuttal.md': `# R1a rebuttal — ${record}\n\nexecution-form: orchestrator-rebuttal\nscope: ${record} local delivery\n\n## Disposition\n\n- survives: <finding id and evidence>\n- refuted: <finding id and evidence, or none>\n- registered: <boundary item and owner>\n`,
  }
  for (const [file, body] of Object.entries(files)) writeFileSync(resolve(target, file), body, 'utf8')
  console.log(JSON.stringify({ ok: true, reasonCode: 'R1A_INSTRUMENT_TEMPLATE_CREATED', record, outDir: target, files: Object.keys(files) }, null, 2))
  process.exit(0)
}

if (has('--check')) {
  if (!checkDir) fail('R1A_INSTRUMENT_ARGUMENT_MISSING', '--check requires --dir')
  const target = resolve(checkDir)
  const files = ['lens-1.md', 'lens-2.md', 'lens-3.md', 'rebuttal.md']
  const checks = []
  const failures = []
  for (const file of files) {
    const path = resolve(target, file)
    const regular = existsSync(path) && statSync(path).isFile()
    const body = regular ? readFileSync(path, 'utf8') : ''
    const author = body.match(/^author-context:\s*(.+)$/mu)?.[1]?.trim() ?? ''
    const ok = regular && /^execution-form:\s*\S.+$/mu.test(body) && (file === 'rebuttal.md' ? body.includes('survives:') : author.length > 0)
    checks.push({ name: file, ok, detail: regular ? { authorContext: author, executionForm: body.match(/^execution-form:\s*(.+)$/mu)?.[1]?.trim() } : 'not a regular file' })
    if (!ok) failures.push(file)
  }
  const lensAuthors = checks.filter(check => check.name.startsWith('lens-')).map(check => check.detail.authorContext)
  const distinctAuthors = new Set(lensAuthors).size === 3 && !lensAuthors.some(author => author.includes('<independent-author-context-'))
  checks.push({ name: 'three distinct author contexts', ok: distinctAuthors, detail: lensAuthors })
  if (!distinctAuthors) failures.push('three distinct author contexts')
  const result = { ok: failures.length === 0, reasonCode: failures.length === 0 ? 'R1A_INSTRUMENT_CHECK_GREEN' : 'R1A_INSTRUMENT_CHECK_FAILED', dir: target, checks, failures }
  console.log(JSON.stringify(result, null, 2))
  if (failures.length > 0) process.exit(1)
  process.exit(0)
}

fail('R1A_INSTRUMENT_ARGUMENT_MISSING', `use --template --record <id> --out-dir <dir> or --check --dir <dir> (repositoryRoot=${repositoryRoot})`)
