import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises'
import { startAutoShortJob } from '../src/main/autoshort'
import { parseSrt } from '../src/shared/subtitles'
import type { AutoShortConfig, AutoShortEvent } from '../src/shared/types'

app.setName('tedia-pros')
app.setPath('userData', join(app.getPath('appData'), 'tedia-pros'))

function runJob(config: AutoShortConfig, filePath: string, label: string, itemId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(`\n========================================`)
    console.log(`[AutoShort] Bắt đầu xử lý: ${label}`)
    console.log(`[AutoShort] Nguồn: ${filePath}`)
    console.log(`[AutoShort] Ngôn ngữ đích: ${config.translateTarget}, TTS: ${config.ttsModel} / ${config.ttsVoice}`)
    console.log(`========================================\n`)

    let completedOutput: string | undefined

    const request = {
      items: [{ id: itemId, filePath }],
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
            reject(new Error(`Batch thất bại: có ${event.errorCount} lỗi: ${event.results?.[0]?.error || 'unknown'}`))
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
    const sourceSrtFile = 'C:\\Users\\PC\\Downloads\\tediapros-source-audiotext-base\\test-30s.srt'
    const sourceAlignmentFile = 'C:\\Users\\PC\\Downloads\\tediapros-source-audiotext-base\\test-30s.alignment.json'

    console.log('[DEBUG] Khởi tạo AutoShort E2E test...')
    const { loadLocalKey, checkLocalTranslateKey } = await import('../src/main/localTranslate')
    const { checkTtsServerHealth, getTtsModels } = await import('../src/main/tts')

    const key = await loadLocalKey()
    console.log('[DEBUG] Key loaded. Length:', key.length)

    const trHealth = await checkLocalTranslateKey('http://127.0.0.1:8000', key)
    console.log('[DEBUG] Translate health:', trHealth)

    const ttsHealth = await checkTtsServerHealth('http://127.0.0.1:8000', key)
    console.log('[DEBUG] TTS health:', ttsHealth)

    const ttsModelsRes = await getTtsModels('http://127.0.0.1:8000', key)
    console.log('[DEBUG] TTS models count:', ttsModelsRes.models.length)
    if (ttsModelsRes.models.length > 0) {
      for (const m of ttsModelsRes.models) {
        console.log(` - Model: ${m.id} (${m.name}) | Voices: ${m.voices?.join(', ') || m.default_voice || 'none'}`)
      }
    }

    const defaultTtsModel = ttsModelsRes.models.find((m) => m.id === 'tts-vietnamese') || ttsModelsRes.models[0]
    const defaultVoice = defaultTtsModel?.default_voice || defaultTtsModel?.voices?.[0] || 'Mai Anh'

    // Pre-populate checkpoint with extracted source cues so extraction stage is recovered deterministically
    const itemId = `item-test-30s-${Date.now()}`
    const checkpointDir = join(app.getPath('userData'), 'autoshort-checkpoints', itemId)
    await mkdir(checkpointDir, { recursive: true })

    const srtContent = await readFile(sourceSrtFile, 'utf8')
    const parsedSrt = parseSrt(srtContent)
    const alignmentJson = JSON.parse(await readFile(sourceAlignmentFile, 'utf8'))

    // Build aligned cues with word timestamps
    const alignedCues = parsedSrt.cues.map((cue, idx) => {
      const seg = alignmentJson.segments?.[idx]
      return {
        id: cue.id || `cue-${idx}`,
        sourceIndex: cue.sourceIndex ?? idx + 1,
        start: cue.start,
        end: cue.end,
        text: cue.text,
        source: 'whisper' as const,
        words: seg?.words || []
      }
    })

    const checkpointData = {
      sourceCues: alignedCues,
      detectedSourceLanguage: 'zh'
    }
    await writeFile(join(checkpointDir, 'checkpoint.json'), JSON.stringify(checkpointData, null, 2), 'utf8')
    console.log(`[DEBUG] Checkpoint đã được khởi tạo tại ${checkpointDir} với ${alignedCues.length} cues nguồn.`)

    // Cấu hình Auto Short chuẩn
    const viConfig: AutoShortConfig = {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      whisperLanguage: 'zh',
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
      subtitleFontSize: 24,
      highlightColor: '#ffcc00',
      subtitleHighlightPop: false,
      subtitleLayoutProfile: 'readable',
      subtitleAutoOptimize: true,
      translateTarget: 'vi',
      translateProvider: 'local',
      translateServerUrl: 'http://127.0.0.1:8000',
      ttsEnabled: true,
      ttsServerUrl: 'http://127.0.0.1:8000',
      ttsModel: defaultTtsModel?.id || 'tts-vietnamese',
      ttsVoice: 'Mai Anh',
      ttsLanguage: 'vi',
      ttsSpeed: 1.0,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 0,
      outputDir
    }

    const rawVi = await runJob(viConfig, inputFile, 'Auto Short Tiếng Việt', itemId)
    const finalViOutput = join(outputDir, 'test-30s-ket-qua-tieng-viet.mp4')
    await copyFile(rawVi, finalViOutput)

    console.log(`\n========================================`)
    console.log(`>>> TẠO VIDEO THÀNH CÔNG: ${finalViOutput}`)
    console.log(`========================================\n`)

    // Print summary of generated artifacts
    const auditDirPattern = `.autoshort-audit-`
    const { readdir } = await import('node:fs/promises')
    const outFiles = await readdir(outputDir)
    const auditDirs = outFiles.filter((f) => f.startsWith(auditDirPattern))
    if (auditDirs.length > 0) {
      const latestAuditDir = join(outputDir, auditDirs[auditDirs.length - 1])
      console.log(`[DEBUG] Audit directory: ${latestAuditDir}`)
      const auditFiles = await readdir(latestAuditDir)
      console.log('[DEBUG] Artifact files generated:', auditFiles)

      if (auditFiles.includes('dubbing-units.json')) {
        const units = JSON.parse(await readFile(join(latestAuditDir, 'dubbing-units.json'), 'utf8'))
        console.log(`\n=== TỔNG KẾT ĐỒNG BỘ CUE-BY-CUE (${units.length} UNITS) ===`)
        console.log('Unit | Spoken Text | Voice Time | Subtitle Cues')
        console.log('----------------------------------------------------')
        for (let i = 0; i < units.length; i++) {
          const u = units[i]
          const subInfo = u.subtitles?.map((s: any) => `[${s.start.toFixed(2)}-${s.end.toFixed(2)}: "${s.text}"]`).join(', ') || 'N/A'
          console.log(`${i + 1} | "${u.finalSpokenText}" | ${u.plannedStart.toFixed(2)}s -> ${u.plannedEnd.toFixed(2)}s | ${subInfo}`)
        }
      }
    }

    app.quit()
    process.exit(0)
  } catch (error) {
    console.error('[AutoShort Pipeline Error]:', error)
    app.quit()
    process.exit(1)
  }
})
