import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const evidence = dirname(fileURLToPath(import.meta.url)), ff = process.env.TEDIAPROS_TEST_FFMPEG || 'ffmpeg'
await mkdir(evidence, { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'tedia-encoder-probe-'))
const run = args => {
  const r = spawnSync(ff, ['-hide_banner', '-y', ...args], { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 })
  assert.equal(r.status, 0, r.error?.message || r.stderr.toString()); return r
}
try {
  const source = join(work, 'source.mp4')
  run(['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=4', '-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source])
  const cases = [
    ['old-nvenc', ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-g', '60', '-spatial-aq', '1']],
    ['cq-p4', ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '8M', '-bufsize', '16M', '-g', '48', '-spatial-aq', '1', '-bf', '3']],
    ['cq-p5', ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '8M', '-bufsize', '16M', '-g', '48', '-spatial-aq', '1', '-bf', '3']],
    ['cq-p5-qres', ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '8M', '-bufsize', '16M', '-g', '48', '-spatial-aq', '1', '-bf', '3', '-multipass', 'qres']],
    ['balanced-p4-24', ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '0', '-maxrate', '8M', '-bufsize', '16M', '-g', '48', '-spatial-aq', '1', '-bf', '3']],
    ['old-cpu', ['-c:v', 'libx264', '-preset', 'faster', '-crf', '21']],
    ['cpu-fast22', ['-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-maxrate', '8M', '-bufsize', '16M', '-g', '48']]
  ]
  const results = []
  for (const [name, args] of cases) {
    const output = join(work, name + '.mp4'), start = performance.now()
    run(['-v', 'error', '-i', source, ...args, '-pix_fmt', 'yuv420p', '-an', output])
    const elapsedMs = performance.now() - start
    const comparison = run(['-i', output, '-i', source, '-filter_complex', '[0:v][1:v]ssim', '-an', '-f', 'null', 'NUL'])
    const ssim = Number(comparison.stderr.toString().match(/All:([\d.]+)/)?.[1])
    const result = { name, elapsedMs, bytes: (await stat(output)).size, ssim }
    results.push(result); console.log(JSON.stringify(result))
  }
  await writeFile(join(evidence, 'encoder-probe.json'), JSON.stringify(results, null, 2))
} finally {
  assert.ok(relative(tmpdir(), work).startsWith('tedia-encoder-probe-'))
  await rm(work, { recursive: true, force: true })
}
