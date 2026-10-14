import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const source = 'F:\\Son\\facebook\\reel\\KhinhThuong\\Confianza - 61591542279685\\video\\001_1461911245698594.mp4'
const output = 'F:\\Son\\facebook\\test\\001_1461911245698594 (2)\\001_1461911245698594-phude_1.1x.mp4'
const adjustments = 'crop=900:1600:90:160,scale=1080:1920:flags=lanczos,eq=brightness=-0.05:saturation=1.05:contrast=1.03'

function evidence(name) {
  const path = resolve(evidenceDir, name)
  const rel = relative(evidenceDir, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Evidence path escapes task directory')
  return path
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, stdio: 'pipe', timeout: 120000 })
}

function probe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,bit_rate,color_range,color_space,color_transfer,color_primaries',
    '-of', 'json', path], { encoding: 'utf8', windowsHide: true }))
}

mkdirSync(evidenceDir, { recursive: true })
const result = { source: { path: source, probe: probe(source) }, output: { path: output, probe: probe(output) },
  alignment: { outputSeconds: 5, sourceSeconds: 5.5, configuredSpeed: 1.1 }, adjustments,
  note: 'Single-frame comparison with current saved adjustments; not an isolated codec quality metric or frozen historical job config.' }
writeFileSync(evidence('media-probes.json'), JSON.stringify(result, null, 2) + '\n')
ffmpeg(['-ss', '5.5', '-i', source, '-frames:v', '1', '-y', evidence('source-t5.5.png')])
ffmpeg(['-ss', '5.5', '-i', source, '-vf', adjustments, '-frames:v', '1', '-y', evidence('adjusted-source-t5.5.png')])
ffmpeg(['-ss', '5', '-i', output, '-frames:v', '1', '-y', evidence('output-t5.png')])
ffmpeg(['-i', evidence('source-t5.5.png'), '-i', evidence('adjusted-source-t5.5.png'), '-i', evidence('output-t5.png'),
  '-filter_complex', '[0:v]scale=360:640[a];[1:v]scale=360:640[b];[2:v]scale=360:640[c];[a][b][c]hstack=inputs=3[v]',
  '-map', '[v]', '-frames:v', '1', '-y', evidence('quality-comparison.png')])
ffmpeg(['-i', source, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', 'NUL'])
ffmpeg(['-i', output, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', 'NUL'])
console.log('PASS: probed and fully decoded both files; aligned three-panel comparison generated.')
