#!/usr/bin/env node

/** Keep committed JSON evidence portable: host paths belong in the private archive, not the repository. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname)
const evidenceRoot = join(repositoryRoot, 'docs/evidence')
const chainContainer = ['.tcrn', 'workspace'].join('-')
const archiveRoot = ['.tcrn', 'artifacts'].join('-')
const workflowHome = ['.tcrn', 'workflow'].join('-')
// The host paths come from this machine at run time, so no account name is written into the repository.
const home = homedir()
const codeRoot = dirname(repositoryRoot)

const scrubText = value => value
  .replaceAll(repositoryRoot, '<repository-root>')
  .replaceAll(join(codeRoot, 'dsh-tcrn-workflow-plugin'), '<repository-root>')
  .replaceAll(join(codeRoot, 'TCRN Platform'), '<platform-root>')
  .replaceAll(join(codeRoot, chainContainer), '<chain-container>')
  .replaceAll(join(codeRoot, archiveRoot), '<archive-root>')
  .replaceAll(codeRoot, '<code-root>')
  .replaceAll(join(home, '.dsh'), '<dsh-home>')
  .replaceAll(join(home, workflowHome), '<workflow-home>')
  .replaceAll(join(home, '.agents'), '<agent-home>')
  .replaceAll(join(home, '.codex'), '<codex-home>')
  .replaceAll(join(home, '.claude'), '<claude-home>')
  .replaceAll(join(home, '.nvm'), '<node-home>')
  .replaceAll('/private/var/folders', '<temp-root>')
  .replaceAll('/var/folders', '<temp-root>')
  .replaceAll('/tmp', '<temp-root>')

export const scrubEvidenceValue = value => JSON.parse(JSON.stringify(value, (_key, child) => typeof child === 'string' ? scrubText(child) : child))

export const scrubEvidenceTree = () => {
  const files = readdirSync(evidenceRoot).filter(file => file.endsWith('.json')).sort()
  const changed = []
  for (const file of files) {
    const filePath = join(evidenceRoot, file)
    let value
    try { value = JSON.parse(readFileSync(filePath, 'utf8')) } catch { continue }
    const scrubbed = scrubEvidenceValue(value)
    const output = `${JSON.stringify(scrubbed, null, 2)}\n`
    if (output !== readFileSync(filePath, 'utf8')) {
      writeFileSync(filePath, output, 'utf8')
      changed.push(file)
    }
  }
  return { scanned: files.length, changed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = scrubEvidenceTree()
  console.log(JSON.stringify({ ok: true, reasonCode: 'EVIDENCE_PATHS_SCRUBBED', ...result }, null, 2))
}
