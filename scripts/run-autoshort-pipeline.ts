import { app } from 'electron'
import { join } from 'node:path'
import { startAutoShortJob } from '../src/main/autoshort'
import type { AutoShortConfig, AutoShortEvent } from '../src/shared/types'

app.setName('tedia-pros')
app.setPath('userData', join(app.getPath('appData'), 'tedia-pros'))

function runJob(config: AutoShortConfig, filePath: string, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`\n========================================`)
    console.log(`[AutoShort] Bắt đầu xử lý: ${label}`)
    console.log(`[AutoShort] Nguồn: ${filePath}`)
    console.log(`[AutoShort] Ngôn ngữ đích: ${config.translateTarget}, TTS: ${config.ttsModel} / ${config.ttsVoice}`)
    console.log(`========================================\n`)

    let completedOutput: string | undefined

    const request = {
      items: [{ id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, filePath }],
      config
    }

    const onEvent = (event: AutoShortEvent): void => {
      try {
        if (event.type === 'item-progress') {
          const pct = typeof event.percent === 'number' ? `${event.percent.toFixed(1)}%` : ''
          console.log(`[${label}][${event.phase}] ${pct} - ${event.message}`)
        } else if (event.type === 'item-done') {
          console.log(`[${label}][DONE] Hoàn tất: ${event.outputPath}`)
          if (event.result.status === 'done' && event.result.outputPath) {
            completedOutput = event.result.outputPath
          }
        } else if (event.type === 'batch-done') {
          if (event.errorCount === 0 && completedOutput) {
            resolve(completedOutput)
          } else {
            console.error(`[${label}] Batch error:`, event.results)
            reject(new Error(`Batch thất bại: có ${event.errorCount} lỗi`))
          }
        }
      } catch (err) {
        console.error(`[${label}] onEvent error:`, err)
      }
    }

    const startRes = startAutoShortJob(request, onEvent)
    if (!startRes.ok) {
      reject(new Error(`Không thể bắt đầu Auto Short: ${startRes.error}`))
    }
  })
}

