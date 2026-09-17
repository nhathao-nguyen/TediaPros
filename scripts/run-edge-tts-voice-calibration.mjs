import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

if (process.env.TEDIAPROS_EDGE_TTS_LIVE !== '1') {
  console.error('Refusing live Edge-TTS requests. Set TEDIAPROS_EDGE_TTS_LIVE=1 explicitly.')
  process.exit(2)
}

const root = mkdtempSync(join(tmpdir(), 'tedia-edge-calibration-'))
const outfile = join(root, 'worker.cjs')
const electronMockPlugin = {
  name: 'electron-mock',
  setup(buildInstance) {
    buildInstance.onResolve({ filter: /^electron$/ }, (args) => ({ path: args.path, namespace: 'electron-mock' }))
    buildInstance.onLoad({ filter: /.*/, namespace: 'electron-mock' }, () => ({
      contents: `
        const os = require('node:os');
        module.exports = {
          app: { getPath: () => process.env.TEDIAPROS_TEST_USER_DATA || os.tmpdir(), getAppPath: () => process.cwd(), isPackaged: false, getName: () => 'tedia-pros', getVersion: () => '0.1.26', isReady: () => true },
          safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
          dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
          BrowserWindow: class {}, ipcMain: { handle: () => {}, on: () => {} }, shell: { openExternal: async () => {} }, protocol: { handle: () => {} }
        };
      `,
      loader: 'js'
    }))
  }
}

try {
  await build({
    entryPoints: ['scripts/edge-tts-voice-calibration-worker.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    plugins: [electronMockPlugin]
  })
  const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  })
  process.exitCode = result.status ?? 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
