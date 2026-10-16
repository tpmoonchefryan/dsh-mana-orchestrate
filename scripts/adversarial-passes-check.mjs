#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const rawRecords = []
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] !== '--records') continue
  index += 1
  while (index < argv.length && !argv[index].startsWith('--')) {
    rawRecords.push(argv[index])
    index += 1
  }
  index -= 1
}
const records = [...new Set(rawRecords.flatMap(value => value.split(/[\s,]+/u).map(item => item.trim()).filter(Boolean)))]

if (records.length === 0) {
  console.error('adversarial-passes-check: --records requires at least one record id')
  process.exit(2)
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ledgerPath = resolve(repositoryRoot, 'docs/adversarial-passes.md')
const ledger = readFileSync(ledgerPath, 'utf8')
const failures = []

const reviewPaths = (entry) => [...entry.matchAll(/docs\/adversarial\/[^\s`,)]+\/(?:lens-[123]|rebuttal)\.md/gu)].map(match => match[0])
const checkReviewFiles = (record, entry) => {
  const paths = [...new Set(reviewPaths(entry))]
  const expected = ['lens-1.md', 'lens-2.md', 'lens-3.md', 'rebuttal.md']
  for (const file of expected) {
    const path = paths.find(candidate => candidate.endsWith(`/${file}`))
    if (path === undefined) {
      failures.push(`${record}: missing review file pointer ${file}`)
      continue
    }
    const absolute = resolve(repositoryRoot, path)
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      failures.push(`${record}: review file is not a regular file: ${path}`)
      continue
    }
    const body = readFileSync(absolute, 'utf8')
    if (!body.includes('execution-form:')) failures.push(`${record}: review file lacks execution-form: ${path}`)
    if (file === 'rebuttal.md' && !body.includes('survives')) failures.push(`${record}: rebuttal lacks surviving/refuted disposition: ${path}`)
  }
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\[\]\\]/gu, '\\$&')
const headingPattern = record => new RegExp(`^### ${escapeRegExp(record)}(?:\\s|（|\\(|$)`, 'gmu')

for (const record of records) {
  const starts = [...ledger.matchAll(headingPattern(record))].map(match => match.index ?? -1).filter(index => index >= 0)
  const start = starts.at(-1) ?? -1
  if (start === -1) {
    failures.push(`${record}: missing ledger entry`)
    continue
  }
  const next = ledger.indexOf('\n### ', start + 4 + record.length)
  const entry = ledger.slice(start, next === -1 ? undefined : next)
  if (!entry.includes('- `classification`:')) failures.push(`${record}: missing classification`)
  const classification = entry.match(/- `classification`: ([^\n]+)/u)?.[1]?.trim().replaceAll('`', '')
  if (classification === 'pending') failures.push(`${record}: adversarial review is still pending`)
  if (!entry.includes('- `contract`:')) failures.push(`${record}: missing existing-contract statement`)
  if (!entry.includes('- `can-fail`:')) failures.push(`${record}: missing fail-capable criteria`)
  if (entry.includes('`classification`: `exempt-routine`') && !entry.includes('- `decision`: routine exemption')) {
    failures.push(`${record}: routine exemption lacks explicit decision`)
  }
  if (classification === 'adversarial-review-failed' || classification === 'adversarial-pass') {
    checkReviewFiles(record, entry)
  }
  if (classification === 'adversarial-review-failed') failures.push(`${record}: adversarial review has surviving issues`)
  if (classification !== 'exempt-routine' && classification !== 'adversarial-pass' && classification !== 'adversarial-review-failed' && classification !== 'pending') {
    failures.push(`${record}: unknown classification ${classification ?? '(missing)'}`)
  }
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, reasonCode: 'ADVERSARIAL_PASS_MISSING', failures }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, reasonCode: 'ADVERSARIAL_PASS_REGISTERED', records }, null, 2))
