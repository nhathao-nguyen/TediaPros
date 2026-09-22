import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAutoShortThumbnail,
  extractProminentOcrRegion,
  calculateThumbnailFontSize,
  generateThumbnailAssDocument,
  resolveThumbnailStyle,
  resolveUniqueThumbnailFilename,
  THUMBNAIL_STYLES,
  type AutoShortThumbnailHooks
} from '../src/main/autoShortThumbnail'
import type { OcrVisualTimeline } from '../src/shared/types'

const geometry = {
  codedWidth: 1080,
  codedHeight: 1920,
  rotation: 0 as const,
  sampleAspectRatio: { numerator: 1, denominator: 1 },
  videoStart: 0,
  displayWidth: 1080,
  displayHeight: 1920,
  fingerprint: 'f'.repeat(64)
}

const timelineWithText: OcrVisualTimeline = {
  schemaVersion: 1,
  protocol: 'ocr-visual-cues/1',
  profile: 'accurate',
  video: {
    width: 1080,
    height: 1920,
    durationSeconds: 1.2,
    sampleFps: 8,
    frameCount: 10,
    geometryFingerprint: geometry.fingerprint
  },
  scanRegion: { x0: 0, y0: 1400, x1: 1080, y1: 1800 },
  segments: [
    {
      id: 'seg-1',
      startFrame: 0,
      endFrameExclusive: 8,
      start: 0,
      end: 1,
      text: 'Sample subtitle',
      confidence: 0.95,
      boxes: [{ text: 'Sample subtitle', confidence: 0.95, x0: 100, y0: 1500, x1: 980, y1: 1600 }]
    }
  ]
}

const timelineEmpty: OcrVisualTimeline = {
  schemaVersion: 1,
  protocol: 'ocr-visual-cues/1',
  profile: 'accurate',
  video: {
    width: 1080,
    height: 1920,
    durationSeconds: 1.2,
    sampleFps: 8,
    frameCount: 10,
    geometryFingerprint: geometry.fingerprint
  },
  scanRegion: { x0: 0, y0: 1400, x1: 1080, y1: 1800 },
  segments: []
}

