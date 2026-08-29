import { build } from 'esbuild'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const userDataDir = 'C:\\\\Users\\\\PC\\\\AppData\\\\Roaming\\\\tedia-pros'
const tempRunnerDir = join(process.cwd(), '.runner-staging')
if (existsSync(tempRunnerDir)) rmSync(tempRunnerDir, { recursive: true, force: true })
mkdirSync(tempRunnerDir, { recursive: true })

const runnerEntry = join(tempRunnerDir, 'job-entry.ts')
const runnerBundle = join(tempRunnerDir, 'job-bundle.cjs')

const jobCode = `
import { startAutoShortJob, getAutoShortReadiness } from '../src/main/autoshort'
import { resolveFfmpeg } from '../src/main/deps'
import { loadLocalKey, checkLocalTranslateKey } from '../src/main/localTranslate'
import { checkTtsServerHealth, getTtsModels } from '../src/main/tts'
import { AutoShortStartRequest } from '../src/shared/types'
import { join } from 'node:path'

async function debugPreflight() {
  console.log('[Debug] Checking dependencies step-by-step...')
  const ffmpeg = await resolveFfmpeg()
  console.log('[Debug] ffmpeg:', ffmpeg)

  const config = {
    subtitleMethod: 'whisper',
    whisperModel: 'small',
    whisperDevice: 'cpu',
    whisperLanguage: 'auto',
    ocrRegion: { x0: 0.05, y0: 0.75, x1: 0.95, y1: 0.93 },
    blurRegions: [],
    lamMo: false,
    subRegion: { x0: 0.05, y0: 0.78, x1: 0.95, y1: 0.92 },
    fontId: null,
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlinePx: 3,
    bgEnabled: false,
    bgColor: '#000000',
    bgOpacity: 0.7,
    subtitleDisplayStyle: 'word-highlight',
    subtitleFontSize: undefined,
    subtitleFontScale: undefined,
    highlightColor: '#FFE600',
    subtitleHighlightPop: true,
    subtitleLayoutProfile: 'vertical',
    subtitleAutoOptimize: true,
    outlineScale: 0.003,
    translateTarget: 'vi',
    translateProvider: 'local',
    translateServerUrl: 'http://127.0.0.1:8000',
    ttsEnabled: true,
    ttsServerUrl: 'http://127.0.0.1:8000',
    ttsModel: 'tts-vietnamese',
    ttsVoice: 'Minh Đức',
    ttsLanguage: 'vi',
    ttsSpeed: 1.0,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: 'C:\\\\Users\\\\PC\\\\Downloads\\\\test'
  } as any

  const readiness = await getAutoShortReadiness(config)
  console.log('[Debug] readiness:', readiness)

  const key = await loadLocalKey()
  console.log('[Debug] local key loaded:', key ? 'YES (' + key.slice(0, 10) + '...)' : 'NO')

  const transCheck = await checkLocalTranslateKey(config.translateServerUrl, key)
  console.log('[Debug] translate server check:', transCheck)

  const ttsHealth = await checkTtsServerHealth(config.ttsServerUrl, key)
  console.log('[Debug] tts health:', ttsHealth)

  const models = await getTtsModels(config.ttsServerUrl, key)
  console.log('[Debug] tts models count:', models.models?.length, models.error)

  console.log('[Debug] Ready to start job!')

  const request: AutoShortStartRequest = {
    config,
    items: [
      {
        id: 'task-test-1',
        filePath: 'C:\\\\Users\\\\PC\\\\Downloads\\\\test\\\\short-test.mp4'
      }
    ]
  }

  const result = startAutoShortJob(request, (event) => {
    if (event.type === 'item-progress') {
      console.log(\`[\${event.itemPercent.toFixed(1)}%] \${event.itemMessage}\`)
    } else if (event.type === 'item-done') {
      console.log('\\n[SUCCESS] Hoàn thành video:', JSON.stringify(event.result, null, 2))
      setTimeout(() => process.exit(0), 1000)
    } else if (event.type === 'item-error') {
      console.error('\\n[ERROR] Xử lý video thất bại:', event.result.error)
      setTimeout(() => process.exit(1), 1000)
    } else if (event.type === 'batch-done') {
      console.log('\\n[BATCH DONE]', JSON.stringify({ completed: event.completedCount, errorCount: event.errorCount }, null, 2))
    }
  })

  if (!result.ok) {
    console.error('[FATAL] Không thể khởi chạy job:', result.error)
    process.exit(1)
  }
}

debugPreflight().catch((err) => {
  console.error('[Debug error]', err)
  process.exit(1)
})
`

writeFileSync(runnerEntry, jobCode, 'utf8')

const electronMockPlugin = {
  name: 'electron-mock',
  setup(buildInstance) {
    buildInstance.onResolve({ filter: /^electron$/ }, (args) => ({
      path: args.path,
      namespace: 'electron-mock-ns'
    }))
    buildInstance.onLoad({ filter: /.*/, namespace: 'electron-mock-ns' }, () => ({
      contents: `
        const path = require('node:path');
        const os = require('node:os');
        const userData = '${userDataDir.replace(/\\/g, '\\\\')}';
        const appData = 'C:\\\\Users\\\\PC\\\\AppData\\\\Roaming';
        const projectRoot = '${process.cwd().replace(/\\/g, '\\\\')}';
        module.exports = {
          app: {
            getPath: (name) => {
              if (name === 'userData') return userData;
              if (name === 'appData') return appData;
              if (name === 'temp') return os.tmpdir();
              return userData;
            },
            getAppPath: () => projectRoot,
            isPackaged: false,
            getName: () => 'tedia-pros',
            getVersion: () => '0.1.20'
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

await build({
  entryPoints: [runnerEntry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: runnerBundle,
  sourcemap: false,
  plugins: [electronMockPlugin]
})

const child = spawn(process.execPath, [runnerBundle], { stdio: 'inherit' })
child.on('exit', (code) => {
  process.exit(code ?? 0)
})
