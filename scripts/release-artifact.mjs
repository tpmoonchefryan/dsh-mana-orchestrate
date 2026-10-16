#!/usr/bin/env node

/** Build a local release tarball and record byte identities; never publishes or writes the chain. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname)
// Default: the platform archive beside this repository (<container>/.tcrn-artifacts/<package>); TCRN_ARTIFACT_ROOT overrides it.
const artifactRoot = resolve(process.env.TCRN_ARTIFACT_ROOT ?? join(repositoryRoot, '..', '.tcrn-artifacts', 'dsh-mana-orchestrate'))
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const gitHeadRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' })
const gitStatusRun = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repositoryRoot, encoding: 'utf8' })
const commit = gitHeadRun.status === 0 ? gitHeadRun.stdout.trim() : null
if (gitHeadRun.status !== 0 || !/^[0-9a-f]{40}$/u.test(commit ?? '') || gitStatusRun.status !== 0 || (gitStatusRun.stdout ?? '').trim() !== '') {
  console.error(JSON.stringify({ ok: false, reasonCode: 'RELEASE_SOURCE_NOT_COMMITTED', commit, status: gitStatusRun.stdout ?? '', detail: 'release artifact must be rebuilt from one clean full-SHA commit' }, null, 2))
  process.exit(1)
}

const directoryDigest = root => {
  const rows = []
  const walk = relativePath => {
    const absolute = join(root, relativePath)
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      const next = relativePath === '' ? entry.name : join(relativePath, entry.name)
      const path = join(root, next)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) rows.push(`${next}\tlink:${readlinkSync(path)}`)
      else if (stat.isDirectory()) walk(next)
      else if (stat.isFile()) rows.push(`${next}\t${sha256(readFileSync(path))}`)
    }
  }
  walk('')
  return sha256(`${rows.join('\n')}\n`)
}

mkdirSync(artifactRoot, { recursive: true })
const destination = join(tmpdir(), `dsh-twp-pack-${process.pid}`)
mkdirSync(destination, { recursive: true })
const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', destination], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
if (packed.status !== 0) {
  console.error(JSON.stringify({ ok: false, reasonCode: 'RELEASE_PACK_FAILED', stdout: packed.stdout, stderr: packed.stderr }, null, 2))
  process.exit(1)
}
let packResult
try {
  const jsonStart = packed.stdout.lastIndexOf('\n[\n')
  packResult = JSON.parse(jsonStart >= 0 ? packed.stdout.slice(jsonStart + 1) : packed.stdout)[0]
} catch {
  console.error(JSON.stringify({ ok: false, reasonCode: 'RELEASE_PACK_OUTPUT_UNPARSEABLE', stdout: packed.stdout }, null, 2))
  process.exit(1)
}
const tarballPath = join(destination, packResult.filename)
const tarballBytes = readFileSync(tarballPath)
const artifactSha256 = sha256(tarballBytes)
const packageRoot = join(destination, 'package')
const extracted = spawnSync('tar', ['-xzf', tarballPath, '-C', destination], { encoding: 'utf8' })
if (extracted.status !== 0 || !existsSync(packageRoot)) {
  console.error(JSON.stringify({ ok: false, reasonCode: 'RELEASE_TARBALL_EXTRACT_FAILED', stdout: extracted.stdout, stderr: extracted.stderr }, null, 2))
  process.exit(1)
}
const installedBytesSha256 = directoryDigest(packageRoot)
const archivePath = join(artifactRoot, packResult.filename)
writeFileSync(archivePath, tarballBytes)
const manifest = {
  schemaVersion: 'tcrn.dsh-twp.release-artifact.v1',
  package: packageJson.name,
  version: packageJson.version,
  commit,
  tarball: archivePath,
  artifactSha256,
  installedBytesSha256,
  chainDigest: null,
  chainDigestStatus: '未证——归编排者链写 ceremony',
  publication: false,
  generatedBy: 'scripts/release-artifact.mjs',
}
const manifestPath = join(artifactRoot, 'release-artifact.json')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
rmSync(destination, { recursive: true, force: true })
console.log(JSON.stringify({ ok: true, reasonCode: 'RELEASE_ARTIFACT_READY', ...manifest, manifestPath }, null, 2))