test('createAutoShortThumbnail creates first_frame thumbnail with STTN cleaning when text is found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-thumb-test-'))
  try {
    const videoPath = join(root, 'video1.mp4')
    const outputDir = join(root, 'output')
    await writeFile(videoPath, 'fake-video-content')
    await mkdir(outputDir, { recursive: true })

    const events: string[] = []
    const progressLog: Array<{ percent: number; message: string }> = []

    const hooks: AutoShortThumbnailHooks = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      resolveSttnEngine: async () => 'sttn.exe',
      resolveSttnModel: async () => 'model.pth',
      probeMedia: async (p?: string) => ({
        w: 1080,
        h: 1920,
        giay: p?.includes('snippet') ? 1.2 : 30,
        videoDurationSeconds: p?.includes('snippet') ? 1.2 : 30,
        hasAudio: true,
        frameRate: 30,
        geometry
      }),
      runVisualOcr: async (options) => {
        events.push('ocr')
        return {
          timeline: timelineWithText,
          sourceSrtPath: '',
          sidecarPath: '',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }
      },
      removeSubtitles: async (options) => {
        events.push('sttn')
        await writeFile(options.outputPath, 'cleaned-snippet-video')
        return {
          outputPath: options.outputPath,
          provider: 'cuda',
          elapsedMs: 120
        }
      },
      runMedia: async (executable, args, signal) => {
        events.push(`media:${args[args.length - 1] ? 'call' : 'unknown'}`)
        const lastArg = args[args.length - 1]
        if (lastArg && (lastArg.endsWith('.mkv') || lastArg.endsWith('.jpg'))) {
          await writeFile(lastArg, 'dummy-content-image')
        }
      }
    }

    const result = await createAutoShortThumbnail(
      {
        videoPath,
        mode: 'first_frame',
        cleanSubtitles: true,
        outputDir
      },
      (p) => progressLog.push(p),
      undefined,
      hooks
    )

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.timestamp, 0)
      assert.equal(result.cleaned, true)
      assert.equal(result.provider, 'cuda')
      assert.equal(result.thumbnailPath, join(outputDir, 'Thumbnail.jpg'))
      assert.equal((await stat(result.thumbnailPath)).size > 0, true)
    }

    assert.deepEqual(events, ['media:call', 'ocr', 'sttn', 'media:call'])
    assert.equal(progressLog.some((p) => p.percent === 100), true)

    // Check that temporary directory .thumb-* was cleaned up
    const remainingInOutputDir = await readdir(outputDir)
    assert.equal(remainingInOutputDir.includes('Thumbnail.jpg'), true)
    assert.equal(remainingInOutputDir.some((name) => name.startsWith('.thumb-')), false)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('createAutoShortThumbnail creates current_frame thumbnail and skips STTN if no text found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-thumb-test-'))
  try {
    const videoPath = join(root, 'video2.mp4')
    const outputDir = join(root, 'output')
    await writeFile(videoPath, 'fake-video-content')
    await mkdir(outputDir, { recursive: true })

    const events: string[] = []

    const hooks: AutoShortThumbnailHooks = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      resolveSttnEngine: async () => 'sttn.exe',
      resolveSttnModel: async () => 'model.pth',
      probeMedia: async (p?: string) => ({
        w: 1080,
        h: 1920,
        giay: p?.includes('snippet') ? 1.2 : 60,
        videoDurationSeconds: p?.includes('snippet') ? 1.2 : 60,
        hasAudio: true,
        frameRate: 30,
        geometry
      }),
      runVisualOcr: async () => {
        events.push('ocr')
        return {
          timeline: timelineEmpty,
          sourceSrtPath: '',
          sidecarPath: '',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 0,
          boxSegmentCount: 0
        }
      },
      removeSubtitles: async (options) => {
        events.push('sttn')
        return { outputPath: options.outputPath, provider: 'cpu', elapsedMs: 50 }
      },
      runMedia: async (executable, args, signal) => {
        events.push('media')
        const lastArg = args[args.length - 1]
        if (lastArg && (lastArg.endsWith('.mkv') || lastArg.endsWith('.jpg'))) {
          await writeFile(lastArg, 'dummy-content-image')
        }
      }
    }

    const result = await createAutoShortThumbnail(
      {
        videoPath,
        mode: 'current_frame',
        timestampSeconds: 24.5,
        cleanSubtitles: true,
        outputDir
      },
      undefined,
      undefined,
      hooks
    )

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.timestamp, 24.5)
      assert.equal(result.cleaned, false) // No text to clean
      assert.equal(result.thumbnailPath, join(outputDir, 'Thumbnail.jpg'))
    }

    // STTN should be skipped because OCR found no text!
    assert.deepEqual(events, ['media', 'ocr', 'media'])
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('createAutoShortThumbnail applies portraitBlur when requested for landscape video', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-thumb-test-'))
  try {
    const videoPath = join(root, 'landscape.mp4')
    const outputDir = join(root, 'output')
    await writeFile(videoPath, 'fake-video-content')
    await mkdir(outputDir, { recursive: true })

    let capturedFilterComplex = ''

    const hooks: AutoShortThumbnailHooks = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      probeMedia: async () => ({
        w: 1920,
        h: 1080,
        giay: 45,
        hasAudio: true,
        frameRate: 30
      }),
      runMedia: async (executable, args, signal) => {
        const filterIdx = args.indexOf('-filter_complex')
        if (filterIdx >= 0) {
          capturedFilterComplex = args[filterIdx + 1]
        }
        const lastArg = args[args.length - 1]
        if (lastArg) await writeFile(lastArg, 'dummy-content-image')
      }
    }

    const result = await createAutoShortThumbnail(
      {
        videoPath,
        mode: 'first_frame',
        cleanSubtitles: false,
        portraitBlur: true,
        outputDir
      },
      undefined,
      undefined,
      hooks
    )

    assert.equal(result.ok, true)
    // Filter complex should contain portrait frame split and blur
    assert.equal(capturedFilterComplex.includes('portrait_bg'), true)
    assert.equal(capturedFilterComplex.includes('gblur=sigma=40'), true)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('createAutoShortThumbnail probes snippet duration and handles non-integer frame durations (e.g. 1.201s)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-thumb-test-'))
  try {
    const videoPath = join(root, 'video-nonint.mp4')
    const outputDir = join(root, 'output')
    await writeFile(videoPath, 'fake-video-content')
    await mkdir(outputDir, { recursive: true })

    const events: string[] = []
    let probedSnippetDuration: number | undefined
    let ocrExpectedDuration: number | undefined
    let sttnPreviewSeconds: number | undefined

    const timelineNonInteger: OcrVisualTimeline = {
      ...timelineWithText,
      video: {
        ...timelineWithText.video,
        durationSeconds: 1.201
      }
    }

    const hooks: AutoShortThumbnailHooks = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      resolveSttnEngine: async () => 'sttn.exe',
      resolveSttnModel: async () => 'model.pth',
      probeMedia: async (p?: string) => {
        if (p?.includes('snippet')) {
          probedSnippetDuration = 1.201
          return {
            w: 1080,
            h: 1920,
            giay: 1.201,
            videoDurationSeconds: 1.201,
            hasAudio: true,
            frameRate: 29.97,
            geometry
          }
        }
        return {
          w: 1080,
          h: 1920,
          giay: 45.3,
          videoDurationSeconds: 45.3,
          hasAudio: true,
          frameRate: 29.97,
          geometry
        }
      },
      runVisualOcr: async (options) => {
        events.push('ocr')
        ocrExpectedDuration = options.videoDurationSeconds
        return {
          timeline: timelineNonInteger,
          sourceSrtPath: '',
          sidecarPath: '',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }
      },
      removeSubtitles: async (options) => {
        events.push('sttn')
        sttnPreviewSeconds = options.previewSeconds
        await writeFile(options.outputPath, 'cleaned-snippet-video')
        return {
          outputPath: options.outputPath,
          provider: 'cuda',
          elapsedMs: 120
        }
      },
      runMedia: async (executable, args, signal) => {
        events.push(`media:${args[args.length - 1] ? 'call' : 'unknown'}`)
        const lastArg = args[args.length - 1]
        if (lastArg && (lastArg.endsWith('.mkv') || lastArg.endsWith('.jpg'))) {
          await writeFile(lastArg, 'dummy-content-image')
        }
      }
    }

    const result = await createAutoShortThumbnail(
      {
        videoPath,
        mode: 'first_frame',
        cleanSubtitles: true,
        outputDir
      },
      undefined,
      undefined,
      hooks
    )

    assert.equal(result.ok, true)
    assert.equal(probedSnippetDuration, 1.201)
    assert.equal(ocrExpectedDuration, 1.201)
    assert.equal(sttnPreviewSeconds, 1.201)
    assert.deepEqual(events, ['media:call', 'ocr', 'sttn', 'media:call'])
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('createAutoShortThumbnail burns title overlay with selected style onto thumbnail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-thumb-title-test-'))
  try {
    const videoPath = join(root, 'video_title.mp4')
    const outputDir = join(root, 'output')
    await writeFile(videoPath, 'fake-video-content')
    await mkdir(outputDir, { recursive: true })

    let capturedFilterComplex: string | null = null

    const hooks: AutoShortThumbnailHooks = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      probeMedia: async () => ({
        w: 1080,
        h: 1920,
        giay: 15,
        videoDurationSeconds: 15,
        hasAudio: true,
        frameRate: 30,
        geometry
      }),
      runMedia: async (executable, args) => {
        const filterIdx = args.indexOf('-filter_complex')
        if (filterIdx >= 0) {
          capturedFilterComplex = args[filterIdx + 1]
        }
        const lastArg = args[args.length - 1]
        if (lastArg && lastArg.endsWith('.jpg')) {
          await writeFile(lastArg, 'fake-jpg-with-title')
        }
      }
    }

    const result = await createAutoShortThumbnail(
      {
        videoPath,
        mode: 'first_frame',
        cleanSubtitles: false,
        titleOverlay: {
          text: 'LẨU BÚN ỐC HẢI SẢN',
          style: 'douyin_yellow',
          position: 'top'
        },
        outputDir
      },
      undefined,
      undefined,
      hooks
    )

    assert.equal(result.ok, true)
    assert.ok(capturedFilterComplex !== null, 'Should have filter_complex for title')
    assert.ok(capturedFilterComplex.includes('ass=thumb_title.ass'), 'Filter complex should contain ass=thumb_title.ass')
    assert.ok(capturedFilterComplex.includes('[with_title]'), 'Filter complex should output [with_title]')
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('extractProminentOcrRegion accurately finds prominent title bounding box while ignoring distant watermarks', () => {
  const segments: any = [
    {
      id: 'seg1',
      start: 0,
      end: 0.5,
      text: 'Tiêu đề hàng 1',
      confidence: 0.95,
      boxes: [
        { x0: 100, y0: 300, x1: 900, y1: 420, text: 'Tiêu đề hàng 1', confidence: 0.95 },
        { x0: 150, y0: 440, x1: 850, y1: 540, text: 'Tiêu đề hàng 2', confidence: 0.92 },
        // Watermark at the bottom
        { x0: 800, y0: 1750, x1: 980, y1: 1820, text: '@tiktok', confidence: 0.88 }
      ]
    }
  ]

  // Test at frameOffset 0.2s: should group row 1 & row 2 together, excluding bottom watermark
  const bbox = extractProminentOcrRegion(segments, 0.2)
  assert.ok(bbox !== null)
  assert.equal(bbox.x0, 100)
  assert.equal(bbox.y0, 300)
  assert.equal(bbox.x1, 900)
  assert.equal(bbox.y1, 540)
  // Center Y of title is (300 + 540) / 2 = 420 (not skewed down to 1820!)
  assert.equal(Math.round((bbox.y0 + bbox.y1) / 2), 420)
})

