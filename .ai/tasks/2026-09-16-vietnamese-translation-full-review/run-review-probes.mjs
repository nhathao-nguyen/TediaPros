import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'tedia-review-20260916-'))
const out = join(scratch, 'review-probes.cjs')
await build({
  entryPoints: [join(here, 'review-probes.ts')], outfile: out, bundle: true, platform: 'node', format: 'cjs',
  external: ['typescript'],
  plugins: [{ name: 'review-electron-mock', setup(instance) {
    instance.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'review-mock' }))
    instance.onLoad({ filter: /.*/, namespace: 'review-mock' }, () => ({
      contents: `module.exports = { app: { getPath: () => process.env.TEDIAPROS_TEST_USER_DATA, getAppPath: () => process.cwd(), isPackaged: false } };`
    }))
  } }]
})
const child = spawnSync(process.execPath, ['--test', out], {
  cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
  env: { ...process.env, TEDIAPROS_TEST_USER_DATA: join(scratch, 'profile'), NODE_PATH: join(process.cwd(), 'node_modules') }
})
const evidence = `Diagnostic probes: PASS reproduces a defect; it does not assert production correctness.\nScratch: ${scratch}\n${child.stdout || ''}${child.stderr || ''}\nExit: ${child.status}\n`
writeFileSync(join(here, 'probe-results.txt'), evidence, 'utf8')
process.stdout.write(evidence)
if (child.error) console.error(child.error)
process.exitCode = child.status ?? 1
