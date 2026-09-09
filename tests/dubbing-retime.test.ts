import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { planDubbingTimeMap, mapDubbingTime } from '../src/main/dubbing/timeMap'
import { retimeDubbingMedia } from '../src/main/dubbing/retimeMedia'

const ffmpeg = process.env.TEDIAPROS_RETIME_TEST_FFMPEG
const ffprobe = process.env.TEDIAPROS_RETIME_TEST_FFPROBE
test('real FFmpeg maps video, OCR mask and source sound to the same extended timeline', { skip: !ffmpeg || !ffprobe }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-retime-test-'))
  const run = (args: string[]) => execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true })
  try {
    const source = join(dir, 'source.mkv')
    run(['-y', '-f', 'lavfi', '-i', "color=black:s=64x64:r=24:d=4,drawbox=color=white:t=fill:enable='gte(t,2)'",
      '-f', 'lavfi', '-i', "aevalsrc=if(gte(t\\,2)\\,0.5*sin(2*PI*440*t)\\,0):s=44100:d=4",
      '-c:v', 'ffv1', '-c:a', 'pcm_s16le', source])
    const map = planDubbingTimeMap(4, [
      { id: 'a', start: 0, naturalDuration: 3.4, availableDuration: 1.5 },
      { id: 'b', start: 2, naturalDuration: 1, availableDuration: 1.5 }
    ], 1.8)
    for (const kind of ['video', 'mask', 'audio'] as const) {
      const result = await retimeDubbingMedia({ ffmpeg: ffmpeg!, source, workDir: dir, name: kind,
        map, kind, hasAudio: kind === 'video', frameRate: 24, signal: new AbortController().signal })
      const probe = JSON.parse(execFileSync(ffprobe!, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', result], { windowsHide: true }).toString())
      assert.ok(Math.abs(Number(probe.format.duration) - map.outputDuration) < (kind === 'mask' ? 0.13 : 0.05), `${kind}: duration ${probe.format.duration}`)
      for (const offset of [-0.25, 0.25]) {
        const time = mapDubbingTime(map, 2) + offset
        if (kind !== 'audio') {
          const pixel = run(['-ss', String(time), '-i', result, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', 'pipe:1'])
          assert.ok(offset < 0 ? pixel[0] < 20 : pixel[0] > 230, `${kind}: mapped visual transition`)
        }
        if (kind !== 'mask') {
          const pcm = run(['-ss', String(time), '-i', result, '-t', '0.05', '-vn', '-ac', '1', '-f', 's16le', 'pipe:1'])
          let peak = 0
          for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
          assert.ok(offset < 0 ? peak < 50 : peak > 1000, `${kind}: mapped audio transition (peak=${peak})`)
        }
      }
    }
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + require('node:path').sep))
    await rm(dir, { recursive: true, force: true })
  }
})