test('createAutoShortThumbnail automatically anchors title overlay at OCR erased position when position is ocr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-thumb-ocr-pos-test-'))
  try {
    const videoPath = join(root, 'video_ocr_pos.mp4')
    const outputDir = join(root, 'output')
    await writeFile(videoPath, 'fake-video-content')
    await mkdir(outputDir, { recursive: true })

    let generatedAssContent = ''

    const customTimeline: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      profile: 'accurate',
      video: {
        width: 1080,
        height: 1920,
        durationSeconds: 1.2,
        sampleFps: 8,
        frameCount: 10,
        geometryFingerprint: geometry.fingerprint
      },
      scanRegion: { x0: 0, y0: 0, x1: 1080, y1: 1920 },
      segments: [
        {
          id: 'seg-title',
          startFrame: 0,
          endFrameExclusive: 8,
          start: 0,
          end: 1.0,
          text: '豪华海鲜螺蛳粉',
          confidence: 0.98,
          boxes: [
            {
              x0: 94,
              y0: 246,
              x1: 970,
              y1: 388,
              text: '豪华海鲜螺蛳粉',
              confidence: 0.98
            }
          ]
        }
      ]
    }

    const hooks: AutoShortThumbnailHooks = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      resolveSttnEngine: async () => 'sttn.exe',
      resolveSttnModel: async () => 'model.pth',
      probeMedia: async () => ({
        w: 1080,
        h: 1920,
        giay: 10,
        videoDurationSeconds: 10,
        hasAudio: true,
        frameRate: 30,
        geometry
      }),
      runVisualOcr: async () => ({
        timeline: customTimeline,
        sourceSrtPath: '',
        sidecarPath: '',
        engineVersion: '1.1.0',
        engineProtocol: 'ocr-local/1',
        visualSegmentCount: 1,
        boxSegmentCount: 1
      }),
      removeSubtitles: async (opts) => ({
        outputPath: opts.outputPath,
        provider: 'cpu',
        elapsedMs: 50
      }),
      runMedia: async (executable, args, signal, workDir) => {
        // If ASS file was created in workDir, read it to verify pos
        if (workDir) {
          const { readFile } = await import('node:fs/promises')
          try {
            generatedAssContent = await readFile(join(workDir, 'thumb_title.ass'), 'utf8')
          } catch {}
        }
        const lastArg = args[args.length - 1]
        if (lastArg && (lastArg.endsWith('.mkv') || lastArg.endsWith('.jpg'))) {
          await writeFile(lastArg, 'fake-thumb-output')
        }
      }
    }

    const result = await createAutoShortThumbnail(
      {
        videoPath,
        mode: 'first_frame',
        cleanSubtitles: true,
        titleOverlay: {
          text: 'LẨU BÚN ỐC HẢI SẢN',
          style: 'douyin_yellow',
          position: 'ocr'
        },
        outputDir
      },
      undefined,
      undefined,
      hooks
    )

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.cleaned, true)
      assert.ok(result.detectedOcrRegion !== undefined, 'Should return detectedOcrRegion')
      assert.equal(result.detectedOcrRegion?.x0, 94)
      assert.equal(result.detectedOcrRegion?.y0, 246)
      assert.equal(result.detectedOcrRegion?.x1, 970)
      assert.equal(result.detectedOcrRegion?.y1, 388)
    }

    // Expected targetY = Math.round((246 + 388) / 2) = 317
    assert.ok(generatedAssContent.includes('\\pos(540,317)'), `Expected pos(540,317) in ASS dialogue, got: ${generatedAssContent}`)
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('calculateThumbnailFontSize and generateThumbnailAssDocument support dynamic sizing and douyin_black', async () => {
  const shortText = 'TIÊU ĐỀ NGẮN'
  const longText = 'TIÊU ĐỀ DÀI HƠN RẤT NHIỀU ĐỂ KIỂM TRA ĐỘ CO GIÃN'

  const sizeStandard = calculateThumbnailFontSize(shortText, 1080, 'standard')
  const sizeLarge = calculateThumbnailFontSize(shortText, 1080, 'large')
  const sizeHuge = calculateThumbnailFontSize(shortText, 1080, 'huge')

  assert.ok(sizeLarge > sizeStandard, 'Large size must be greater than standard')
  assert.ok(sizeHuge > sizeLarge, 'Huge size must be greater than large')

  // Long text should have smaller font size to fit canvas width
  const sizeLong = calculateThumbnailFontSize(longText, 1080, 'large')
  assert.ok(sizeLong < sizeLarge, 'Long text should scale down font size')

  // Test douyin_black ASS output
  const doc = await generateThumbnailAssDocument({
    text: 'LẨU BÚN ỐC',
    style: 'douyin_black',
    fontSize: 'huge',
    canvasWidth: 1080,
    canvasHeight: 1920,
    position: 'top'
  })

  // Check black outline & 3D shadow
  assert.ok(doc.assContent.includes('&H00000000'), 'Should contain pure black outline')
  assert.ok(doc.assContent.includes('&H0000F5FF'), 'Should contain vibrant yellow primary color')
  assert.ok(doc.assContent.includes('&H20000000'), 'Should contain deep 3D drop shadow')
  assert.ok(doc.assContent.includes('\\an5\\b1\\fsp4\\pos(540,384)'), 'Should contain bold extra spacing and pos')
})

