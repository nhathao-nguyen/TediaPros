// Offline diagnostic review, deliberately separate from the passing test suite.
// Exit 1 means at least one plan acceptance condition is violated; exit 2 is a runner failure.
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = mkdtempSync(join(tmpdir(), 'tedia-translation-review-'))
const output = join(scratch, 'probes.cjs')
const resultPath = join(repo, 'docs/reviews/2026-09-07-translation-implementation-probes.json')
try {
  await build({
    entryPoints: [join(repo, 'docs/reviews/fixtures/translation-implementation-probes.ts')],
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: output,
    plugins: [{
      name: 'review-only-instrumentation',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'review-mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'review-mock' }, () => ({
          loader: 'js', contents: `module.exports = {
            app: { getPath: () => process.env.TEDIAPROS_TEST_USER_DATA, getAppPath: () => process.cwd(), isPackaged: false, getName: () => 'tedia-review', getVersion: () => 'fixture' },
            safeStorage: { isEncryptionAvailable: () => false, encryptString: s => Buffer.from(s), decryptString: b => b.toString() },
            dialog: { showOpenDialog: async () => ({canceled:true,filePaths:[]}), showSaveDialog: async () => ({canceled:true}) },
            BrowserWindow: class {}, ipcMain: {handle(){},on(){}}, shell: {openExternal:async()=>{}}, protocol: {handle(){}}
          }`
        }))
        // Expose a private consumer only in the temporary bundle. Runtime source is untouched.
        builder.onLoad({ filter: /[\\/]src[\\/]main[\\/]autoshort\.ts$/ }, (args) => ({
          loader: 'ts', contents: readFileSync(args.path, 'utf8') + '\nexport { extractRephrasedTexts as reviewExtractRephrasedTexts };'
        }))
      }
    }]
  })
  const run = spawnSync(process.execPath, [output], {
    cwd: repo, env: { ...process.env, TEDIAPROS_TEST_USER_DATA: scratch }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
  })
  if (run.error || run.status !== 0) throw new Error(run.error?.message || run.stderr || run.stdout)
  const record = run.stdout.split(/\r?\n/).find((line) => line.startsWith('REVIEW_PROBES_JSON='))
  if (!record) throw new Error('Missing diagnostic result: ' + run.stdout)
  const evidence = JSON.parse(record.slice('REVIEW_PROBES_JSON='.length))
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
  process.exitCode = evidence.failed ? 1 : 0
} catch (error) {
  console.error(error)
  process.exitCode = 2
} finally {
  if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !basename(scratch).startsWith('tedia-translation-review-')) {
    throw new Error('Refusing cleanup outside the diagnostic temporary directory')
  }
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
