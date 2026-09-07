import { app } from 'electron'
import { basename, isAbsolute, resolve, join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

function parseCliArgs(argv: string[]) {
  const values: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const val = argv[i + 1]
      if (val && !val.startsWith('--')) {
        values[key] = val
        i++
      } else {
        values[key] = 'true'
      }
    }
  }
  return values
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const args = parseCliArgs(rawArgs)

  const operation = args['operation'] || 'render'
  const userDataDir = args['user-data']
  if (!userDataDir || !isAbsolute(userDataDir)) {
    throw new Error('--user-data must be an absolute path')
  }

  // Set userData path BEFORE importing any other Main modules
  app.setPath('userData', resolve(userDataDir))

  const fixtureDir = resolve(args['fixture-dir'] || '')
  const outputRoot = resolve(args['output-dir'] || '')
  const ffmpegPath = args['ffmpeg'] ? resolve(args['ffmpeg']) : ''
  const ffprobePath = args['ffprobe'] ? resolve(args['ffprobe']) : ''
  const ocrEnginePath = args['ocr-engine'] ? resolve(args['ocr-engine']) : ''
  const profile = (args['profile'] || 'accurate') as 'accurate' | 'fast'
  const runtimeReleaseDir = args['runtime-release-dir'] ? resolve(args['runtime-release-dir']) : ''

  if (operation === 'render') {
    const { createAutoShortItemProcessor } = await import('../src/main/autoShortItemCoordinator')
    const { writeTimedOcrBlurMask } = await import('../src/main/ocrMask')
    const { burnAutoShort, probeBurnMedia } = await import('../src/main/burn')
    const { ocrVideoWithVisualTimeline } = await import('../src/main/ocr')
    const { reserveVideoTitleOutputDir } = await import('../src/main/videoTitle')
    const { spawnSync } = await import('node:child_process')

    await mkdir(outputRoot, { recursive: true })

    const sourceVideo = join(fixtureDir, 'source.mp4')
    const fixtureJson = JSON.parse(await readFile(join(fixtureDir, 'fixture.json'), 'utf8'))
    const timelineJson = JSON.parse(await readFile(join(fixtureDir, 'timeline.json'), 'utf8'))
    const itemOutputDir = await reserveVideoTitleOutputDir(outputRoot, basename(sourceVideo))
    const itemAuditDir = join(itemOutputDir, `.autoshort-audit-acceptance-${profile}-acceptance-item`)

    const t0 = Date.now()
    let visualOcrCalls = 0

    const deps = {
      resolveFfmpeg: async () => ffmpegPath,
      resolveFfprobe: async () => ffprobePath,
      probeMedia: async (vid: string) => {
        const res = spawnSync(ffprobePath, [
          '-v', 'error',
          '-show_entries', 'stream=index,codec_type,width,height,start_time,duration,r_frame_rate,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation',
          '-show_entries', 'format=duration,start_time',
          '-of', 'json',
          vid
        ], { encoding: 'utf8', windowsHide: true })
        const parsed = JSON.parse(res.stdout)
        const { parseCanonicalMediaMetadata } = await import('../src/main/canonicalDisplayGeometry')
        return parseCanonicalMediaMetadata(parsed)
      },
      runVisualOcr: async (opts: any, onProgress: any) => {
        visualOcrCalls++
        if (ocrEnginePath) {
          return ocrVideoWithVisualTimeline({
            ...opts,
            engineExecutable: ocrEnginePath,
            ffmpegExecutable: ffmpegPath
          }, onProgress)
        }
        return {
          timeline: timelineJson,
          sourceSrtPath: join(outputRoot, 'injected.srt'),
          sidecarPath: join(outputRoot, 'injected-visual-cues.json'),
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: timelineJson.segments.length,
          boxSegmentCount: timelineJson.segments.reduce((acc: number, s: any) => acc + s.boxes.length, 0)
        }
      },
      writeTimedMask: writeTimedOcrBlurMask,
      burn: burnAutoShort
    }

    const processor = createAutoShortItemProcessor(deps)

    const workDir = join(outputRoot, 'work')
    const cpDir = join(outputRoot, 'checkpoint')
    const auditDir = itemAuditDir

    const context = {
      jobId: `acceptance-${profile}`,
      request: {
        items: [{ id: 'acceptance-item', filePath: sourceVideo }],
        config: {
          subtitleMethod: 'ocr' as const,
          whisperModel: 'base',
          whisperDevice: 'cpu' as const,
          ocrRegion: {
            x0: fixtureJson.ocrRegion.x0 / fixtureJson.canvas.width,
            y0: fixtureJson.ocrRegion.y0 / fixtureJson.canvas.height,
            x1: fixtureJson.ocrRegion.x1 / fixtureJson.canvas.width,
            y1: fixtureJson.ocrRegion.y1 / fixtureJson.canvas.height
          },
          ocrBlurProfile: profile,
          blurRegions: [],
          lamMo: true,
          blurMode: 'ocr-auto' as const,
          translateTarget: 'none',
          translateProvider: 'local' as const,
          ttsEnabled: false,
          voiceOverMode: false,
          batAmThanh: false,
          amLuongGoc: 100,
          outputDir: outputRoot
        }
      },
      item: { id: 'acceptance-item', filePath: sourceVideo },
      index: 0,
      total: 1,
      signal: new AbortController().signal,
      emit: () => {},
      checkpointDir: cpDir,
      workDir,
      artifactDir: auditDir,
      itemOutputDir,
      separationProviderState: { mode: 'auto' as const }
    }

    const result = await processor(context)
    const durationMs = Date.now() - t0

    if (result.status !== 'done' || !result.outputPath) {
      console.log(JSON.stringify({
        status: 'error',
        operation: 'render',
        profile,
        error: result.error || 'render failed',
        durationMs
      }))
      app.exit(1)
      return
    }

    console.log(JSON.stringify({
      status: 'done',
      operation: 'render',
      profile,
      finalPath: result.outputPath,
      visualOcrCalls,
      durationMs
    }))
    app.exit(0)
    return
  }

  if (operation === 'install-readiness') {
    const { downloadRuntimeEngineFromManifest } = await import('../src/main/runtimeInstaller')
    const { getAutoShortReadiness } = await import('../src/main/autoshort')

    const manifestFile = join(runtimeReleaseDir, 'runtime-manifest.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))

    // Local fetch hook serving files directly from release dir
    const localFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString()
      const fileName = urlStr.split('/').pop() || ''
      const targetFile = join(runtimeReleaseDir, fileName)
      const data = await readFile(targetFile)
      return new Response(data, { status: 200 })
    }

    // Install ffmpeg and ocr-engine
    await downloadRuntimeEngineFromManifest('ffmpeg', () => {}, {
      fetch: localFetch as any
    })
    await downloadRuntimeEngineFromManifest('ocr-engine', () => {}, {
      fetch: localFetch as any
    })

    const readiness = await getAutoShortReadiness({
      subtitleMethod: 'ocr',
      lamMo: true,
      blurMode: 'ocr-auto'
    })

    console.log(JSON.stringify({
      status: 'done',
      operation: 'install-readiness',
      readiness
    }))
    app.exit(0)
    return
  }

  throw new Error(`Unknown operation: ${operation}`)
}

main().catch((err) => {
  console.log(JSON.stringify({
    status: 'error',
    error: err?.message || String(err)
  }))
  app.exit(1)
})