test('resolveThumbnailStyle supports 12 styles, random rotation, and fallback', () => {
  assert.equal(THUMBNAIL_STYLES.length, 12)

  // Direct styles
  assert.equal(resolveThumbnailStyle('neon_cyan'), 'neon_cyan')
  assert.equal(resolveThumbnailStyle('fire_orange'), 'fire_orange')
  assert.equal(resolveThumbnailStyle('luxury_gold'), 'luxury_gold')
  assert.equal(resolveThumbnailStyle('electric_lime'), 'electric_lime')

  // Random with index rotates evenly
  assert.equal(resolveThumbnailStyle('random', 0), THUMBNAIL_STYLES[0])
  assert.equal(resolveThumbnailStyle('random', 1), THUMBNAIL_STYLES[1])
  assert.equal(resolveThumbnailStyle('random', 4), 'neon_cyan')
  assert.equal(resolveThumbnailStyle('random', 5), 'fire_orange')
  assert.equal(resolveThumbnailStyle('random', 12), THUMBNAIL_STYLES[0]) // Modulo wraps

  // Random without index returns a valid style
  const randomStyle = resolveThumbnailStyle('random')
  assert.ok(THUMBNAIL_STYLES.includes(randomStyle))

  // Fallback on invalid style
  assert.equal(resolveThumbnailStyle('invalid_style' as any), 'douyin_yellow')
})

