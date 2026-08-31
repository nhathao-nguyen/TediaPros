import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises'
import { startAutoShortJob, getAutoShortReadiness, installAutoShortDependencies } from '../src/main/autoshort'
import { saveLocalKey, loadLocalKey, checkLocalTranslateKey } from '../src/main/localTranslate'
import { checkTtsServerHealth, getTtsModels } from '../src/main/tts'
import { probeBurnMedia } from '../src/main/burn'
import type { AutoShortConfig, AutoShortEvent } from '../src/shared/types'

app.setName('tedia-pros')
app.setPath('userData', join(app.getPath('appData'), 'tedia-pros'))

const USER_API_KEY = 'ai_sk_lauI0AikWJNcDPIsDC3MicpukDRcaK8vg6F5DxX4m7c'
const INPUT_FILE = 'C:\\Users\\PC\\Downloads\\test\\short-test.mp4'
const OUTPUT_DIR = 'C:\\Users\\PC\\Downloads\\test'

function runJob(config: AutoShortConfig, filePath: string, label: string, itemId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`\n============================================================`)
    console.log(`[AutoShort Real Test] Bắt đầu xử lý: ${label}`)
    console.log(`[AutoShort Real Test] Nguồn: ${filePath}`)
    console.log(`[AutoShort Real Test] Subtitle Method: ${config.subtitleMethod}, Whisper Model: ${config.whisperModel}`)
    console.log(`[AutoShort Real Test] Dịch: ${config.translateTarget} qua ${config.translateProvider} (${config.translateServerUrl})`)
    console.log(`[AutoShort Real Test] TTS: ${config.ttsModel} / Voice: ${config.ttsVoice}`)
    console.log(`============================================================\n`)

    let completedOutput: string | undefined

    const request = {
      items: [{ id: itemId, filePath }],
      config
    }

    const onEvent = (event: AutoShortEvent): void => {
      try {
        if (event.type === 'item-progress') {
          const pct = typeof event.itemPercent === 'number' ? `${event.itemPercent}%` : ''
          console.log(`[${label}][${event.itemStatus}] ${pct} - ${event.itemMessage}`)
        } else if (event.type === 'item-done') {
          console.log(`\n>>> [${label}][ITEM DONE] Hoàn thành: ${event.result.outputPath}`)
          if (event.result.status === 'done' && event.result.outputPath) {
            completedOutput = event.result.outputPath
          }
        } else if (event.type === 'item-error') {
          console.error(`\n>>> [${label}][ITEM ERROR]:`, event.result.error)
        } else if (event.type === 'batch-done') {
          if (event.errorCount === 0 && completedOutput) {
            resolve(completedOutput)
          } else {
            console.error(`\n>>> [${label}][BATCH ERROR]:`, event.results)
            reject(new Error(`Batch thất bại với ${event.errorCount} lỗi: ${event.results?.[0]?.error || 'unknown'}`))
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
    console.log('[1/5] Khởi tạo môi trường & Lưu API Key...')
    await saveLocalKey(USER_API_KEY)
    const savedKey = await loadLocalKey()
    console.log(` - API Key đã lưu thành công (độ dài: ${savedKey.length})`)

    console.log('\n[2/5] Kiểm tra kết nối AI Server (http://127.0.0.1:8000)...')
    const translateHealth = await checkLocalTranslateKey('http://127.0.0.1:8000', savedKey)
    console.log(' - Translate Server status:', translateHealth)

    const ttsHealth = await checkTtsServerHealth('http://127.0.0.1:8000', savedKey)
    console.log(' - TTS Server status:', ttsHealth)

    const ttsModelsRes = await getTtsModels('http://127.0.0.1:8000', savedKey)
    console.log(` - TTS Models count: ${ttsModelsRes.models.length}`)
    for (const m of ttsModelsRes.models) {
      console.log(`   * [${m.id}] ${m.name} | default voice: ${m.default_voice || 'none'} | available: ${m.available}`)
    }

    const targetTtsModel = ttsModelsRes.models.find((m) => m.id === 'tts-vietnamese') || ttsModelsRes.models[0]
    const targetVoice = targetTtsModel?.voices?.includes('Mai Anh') ? 'Mai Anh' : (targetTtsModel?.default_voice || 'Adam')

    console.log('\n[3/5] Kiểm tra file video nguồn & metadata...')
    const videoStat = await stat(INPUT_FILE).catch(() => null)
    if (!videoStat || videoStat.size <= 0) {
      throw new Error(`Không tìm thấy file video nguồn: ${INPUT_FILE}`)
    }
    const meta = await probeBurnMedia(INPUT_FILE)
    console.log(` - File: ${INPUT_FILE} (${(videoStat.size / 1024 / 1024).toFixed(2)} MB)`)
    console.log(` - Resolution: ${meta.w}x${meta.h}, Duration: ${meta.giay.toFixed(2)}s, FPS: ${meta.frameRate}`)

    console.log('\n[4/5] Kiểm tra Readiness của AutoShort dependencies...')
    const initialConfig: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperModel' | 'whisperDevice'> = {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu'
    }
    let readiness = await getAutoShortReadiness(initialConfig)
    console.log(' - Dependencies readiness:', readiness.ready, readiness.message || '')
    for (const dep of readiness.dependencies) {
      console.log(`   * ${dep.label} (${dep.id}): ${dep.ready ? 'SẴN SÀNG' : 'CHƯA CÓ'} ${dep.message ? `(${dep.message})` : ''}`)
    }

    if (!readiness.ready) {
      console.log('\n>>> Đang tự động tải các dependencies còn thiếu...')
      await installAutoShortDependencies(initialConfig, (p) => {
        console.log(` [Tải dependency: ${p.id}] ${p.phase} ${p.percent}% - ${p.message}`)
      })
      readiness = await getAutoShortReadiness(initialConfig)
      console.log(' - Sau khi cài đặt, readiness:', readiness.ready)
    }

    console.log('\n[5/5] Chạy thực tế Pipeline AutoShort (Full Real Workflow)...')
    const config: AutoShortConfig = {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      whisperLanguage: 'auto',
      ocrRegion: null,
      blurRegions: [],
      lamMo: false,
      subRegion: { x0: 0.05, x1: 0.95, y0: 0.42, y1: 0.58 },
      fontId: 'auto',
      textColor: '#ffffff',
      outlineColor: '#000000',
      outlinePx: 3,
      bgEnabled: false,
      bgColor: '#000000',
      bgOpacity: 0.8,
      subtitleDisplayStyle: 'standard',
      subtitleFontSize: 28,
      highlightColor: '#ffcc00',
      subtitleHighlightPop: false,
      subtitleLayoutProfile: 'readable',
      subtitleAutoOptimize: true,
      translateTarget: 'vi',
      translateProvider: 'local',
      translateServerUrl: 'http://127.0.0.1:8000',
      ttsEnabled: true,
      ttsServerUrl: 'http://127.0.0.1:8000',
      ttsModel: targetTtsModel?.id || 'tts-vietnamese',
      ttsVoice: targetVoice,
      ttsLanguage: 'vi',
      ttsSpeed: 1.0,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 0,
      outputDir: OUTPUT_DIR
    }

    const itemId = `real-test-30s-${Date.now()}`
    const resultVideoPath = await runJob(config, INPUT_FILE, 'E2E Real AutoShort', itemId)

    const finalTargetOutput = join(OUTPUT_DIR, 'test-30s-ket-qua-tieng-viet.mp4')
    await copyFile(resultVideoPath, finalTargetOutput)

    console.log(`\n============================================================`)
    console.log(`>>> TẠO VIDEO THÀNH CÔNG: ${finalTargetOutput}`)
    console.log(`============================================================\n`)

    const finalMeta = await probeBurnMedia(finalTargetOutput)
    console.log('=== KIỂM TRA THÔNG SỐ VIDEO ĐẦU RA ===')
    console.log(`- Dung lượng: ${((await stat(finalTargetOutput)).size / 1024 / 1024).toFixed(2)} MB`)
    console.log(`- Độ phân giải: ${finalMeta.w}x${finalMeta.h}`)
    console.log(`- Thời lượng video: ${finalMeta.videoDuration.toFixed(2)}s`)
    console.log(`- Thời lượng audio: ${finalMeta.audioDuration.toFixed(2)}s`)
    console.log(`- Có âm thanh: ${finalMeta.hasAudio}`)
    console.log(`- Tốc độ khung hình: ${finalMeta.frameRate} fps`)

    app.quit()
    process.exit(0)
  } catch (error) {
    console.error('\n[LỖI TEST THỰC TẾ]:', error)
    app.quit()
    process.exit(1)
  }
})
