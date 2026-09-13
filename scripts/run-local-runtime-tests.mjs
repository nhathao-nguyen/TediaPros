import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Independent runs must not delete one another's compiled test fixtures.
const outDir = mkdtempSync(join(tmpdir(), 'tedia-local-runtime-tests-'))
const outFile = join(outDir, 'local-runtime.test.cjs')

const electronMockPlugin = {
  name: 'electron-mock',
  setup(buildInstance) {
    buildInstance.onResolve({ filter: /^electron$/ }, (args) => ({
      path: args.path,
      namespace: 'electron-mock-ns'
    }))
    buildInstance.onLoad({ filter: /.*/, namespace: 'electron-mock-ns' }, () => ({
      contents: `
        const os = require('node:os');
        module.exports = {
          app: {
            getPath: () => process.env.TEDIAPROS_TEST_USER_DATA || os.tmpdir(),
            getAppPath: () => process.cwd(),
            isPackaged: false,
            getName: () => 'tedia-pros',
            getVersion: () => '0.1.22'
          },
          safeStorage: {
            isEncryptionAvailable: () => false,
            encryptString: (s) => Buffer.from(s),
            decryptString: (b) => b.toString()
          },
          dialog: {
            showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
            showSaveDialog: async () => ({ canceled: true })
          },
          BrowserWindow: class {},
          ipcMain: { handle: () => {}, on: () => {} },
          shell: { openExternal: async () => {} },
          protocol: { handle: () => {} }
        };
      `,
      loader: 'js'
    }))
  }
}

const knownTests = [
  'edge-tts-contract.test',
  'edge-tts-adapter.test',
  'autoshort-edge-tts.test',
  'tts-audio-format.test',
  'app-profile.test',
  'sttn-runtime.test',
  'sttn-contract.test',
  'sttn-pipeline.test',
  'local-runtime.test',
  'canonical-runtime-migration.test',
  'e2e-autoshort.test',
  'release-tooling.test',
  'dubbing-plan.test',
  'dubbing-duration-profile.test',
  'dubbing-retime.test',
  'dubbing-grouping.test',
  'local-translation.test',
  'separator-contract.test',
  'separator-runtime.test',
  'separator-pipeline.test',
  'autoshort-ocr-contract.test',
  'autoshort-subtitle-placement.test',
  'canonical-display-geometry.test',
  'portrait-blur.test',
  'video-adjustments.test',
  'autoshort-overlays.test',
  'ocr-visual-timeline.test',
  'autoshort-ocr-runtime.test',
  'ocr-mask.test',
  'autoshort-ocr-burn.test',
  'video-title.test',
  'video-seo.test',
  'ai-output.test',
  'burn-video-title.test',
  'autoshort-title-overlap.test',
  'autoshort-video-title.test',
  'autoshort-ocr-pipeline.test',
  'autoshort-telemetry.test',
  'log-retention.test',
  'autoshort-batch-store.test',
  'autoshort-batch-resume.test',
  'autoshort-tts-pipeline.test',
  'autoshort-tts-cache.test',
  'autoshort-disk-budget.test',
  'autoshort-resource-manager.test',
  'autoshort-resource-lifecycle.test',
  'autoshort-stage-scheduling.test',
  'autoshort-artifact-cache.test',
  'autoshort-stage-cache.test',
  'autoshort-trim-cache.test',
  'autoshort-benchmark.test',
  'autoshort-content-quality.test',
  'content-quality-numerals.test',
  'autoshort-publication-timeline.test',
  'translation-response.test',
  'translation-prompts.test',
  'translation-rephrase.test',
  'translation-budget.test',
  'translation-planner.test',
  'translation-language.test',
  'translation-orchestrator.test',
  'translation-provider-contract.test',
  'gemini-keys.test',
  'translation-transport.test',
  'translation-identity.test',
  'translation-resume.test',
  'translation-multilingual.test',
  'translation-qualification.test',
  'autoshort-ui-contract.test',
  'autoshort-temporal-edit-contract.test',
  'autoshort-cut-media.test',
  'autoshort-cut-capability.test',
  'autoshort-cut-editor.test',
  'autoshort-cut-v2-contract.test',
  'autoshort-cut-legacy-resume.test',
  'autoshort-frame-index.test',
  'autoshort-cut-plan.test',
  'autoshort-cut-resources.test',
  'autoshort-cut-cache.test',
  'autoshort-cut-validation.test',
  'autoshort-cut-pipeline.test',
  'autoshort-cut-cues.test',
  'autoshort-region-geometry.test',
  'autoshort-queue-throughput.test',
  'autoshort-item-scope.test',
  'standalone-engine-results.test',
  'ipc-origin-validation.test'
]

const requestedTests = process.argv.slice(2).map((name) => name.replace(/\.(ts|js)$/, ''))
const selectedTests = requestedTests.length > 0 ? requestedTests : knownTests
for (const testName of selectedTests) {
  if (!knownTests.includes(testName)) throw new Error(`Unknown local-runtime test: ${testName}`)
}

await build({
  entryPoints: selectedTests.map((testName) => `tests/${testName}.ts`),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: outDir,
  sourcemap: false,
  plugins: [electronMockPlugin]
})

const results = selectedTests.map((testName) =>
  spawnSync(process.execPath, ['--test', join(outDir, `${testName}.js`)], { stdio: 'inherit' })
)
rmSync(outDir, { recursive: true, force: true })
if (results.some((result) => result.status !== 0)) process.exit(1)