test('resolveUniqueThumbnailFilename creates clean Thumbnail.jpg and increments on collision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-unique-thumb-test-'))
  try {
    // 1st file: Thumbnail.jpg
    const name1 = await resolveUniqueThumbnailFilename(root)
    assert.equal(name1, 'Thumbnail.jpg')
    await writeFile(join(root, name1), 'dummy-image-1')

    // 2nd file: Thumbnail (2).jpg
    const name2 = await resolveUniqueThumbnailFilename(root)
    assert.equal(name2, 'Thumbnail (2).jpg')
    await writeFile(join(root, name2), 'dummy-image-2')

    // 3rd file: Thumbnail (3).jpg
    const name3 = await resolveUniqueThumbnailFilename(root)
    assert.equal(name3, 'Thumbnail (3).jpg')

    // Custom name with collision
    const custom1 = await resolveUniqueThumbnailFilename(root, 'custom_thumb.jpg')
    assert.equal(custom1, 'custom_thumb.jpg')
    await writeFile(join(root, custom1), 'dummy-custom-1')

    const custom2 = await resolveUniqueThumbnailFilename(root, 'custom_thumb.jpg')
    assert.equal(custom2, 'custom_thumb (2).jpg')
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
})

test('generateThumbnailAssDocument renders correct ASS colors for new modern presets', async () => {
  // neon_cyan: #00F0FF -> &H00FFF000 primary, #051026 -> &H00261005 outline
  const neon = await generateThumbnailAssDocument({
    text: 'CYBERPUNK SHORT',
    style: 'neon_cyan',
    fontSize: 'large',
    canvasWidth: 1080,
    canvasHeight: 1920
  })
  assert.ok(neon.assContent.includes('&H00FFF000'), 'Neon Cyan primary color')
  assert.ok(neon.assContent.includes('&H00261005'), 'Midnight Navy outline color')

  // fire_orange: #FF6B00 -> &H00006BFF primary, #4D0000 -> &H0000004D outline
  const fire = await generateThumbnailAssDocument({
    text: 'BLAZING FIRE',
    style: 'fire_orange',
    fontSize: 'large',
    canvasWidth: 1080,
    canvasHeight: 1920
  })
  assert.ok(fire.assContent.includes('&H00006BFF'), 'Fire Orange primary color')
  assert.ok(fire.assContent.includes('&H0000004D'), 'Deep Maroon outline color')

  // luxury_gold: #FFD700 -> &H0000D7FF primary, #2A1602 -> &H0002162A outline
  const gold = await generateThumbnailAssDocument({
    text: 'HOÀNG GIA',
    style: 'luxury_gold',
    fontSize: 'large',
    canvasWidth: 1080,
    canvasHeight: 1920
  })
  assert.ok(gold.assContent.includes('&H0000D7FF'), 'Gold primary color')
  assert.ok(gold.assContent.includes('&H0002162A'), 'Espresso outline color')

  // random style resolves without error
  const randDoc = await generateThumbnailAssDocument({
    text: 'RANDOM PRESET TEST',
    style: 'random',
    fontSize: 'large',
    canvasWidth: 1080,
    canvasHeight: 1920
  })
  assert.ok(randDoc.assContent.includes('TitleStyle,'))
})
