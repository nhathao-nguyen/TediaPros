import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { OverlayTextureLayer } from '../shared/videoEffects'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { trackChildProcess, terminateProcessTree } from './processTree'

interface TextureSequence {
  name: string
  blendMode: OverlayTextureLayer['blendMode']
  frames: string[]
}
const pending = new Map<string, Promise<OverlayTextureLayer[]>>()

async function packageData(path: string, root: string): Promise<Buffer> {
  const checked = await assertContainedRegularFile(path, root, 'Metadata texture CapCut')
  if ((await stat(checked)).size > 4 * 1024 * 1024) throw new Error('Metadata texture quá lớn.')
  return readFile(checked)
}

/** Read only a linear texture graph. Arbitrary Lua/shaders are never executed. */
export async function readCapCutTextureLayout(root: string): Promise<TextureSequence[] | undefined> {
  const feature = join(root, 'amazingfeature')
  const scenePath = join(feature, 'main.scene')
  if (!existsSync(scenePath)) return undefined
  const scene = (await packageData(scenePath, root)).toString('latin1')
  const materials = [...scene.matchAll(/material\/(pass\d+)\.material/g)]
  if (materials.length !== 2 || materials[0][1] !== 'pass1' || materials[1][1] !== 'pass2') return undefined
  const sequences: TextureSequence[] = []
  for (let i = 0; i < materials.length; i++) {
    const name = materials[i][1]
    const shaderPath = join(feature, 'xshader', `${name}.frag`)
    if (!existsSync(shaderPath)) return undefined
    const shader = (await packageData(shaderPath, root)).toString('utf8')
    const mode = shader.match(/^\s*#define\s+BLEND_MODE\s+blend(Screen|Multiply)\b/m)?.[1]
    if (mode !== (i === 0 ? 'Screen' : 'Multiply') || !shader.includes('lm_inverse_premult') || !shader.includes('sucaiAlign')) return undefined
    const material = (await packageData(join(feature, 'material', `${name}.material`), root)).toString('latin1')
    if (i === 0 ? !material.includes('share://input.texture') : !material.includes('rt/midTex.rt')) return undefined
    const section = scene.slice(materials[i].index, materials[i + 1]?.index)
    const sequence = section.match(/seq\/([a-zA-Z0-9_-]+)\.seq/)?.[1]
    if (!sequence) return undefined
    const seq = (await packageData(join(feature, 'seq', `${sequence}.seq`), root)).toString('latin1')
    const atlases = [...seq.matchAll(/atlas\/([a-zA-Z0-9_-]+)\.imageatlas/g)]
    if (!atlases.length || atlases.length > 240) return undefined
    const frames: string[] = []
    for (const atlas of atlases) {
      const metadata = (await packageData(join(feature, 'atlas', `${atlas[1]}.imageatlas`), root)).toString('latin1')
      const images = [...metadata.matchAll(/image\/([a-zA-Z0-9_-]+\.png)/g)]
      if (images.length !== 1) return undefined
      frames.push(await assertContainedRegularFile(join(feature, 'image', images[0][1]), root, 'Ảnh texture CapCut'))
    }
    sequences.push({ name, blendMode: mode === 'Screen' ? 'screen' : 'multiply', frames })
  }
  return sequences
}

function encode(ffmpeg: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Đã huỷ.')); return }
    const child = trackChildProcess(spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true }))
    let diagnostic = ''
    child.stderr?.on('data', d => { diagnostic = (diagnostic + d.toString()).slice(-4000) })
    const timer = setTimeout(() => terminateProcessTree(child), 30000)
    const abort = () => terminateProcessTree(child)
    signal?.addEventListener('abort', abort, { once: true })
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    child.once('error', error => { cleanup(); reject(error) })
    child.once('close', code => { cleanup(); code === 0 && !signal?.aborted ? resolve() : reject(new Error(signal?.aborted ? 'Đã huỷ.' : `Không thể chuyển texture: ${diagnostic || code}`)) })
  })
}

/** Bake alpha into the neutral blend color once; keep each shader pass independent. */
export async function synthesizeCapCutTextureLayers(root: string, cache: string, ffmpeg: string, signal?: AbortSignal): Promise<OverlayTextureLayer[] | undefined> {
  if (signal?.aborted) throw new Error('Đã huỷ.')
  const layout = await readCapCutTextureLayout(root)
  if (!layout) return undefined
  await mkdir(cache, { recursive: true })
  const hash = createHash('sha256').update('rgb-texture-v2-24fps')
  let totalBytes = 0
  for (const sequence of layout) {
    hash.update(sequence.name + sequence.blendMode)
    for (const frame of sequence.frames) {
      if (signal?.aborted) throw new Error('Đã huỷ.')
      const size = (await stat(frame)).size
      if (size > 16 * 1024 * 1024 || totalBytes + size > 128 * 1024 * 1024) throw new Error('Texture vượt giới hạn kích thước cho phép.')
      const bytes = await readFile(frame)
      totalBytes += bytes.length
      if (totalBytes > 128 * 1024 * 1024 || bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG' ||
        bytes.readUInt32BE(16) > 2048 || bytes.readUInt32BE(20) > 2048) throw new Error('Texture vượt giới hạn kích thước cho phép.')
      hash.update(bytes)
    }
  }
  const signature = hash.digest('hex').slice(0, 16)
  const key = `${cache}:${root}:${signature}`
  if (!signal && pending.has(key)) return pending.get(key)!
  const build = async (): Promise<OverlayTextureLayer[]> => {
    const layers: OverlayTextureLayer[] = []
    for (const sequence of layout) {
      if (signal?.aborted) throw new Error('Đã huỷ.')
      const safeName = `${basename(root)}_${signature}_${sequence.name}_rgb-v2`.replace(/[^a-zA-Z0-9_-]/g, '_')
      const target = join(cache, `${safeName}.mp4`)
      await assertContainedParentDirectory(target, cache, 'Cache texture')
      if (existsSync(target)) {
        await assertContainedRegularFile(target, cache, 'Cache texture')
        if ((await stat(target)).size < 100) throw new Error('Cache texture không hoàn chỉnh.')
      } else {
        const token = randomUUID()
        const concat = join(cache, `${token}.txt`), temp = join(cache, `${token}.mp4`)
        try {
          await writeFile(concat, sequence.frames.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), { flag: 'wx' })
          const neutral = sequence.blendMode === 'multiply' ? 255 : 0
          const flatten = `format=rgba,split=2[fg][neutral];[neutral]lutrgb=r=${neutral}:g=${neutral}:b=${neutral}:a=255[bg];[bg][fg]overlay=shortest=1:format=rgb,format=yuv420p[out]`
          await encode(ffmpeg, ['-r', '24', '-f', 'concat', '-safe', '0', '-i', concat, '-filter_complex', flatten, '-map', '[out]',
            '-frames:v', String(sequence.frames.length), '-r', '24', '-fps_mode', 'cfr', '-an', '-c:v', 'libx264', '-crf', '0', '-preset', 'veryfast', temp], signal)
          await rename(temp, target)
        } finally {
          await rm(concat, { force: true }).catch(() => {})
          await rm(temp, { force: true }).catch(() => {})
        }
      }
      layers.push({ assetPath: target, blendMode: sequence.blendMode, ...(sequence.frames.length === 1 ? { isStatic: true } : {}) })
    }
    return layers
  }
  const promise = build()
  if (!signal) pending.set(key, promise)
  try { return await promise } finally { if (!signal) pending.delete(key) }
}
