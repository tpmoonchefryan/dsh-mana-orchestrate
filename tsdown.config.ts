import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'

const ID = 'dsh-mana-orchestrate'
const CSS_VIRTUAL_PREFIX = '\u0000dsh-tcrn-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

interface CssModulePluginContext {
  addWatchFile(file: string): void
}

function styleInjectionModule(fileId: string, source: string, classMap: Readonly<Record<string, string>>): string {
  const tagId = `${ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(source)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
    '  const tag = document.createElement("style");',
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

function cssModulesPlugin() {
  return {
    name: 'dsh-tcrn-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const fileId = importer === undefined ? resolve(source) : resolve(dirname(importer), source)
      return `${CSS_VIRTUAL_PREFIX}${fileId}${CSS_VIRTUAL_SUFFIX}`
    },
    async load(this: CssModulePluginContext, virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX) || !virtualId.endsWith(CSS_VIRTUAL_SUFFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      if (!existsSync(fileId)) return null
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const result = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, value] of Object.entries(result.exports ?? {}) as Array<[string, { name: string }]>) {
        classMap[local] = value.name
      }
      return styleInjectionModule(fileId, result.code.toString(), classMap)
    },
  }
}

const host: UserConfig = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'neutral',
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: 'index.js' },
}

const client: UserConfig = {
  entry: ['src/client/index.ts'],
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  // The Host injects primitives as a separately styled surface. Bundling the
  // package here would pull its CSS-bearing markdown dependencies into this
  // plugin and bypass the Host's primitive identity.
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
  noExternal: () => true,
  plugins: [cssModulesPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [host, client]
