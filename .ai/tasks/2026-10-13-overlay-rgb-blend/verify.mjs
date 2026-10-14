import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidence = dirname(fileURLToPath(import.meta.url))
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG
assert.ok(ffmpeg && existsSync(ffmpeg), 'Set TEDIAPROS_TEST_FFMPEG to the installed executable')
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe')
const asset = process.env.TEDIAPROS_SCREEN_ASSET || join(process.env.APPDATA, 'tedia-pros-dev/cache/converted_effects/7399469641170554117_53ff3188476c74715a73aa34f08a1edf_loop.mp4')
assert.ok(existsSync(asset), 'The real Nhiễu 2 converted texture is required')
await mkdir(evidence, { recursive: true })
const work = await mkdtemp(join(tmpdir(), 'tedia-screen-proof-'))
const run = args => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 45000, maxBuffer: 40 * 1024 * 1024 })
  assert.equal(result.status, 0, result.error?.message || result.stderr?.toString())
  return result.stdout
}
try {
  const source = join(work, 'source.mp4')
  const before = join(evidence, 'before.mp4'), after = join(work, 'after.mp4')
  run(['-f', 'lavfi', '-i', 'color=0x202020:s=360x640:r=12:d=3,drawbox=x=0:y=180:w=360:h=120:c=0x3864A2:t=fill,drawbox=x=0:y=300:w=360:h=120:c=0xA23864:t=fill,drawbox=x=0:y=420:w=360:h=120:c=white:t=fill',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
  run(['-i', source, '-stream_loop', '-1', '-i', asset,
    '-filter_complex', '[1:v]scale=w=360:h=640:force_original_aspect_ratio=increase,crop=360:640,setsar=1,format=yuv444p[tex];[0:v][tex]blend=c0_mode=screen:c0_opacity=0.7500:c1_expr=A:c2_expr=A:shortest=1[out]',
    '-map', '[out]', '-map', '0:a', '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'copy', before])
  await build({
    stdin: { contents: `import {burnAutoShort} from './src/main/burn';
      (async()=>{const result=await burnAutoShort({video:${JSON.stringify(source)},mode:'burn'},
        {videoEffects:[{kind:'custom_overlay',intensity:75,assetPath:${JSON.stringify(asset)},blendMode:'screen',sourceType:'custom',name:'Nhiễu 2'}],
         ffmpegPath:${JSON.stringify(ffmpeg)},ffprobePath:${JSON.stringify(ffprobe)},finalOutputPath:${JSON.stringify(after)},itemWorkDir:${JSON.stringify(work)},signal:new AbortController().signal,
         expectedMedia:{durationSeconds:3,frameRate:12,requireAudio:true,durationToleranceFrames:3}},()=>{});
       if(!result.ok)throw Error(JSON.stringify(result));console.log(JSON.stringify(result));})().catch(e=>{console.error(e);process.exitCode=1});`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: join(work, 'render.cjs'),
    plugins: [{ name: 'electron-proof', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'proof' }))
      b.onLoad({ filter: /.*/, namespace: 'proof' }, () => ({ contents: `module.exports={app:{getPath:()=>${JSON.stringify(work)},getAppPath:()=>process.cwd(),isPackaged:false,getVersion:()=> '0.1.36'},BrowserWindow:class{}}`, loader: 'js' }))
    } }]
  })
  const rendered = spawnSync(process.execPath, [join(work, 'render.cjs')], { windowsHide: true, timeout: 45000, encoding: 'utf8' })
  assert.equal(rendered.status, 0, rendered.error?.message || rendered.stdout + rendered.stderr)
  const renderResult = JSON.parse(rendered.stdout.trim().split('\n').at(-1))
  const decoded = file => run(['-i', file, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
  const a = decoded(source), b = decoded(before), c = decoded(after)
  const frameSize = 360 * 640 * 3
  assert.equal(c.length, a.length, 'Production render must preserve all 36 frames')
  assert.equal(b.length, a.length)
  const stats = pixels => {
    let sum = 0, n = 0
    // Centre dark region: no visible dust in the first texture frame.
    for (let y = 40; y < 100; y++) for (let x = 150; x < 210; x++) {
      const p = (y * 360 + x) * 3
      sum += (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3; n++
    }
    return sum / n
  }
  const sourceMean = stats(a), oldMean = stats(b), newMean = stats(c)
  assert.ok(oldMean - sourceMean >= 8, 'Old export must reproduce the white veil')
  assert.ok(Math.abs(newMean - sourceMean) <= 3, 'Fixed export must preserve dark backing')
  assert.notDeepEqual(c.subarray(0, frameSize), c.subarray(frameSize * 12, frameSize * 13), 'Real dust must remain animated')
  const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', after], { windowsHide: true, encoding: 'utf8' })
  assert.equal(probe.status, 0)
  const media = JSON.parse(probe.stdout), video = media.streams.find(s => s.codec_type === 'video')
  assert.equal(Number(video.nb_frames), 36)
  assert.equal(video.width, 360); assert.equal(video.height, 640)
  assert.ok(Math.abs(Number(media.format.duration) - 3) < 0.1)
  assert.ok(media.streams.some(s => s.codec_type === 'audio'))
  run(['-i', after, '-f', 'null', 'NUL'])
  assert.deepEqual((await readdir(work)).sort(), ['after.mp4', 'logs', 'render.cjs', 'source.mp4'], 'Only the output, fixture, bundle and application logs may remain after scratch cleanup')
  run(['-ss', '0.5', '-i', source, '-ss', '0.5', '-i', before, '-ss', '0.5', '-i', after,
    '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3[out]',
    '-map', '[out]', '-frames:v', '1', join(evidence, 'comparison.png')])
  const proof = { asset, intensity: 75, sourceMean, oldMean, newMean, width: 360, height: 640, frames: 36,
    durationSeconds: Number(media.format.duration), hasAudio: true, animated: true, fullyDecoded: true, scratchClean: true, selectedEncoder: renderResult.selectedEncoder }
  await writeFile(join(evidence, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  await copyFile(after, join(evidence, 'after.mp4'))
  console.log(JSON.stringify(proof, null, 2))
} finally {
  const rel = relative(tmpdir(), work)
  assert.ok(rel.startsWith('tedia-screen-proof-') && !rel.includes('..'))
  await rm(work, { recursive: true, force: true })
}
