import { existsSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { OverlayComposition, OverlayBlendMode } from '../shared/videoEffects'
import { assertContainedRegularFile } from './safeContainedPath'

async function text(path: string, root: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  const checked = await assertContainedRegularFile(path, root, 'Metadata alpha CapCut')
  if ((await stat(checked)).size > 4 * 1024 * 1024) throw new Error('Metadata alpha quá lớn.')
  return readFile(checked, encoding)
}

/** Recognize the inspected Lumi video layout from literals/bindings, never from aspect ratio or filename alone. */
export async function readCapCutPackedAlpha(root: string, videoPath?: string): Promise<OverlayComposition | undefined> {
  const feature = join(root, 'AmazingFeature'), luaPath = join(feature, 'lua/LumiFamily/LumiExportData.lua')
  const scenePath = join(feature, 'main.scene')
  if (!existsSync(luaPath) || !existsSync(scenePath)) return undefined
  const lua = await text(luaPath, root)
  const start = lua.indexOf('local ae_attribute ='), end = lua.indexOf('data.ae_attribute =')
  if (start < 0 || end <= start) return undefined
  const attributes = lua.slice(start, end)
  const nodes = [...attributes.matchAll(/\[['"]LumiAnimSeqLoadAndCrop_([\w-]+)-effect\d+['"]\]\s*=\s*\{([^}]*)\}/g)]
  if (nodes.length !== 1) return undefined
  const [, id, node] = nodes[0]
  const active = [...node.matchAll(/\[['"]specify_([\w.]+)['"]\]\s*=\s*true\b/g)].map(m => m[1])
  if (!active.length || active.some(aspect => {
    const suffix = aspect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return !new RegExp(`\\[['"]enableVideoAlphaBlend_${suffix}['"]\\]\\s*=\\s*true\\b`).test(node) ||
      !new RegExp(`\\[['"]animSeqType_${suffix}['"]\\]\\s*=\\s*0\\b`).test(node)
  })) return undefined
  const layer = [...attributes.matchAll(/\[['"]LumiLayer_([\w-]+)-blend['"]\]\s*=\s*\{([^}]*)\}/g)].find(m => m[1] === id)?.[2]
  if (!layer || !/\[['"]hasBlend['"]\]\s*=\s*true\b/.test(layer) || /\[['"]hasMatte['"]\]\s*=\s*true\b/.test(layer)) return undefined
  const mode = Number(layer.match(/\[['"]blendMode['"]\]\s*=\s*(\d+)\b/)?.[1])
  const modes: Partial<Record<number, OverlayBlendMode>> = { 0: 'alphamerge', 1: 'add', 2: 'multiply', 12: 'screen' }
  if (!modes[mode]) return undefined

  const scene = await text(scenePath, root, 'latin1')
  const paths = [...new Set([...scene.matchAll(/resource\/video\/([\w.-]+\.mp4)/g)].map(m => m[1]))]
  if (paths.length !== 1) return undefined
  const asset = await assertContainedRegularFile(join(feature, 'resource/video', paths[0]), root, 'Video alpha CapCut')
  const canonical = (path: string): string => process.platform === 'win32' ? normalize(path).toLowerCase() : normalize(path)
  if (videoPath && canonical(asset) !== canonical(videoPath)) return undefined
  const shaderDir = join(feature, 'effects/LumiAnimSeqLoadAndCrop/xshader/shaderLib/shaderGLES')
  if (!existsSync(shaderDir)) return undefined
  const files = (await readdir(shaderDir)).filter(f => f.endsWith('.frag'))
  if (files.length > 8) return undefined
  let recognized = false
  for (const file of files) {
    const shader = (await text(join(shaderDir, file), root)).replace(/\s+/g, '')
    if (shader.includes('u_convertAlpha') && /vec2\(\w+\.x\*0\.5,\w+\.y\)\)\.x/.test(shader) &&
      /vec2\(\(\w+\.x\*0\.5\)\+0\.5,\w+\.y\)\)\.xyz/.test(shader)) recognized = true
  }
  return recognized ? { packedAlpha: 'left', blendMode: modes[mode]! } : undefined
}