app.whenReady().then(async () => {
  try {
    const inputFile = 'C:\\Users\\PC\\Downloads\\test\\test-30s.mp4'
    const outputDir = 'C:\\Users\\PC\\Downloads\\test'

    console.log('[DEBUG] Checking readiness...')
    const { getAutoShortReadiness, installAutoShortDependencies } = await import('../src/main/autoshort')
    const { loadLocalKey, checkLocalTranslateKey } = await import('../src/main/localTranslate')
    const { checkTtsServerHealth, getTtsModels } = await import('../src/main/tts')
    const { whisperModelStatus } = await import('../src/main/whisper')

    const baseStatus = await whisperModelStatus('base')
    const smallStatus = await whisperModelStatus('small')
    const mediumStatus = await whisperModelStatus('medium')
    console.log('[DEBUG] Base model:', baseStatus)
    console.log('[DEBUG] Small model:', smallStatus)
    console.log('[DEBUG] Medium model:', mediumStatus)

    const chosenModel = smallStatus.complete ? 'small' : mediumStatus.complete ? 'medium' : baseStatus.complete ? 'base' : 'base'
    console.log('[DEBUG] Chosen model:', chosenModel)

    let r = await getAutoShortReadiness({ subtitleMethod: 'whisper', whisperModel: chosenModel, whisperDevice: 'cpu' })
    if (!r.ready) {
      console.log('[DEBUG] Installing missing dependencies...')
      r = await installAutoShortDependencies({ subtitleMethod: 'whisper', whisperModel: chosenModel, whisperDevice: 'cpu' }, (p) => {
        console.log(`[DEP][${p.id}] ${p.phase} ${p.percent}% - ${p.message}`)
      })
      console.log('[DEBUG] Dependencies ready:', r.ready)
    }

    const key = await loadLocalKey()
    console.log('[DEBUG] Key loaded:', Boolean(key), 'key length:', key?.length)

    const trHealth = await checkLocalTranslateKey('http://127.0.0.1:8000', key)
    console.log('[DEBUG] Translate health:', trHealth)

    const ttsHealth = await checkTtsServerHealth('http://127.0.0.1:8000', key)
    console.log('[DEBUG] TTS health:', ttsHealth)

    const ttsModels = await getTtsModels('http://127.0.0.1:8000', key)
    console.log('[DEBUG] TTS models:', ttsModels)

    // 1. Bản Tiếng Việt
    const viConfig: AutoShortConfig = {
      subtitleMethod: 'whisper',
      whisperModel: chosenModel,
      whisperDevice: 'cpu',
      whisperLanguage: 'auto',
      ocrRegion: null,
      blurRegions: [],
      lamMo: false,
      subRegion: null,
      fontId: 'auto',
      textColor: '#ffffff',
      outlineColor: '#000000',
      outlinePx: 3,
      bgEnabled: false,
      bgColor: '#000000',
      bgOpacity: 0.8,
      subtitleDisplayStyle: 'standard',
      subtitleFontSize: 48,
      highlightColor: '#ffcc00',
      subtitleHighlightPop: false,
      subtitleLayoutProfile: 'vertical',
      subtitleAutoOptimize: true,
      translateTarget: 'vi',
      translateProvider: 'local',
      translateServerUrl: 'http://127.0.0.1:8000',
      ttsEnabled: true,
      ttsServerUrl: 'http://127.0.0.1:8000',
      ttsModel: 'tts-vietnamese',
      ttsVoice: 'Mai Anh',
      ttsLanguage: 'vi',
      ttsSpeed: 1.0,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 0,
      outputDir
    }

    let viOutput = 'C:\\Users\\PC\\Downloads\\test\\test-30s-tieng-viet.mp4'
    const fs = await import('node:fs/promises')

    const rawVi = await runJob(viConfig, inputFile, 'Bản Tiếng Việt')
    await fs.rename(rawVi, viOutput).catch(async () => {
      await fs.copyFile(rawVi, viOutput)
    })
    console.log(`\n>>> XUẤT THÀNH CÔNG BẢN TIẾNG VIỆT: ${viOutput}\n`)

    // Wait a brief moment between jobs
    await new Promise((r) => setTimeout(r, 1000))

    // 2. Bản Tiếng Anh
    const enConfig: AutoShortConfig = {
      subtitleMethod: 'whisper',
      whisperModel: chosenModel,
      whisperDevice: 'cpu',
      whisperLanguage: 'auto',
      ocrRegion: null,
      blurRegions: [],
      lamMo: false,
      subRegion: null,
      fontId: 'auto',
      textColor: '#ffffff',
      outlineColor: '#000000',
      outlinePx: 3,
      bgEnabled: false,
      bgColor: '#000000',
      bgOpacity: 0.8,
      subtitleDisplayStyle: 'standard',
      subtitleFontSize: 48,
      highlightColor: '#ffcc00',
      subtitleHighlightPop: false,
      subtitleLayoutProfile: 'vertical',
      subtitleAutoOptimize: true,
      translateTarget: 'en',
      translateProvider: 'local',
      translateServerUrl: 'http://127.0.0.1:8000',
      ttsEnabled: true,
      ttsServerUrl: 'http://127.0.0.1:8000',
      ttsModel: 'tts-multilingual',
      ttsVoice: 'default',
      ttsLanguage: 'en',
      ttsSpeed: 1.0,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 0,
      outputDir
    }

    const rawEn = await runJob(enConfig, inputFile, 'Bản Tiếng Anh')
    const enOutput = 'C:\\Users\\PC\\Downloads\\test\\test-30s-tieng-anh.mp4'
    await fs.rename(rawEn, enOutput).catch(async () => {
      await fs.copyFile(rawEn, enOutput)
    })
    console.log(`\n>>> XUẤT THÀNH CÔNG BẢN TIẾNG ANH: ${enOutput}\n`)

    console.log('\n========================================')
    console.log('HOÀN TẤT CẢ 2 BẢN VIDEO:')
    console.log('1. Tiếng Việt:', viOutput)
    console.log('2. Tiếng Anh:', enOutput)
    console.log('========================================\n')

    app.quit()
    process.exit(0)
  } catch (error) {
    console.error('[AutoShort Pipeline Error]:', error)
    app.quit()
    process.exit(1)
  }
})
