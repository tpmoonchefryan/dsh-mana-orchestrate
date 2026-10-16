#!/usr/bin/env node

/** Record dependency license facts without deciding the plugin's pending license disposition. */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname)
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const packageNames = Object.keys(packageJson.peerDependencies ?? {})
const entries = packageNames.map(name => {
  const packagePath = join(repositoryRoot, 'node_modules', name, 'package.json')
  let manifest = null
  try { manifest = JSON.parse(readFileSync(packagePath, 'utf8')) } catch { manifest = null }
  return {
    name,
    requested: packageJson.peerDependencies[name],
    installedVersion: manifest?.version ?? null,
    license: manifest?.license ?? null,
    licenseFilePresent: existsSync(join(repositoryRoot, 'node_modules', name, 'LICENSE')),
    source: `node_modules/${name}/package.json`,
  }
})
const result = {
  schemaVersion: 'tcrn.dsh-twp.license-inventory.v1',
  package: packageJson.name,
  packageLicense: packageJson.license ?? null,
  packageLicenseDisposition: 'Apache-2.0; declared in package.json and shipped in LICENSE',
  thirdPartyNotices: { present: existsSync(join(repositoryRoot, 'THIRD_PARTY_NOTICES')), disposition: 'shipped in package files' },
  peerDependencies: entries,
  generatedBy: 'scripts/license-inventory.mjs',
}
const output = join(repositoryRoot, 'docs/license-inventory.json')
mkdirSync(resolve(output, '..'), { recursive: true })
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: entries.every(entry => entry.license !== null), reasonCode: entries.every(entry => entry.license !== null) ? 'LICENSE_INVENTORY_GREEN' : 'LICENSE_INVENTORY_INCOMPLETE', output, ...result }, null, 2))
if (entries.some(entry => entry.license === null)) process.exit(1)
