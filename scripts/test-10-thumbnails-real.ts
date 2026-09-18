import fs from 'node:fs'
import path from 'node:path'
import { createAutoShortThumbnail } from '../src/main/autoShortThumbnail'
import type { AutoShortThumbnailMode, AutoShortThumbnailProgress } from '../src/shared/types'

async function run(): Promise<void> {
  console.log('==================================================================')
  console.log('BẮT ĐẦU KIỂM THỬ TẠO THUMBNAIL TRÊN 10 VIDEO THỰC TẾ')
  console.log('==================================================================\n')

  const snapshotPath = path.join(
    process.env.APPDATA || '',
    'tedia-pros',
    'autoshort-batches-v1',
    '6dbe0367-2943-44be-9730-02fd6375d9fb',
    'snapshot.json'
  )

  let videoPaths: string[] = []

  if (fs.existsSync(snapshotPath)) {
    const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
    const items = raw.snapshot?.items || []
    videoPaths = items.map((i: { inputPath: string }) => i.inputPath).filter((p: string) => fs.existsSync(p)).slice(0, 10)
  }

  if (videoPaths.length < 10) {
    console.log(`Tìm thấy ${videoPaths.length} video từ batch, đang quét thêm từ F:\\Son...`)
    const searchDir = 'F:\\Son\\douyin\\reel\\小温夫妻测评\\sub1'
    if (fs.existsSync(searchDir)) {
      const files = fs.readdirSync(searchDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => path.join(searchDir, f))
      videoPaths = files.slice(0, 10)
    }
  }

  console.log(`Đã nạp ${videoPaths.length} video kiểm thử:\n`)
  videoPaths.forEach((v, idx) => console.log(`  [${idx + 1}] ${path.basename(v)}`))

  const outputDir = 'F:\\Son\\Short-VietNam\\reel\\thumbnails-batch-test'
  fs.mkdirSync(outputDir, { recursive: true })
  console.log(`\nThư mục xuất ảnh: ${outputDir}\n`)

  interface TestResult {
    index: number
    name: string
    mode: AutoShortThumbnailMode
    timestamp: number
    cleaned: boolean
    provider?: string
    sizeBytes: number
    elapsedMs: number
    thumbnailPath?: string
    success: boolean
    error?: string
  }

  const results: TestResult[] = []

  for (let i = 0; i < videoPaths.length; i++) {
    const videoPath = videoPaths[i]
    const baseName = path.basename(videoPath)
    // 5 video đầu dùng current_frame ở các mốc thời gian khác nhau, 5 video sau dùng first_frame
    const mode: AutoShortThumbnailMode = i < 5 ? 'current_frame' : 'first_frame'
    const testTimestamp = i < 5 ? (i + 1) * 5.0 : 0

    console.log(`\n------------------------------------------------------------------`)
    console.log(`[Video ${i + 1}/10] ${baseName}`)
    console.log(`Chế độ: ${mode === 'current_frame' ? `Frame tại ${testTimestamp}s` : 'Frame đầu tiên (00:00)'}`)

    const started = Date.now()
    let lastMsg = ''

    const onProgress = (p: AutoShortThumbnailProgress): void => {
      const msg = `[${Math.round(p.percent)}%] ${p.message}`
      if (msg !== lastMsg) {
        lastMsg = msg
        process.stdout.write(`  -> ${msg}\n`)
      }
    }

    try {
      const res = await createAutoShortThumbnail(
        {
          videoPath,
          mode,
          timestampSeconds: testTimestamp,
          cleanSubtitles: true,
          outputDir
        },
        onProgress
      )

      const elapsedMs = Date.now() - started

      if (res.ok) {
        const stats = fs.statSync(res.thumbnailPath)
        console.log(`  ✓ Thành công! File: ${path.basename(res.thumbnailPath)} (${stats.size} bytes, ${elapsedMs}ms)`)
        console.log(`  ✓ Làm sạch STTN: ${res.cleaned ? `Đã làm sạch (${res.provider?.toUpperCase()})` : 'Giữ ảnh gốc (không thấy chữ)'}`)

        results.push({
          index: i + 1,
          name: baseName,
          mode,
          timestamp: res.timestamp,
          cleaned: res.cleaned,
          provider: res.provider,
          sizeBytes: stats.size,
          elapsedMs,
          thumbnailPath: res.thumbnailPath,
          success: true
        })
      } else {
        console.log(`  ✗ Thất bại: ${res.error}`)
        results.push({
          index: i + 1,
          name: baseName,
          mode,
          timestamp: testTimestamp,
          cleaned: false,
          sizeBytes: 0,
          elapsedMs,
          success: false,
          error: res.error
        })
      }
    } catch (err) {
      const elapsedMs = Date.now() - started
      const errMsg = err instanceof Error ? err.message : String(err)
      console.log(`  ✗ Lỗi ngoại lệ: ${errMsg}`)
      results.push({
        index: i + 1,
        name: baseName,
        mode,
        timestamp: testTimestamp,
        cleaned: false,
        sizeBytes: 0,
        elapsedMs,
        success: false,
        error: errMsg
      })
    }
  }

  console.log('\n==================================================================')
  console.log('KẾT QUẢ KIỂM THỬ TRÊN 10 VIDEO:')
  console.log('==================================================================\n')

  const successCount = results.filter(r => r.success).length
  console.log(`Tổng số hoàn thành: ${successCount}/10\n`)

  results.forEach(r => {
    const status = r.success ? 'PASS' : 'FAIL'
    const cleanInfo = r.cleaned ? `STTN (${r.provider || 'CPU'})` : 'Gốc'
    console.log(`[${r.index}] ${status} | Mode: ${r.mode} (${r.timestamp}s) | Clean: ${cleanInfo} | ${(r.sizeBytes / 1024).toFixed(1)} KB | ${r.elapsedMs}ms | ${r.name.slice(0, 35)}...`)
  })
}

run().catch((err) => {
  console.error('Fatal error in runner:', err)
  process.exit(1)
})
