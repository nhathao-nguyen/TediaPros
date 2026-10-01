import { constants, existsSync, readdirSync, realpathSync } from 'node:fs'
import { readdir, readFile, mkdir, copyFile, stat, rm, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, basename, extname, dirname, relative, isAbsolute, normalize } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { normalizeVideoEffects, type VideoEffect, type CapCutScannedEffect, type SavedOverlayEffect, type OverlayBlendMode } from '../shared/videoEffects'
import { normalizeOverlayChromaKey, type OverlayChromaKey } from '../shared/overlayChromaKey'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { resolveFfmpeg } from './deps'
import { logInfo, logWarn } from './logger'

function getCapCutEffectCacheDir(): string {
  return join(
    process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
    'CapCut',
    'User Data',
    'Cache',
    'effect'
  )
}

function getCapCutDraftsDir(): string {
  return join(
    process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
    'CapCut',
    'User Data',
    'Projects',
    'com.lveditor.draft'
  )
}

function getCapCutRessdkDbPath(): string | null {
  const ressdkBase = join(
    process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'),
    'CapCut',
    'User Data',
    'Cache',
    'ressdk_db'
  )
  if (!existsSync(ressdkBase)) return null
  try {
    const subs = readdirSync(ressdkBase)
    for (const sub of subs) {
      const candidate = join(ressdkBase, sub, 'rp.db')
      if (existsSync(candidate)) return candidate
    }
  } catch {
    // ignore
  }
  return null
}

export function getTediaProsVaultDir(): string {
  const userData = app?.getPath?.('userData') || join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'tedia-pros')
  return join(userData, 'library', 'effects')
}

export function getGeneratedEffectCacheDir(): string {
  const userData = app?.getPath?.('userData') || join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'tedia-pros')
  return join(userData, 'cache', 'converted_effects')
}

/** Read data literals only; never execute scripts from an external effect package. */
export async function readCapCutChromaKey(effectRoot: string): Promise<OverlayChromaKey | undefined> {
  const luaPath = join(effectRoot, 'AmazingFeature', 'lua', 'LumiFamily', 'LumiExportData.lua')
  if (!existsSync(luaPath)) return undefined
  const checked = await assertContainedRegularFile(luaPath, effectRoot, 'Metadata Chroma Key')
  if ((await stat(checked)).size > 2 * 1024 * 1024) return undefined
  const lua = await readFile(checked, 'utf8')
  const colors = new Set<string>()
  for (const block of lua.matchAll(/\[['"]LumiChromaKey[^'"\]]*['"]\]\s*=\s*\{([^}]*)\}/g)) {
    const threshold = block[1].match(/\[['"]threshold['"]\]\s*=\s*([\d.]+)/)
    if (!threshold || !(Number(threshold[1]) > 0)) continue
    const match = block[1].match(/\[['"]keyColor['"]\]\s*=\s*Amaz\.Color\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
    if (!match) continue
    const rgb = match.slice(1).map(Number)
    if (rgb.some(v => !Number.isFinite(v) || v < 0 || v > 1)) continue
    colors.add('#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase())
  }
  // Multiple unrelated keys in one package need a full shader graph, not a guess.
  if (colors.size !== 1) return undefined
  return { color: [...colors][0], similarity: 0.3, blend: 0.12 }
}

function stripLongPathPrefix(p: string): string {
  return p.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/i, '')
}

function toCanonicalPath(p: string): string {
  let clean = stripLongPathPrefix(p)
  try {
    if (existsSync(clean)) clean = stripLongPathPrefix(realpathSync(clean))
  } catch {
    // ignore
  }
  return normalize(clean)
}

function containedParts(candidate: string, root: string): string[] | undefined {
  if (typeof candidate !== 'string' || typeof root !== 'string') return undefined

  const check = (r: string, c: string): string[] | undefined => {
    const cleanR = stripLongPathPrefix(r)
    const cleanC = stripLongPathPrefix(c)
    const rel = relative(cleanR, cleanC)
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) return undefined
    const parts = rel.split(/[\\/]/).filter(Boolean)
    if (parts.includes('..')) return undefined
    return parts
  }

  const direct = check(root, candidate)
  if (direct) return direct

  const cRoot = toCanonicalPath(root)
  const cCand = toCanonicalPath(candidate)
  const canon = check(cRoot, cCand)
  if (canon) return canon

  const lcRoot = cRoot.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
  const lcCand = cCand.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
  if (lcCand.startsWith(lcRoot + '/')) {
    const rel = cCand.slice(lcRoot.length + 1)
    const parts = rel.split(/[\\/]/).filter(Boolean)
    if (parts.length > 0 && !parts.includes('..')) return parts
  }

  return undefined
}

/** Publish by replacement so an existing target-file symlink is never followed. */
async function publishVaultFile(target: string, vaultRoot: string, create: (temp: string) => Promise<void>): Promise<void> {
  await assertContainedParentDirectory(target, vaultRoot, 'Tệp kho hiệu ứng')
  const temp = join(dirname(target), `.effect-${randomUUID()}.tmp`)
  await assertContainedParentDirectory(temp, vaultRoot, 'Tệp tạm kho hiệu ứng')
  try {
    await create(temp)
    await rename(temp, target)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}

function publishVaultMetadata(target: string, vaultRoot: string, metadata: unknown): Promise<void> {
  return publishVaultFile(target, vaultRoot, temp => writeFile(temp, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' }))
}

/** Recover key metadata for selections saved before chroma-key support was added. */
export async function resolveOverlayChromaKey(videoPath: string): Promise<OverlayChromaKey | undefined> {
  if (typeof videoPath !== 'string' || !isAbsolute(videoPath) || videoPath.includes('\0')) return undefined
  const cacheDir = getCapCutEffectCacheDir()
  const capcutParts = containedParts(videoPath, cacheDir)
  if (capcutParts && capcutParts.length >= 3) {
    await assertContainedRegularFile(videoPath, cacheDir, 'Video hiệu ứng CapCut')
    return readCapCutChromaKey(join(cacheDir, ...capcutParts.slice(0, 2)))
  }
  const vaultDir = getTediaProsVaultDir()
  const vaultParts = containedParts(videoPath, vaultDir)
  if (vaultParts?.length === 2) {
    await assertContainedRegularFile(videoPath, vaultDir, 'Video trong kho hiệu ứng')
    const metaPath = await assertContainedRegularFile(join(vaultDir, vaultParts[0], 'metadata.json'), vaultDir, 'Metadata kho hiệu ứng')
    const meta = JSON.parse(await readFile(metaPath, 'utf8'))
    if (meta.chromaKey) return normalizeOverlayChromaKey(meta.chromaKey)
    const origin = String(meta.id || vaultParts[0]).match(/^(\d+)_([\da-f]+)$/i)
    if (origin && existsSync(cacheDir)) {
      const chromaKey = await readCapCutChromaKey(join(cacheDir, origin[1], origin[2]))
      if (chromaKey) await publishVaultMetadata(metaPath, vaultDir, { ...meta, blendMode: 'chromakey', chromaKey })
      return chromaKey
    }
  }
  return undefined
}

export async function restoreVideoEffectChromaKeys(raw: VideoEffect[] | undefined): Promise<VideoEffect[] | undefined> {
  const effects = normalizeVideoEffects(raw)
  if (!effects) return undefined
  return Promise.all(effects.map(async effect => {
    if (effect.kind !== 'custom_overlay' || !effect.assetPath || effect.mattePath || effect.chromaKey ||
      (effect.sourceType !== 'capcut' && effect.sourceType !== 'saved') || !existsSync(effect.assetPath)) return effect
    const chromaKey = await resolveOverlayChromaKey(effect.assetPath)
    return chromaKey ? { ...effect, blendMode: 'chromakey' as const, chromaKey } : effect
  }))
}

/**
 * Scan recent CapCut draft_content.json files and ressdk_db to discover human-readable names and metadata for effects.
 */
async function getDraftEffectMetaMap(): Promise<Map<string, { name: string; isPro?: boolean }>> {
  const metaMap = new Map<string, { name: string; isPro?: boolean }>()

  // 1. Query CapCut resource catalog database (rp.db) if available
  const ressdkDb = getCapCutRessdkDbPath()
  if (ressdkDb) {
    try {
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(ressdkDb, { readOnly: true })
      const rows = db.prepare('SELECT response_body FROM http_cache').all() as Array<{ response_body?: string }>
      for (const r of rows) {
        if (!r.response_body) continue
        try {
          const parsed = JSON.parse(r.response_body)
          function walk(o: unknown) {
            if (!o) return
            if (Array.isArray(o)) {
              for (const item of o) walk(item)
            } else if (typeof o === 'object') {
              const obj = o as Record<string, unknown>
              const id = obj.id || obj.effect_id
              const title = obj.title || obj.name
              const isPro = Boolean(obj.is_vip || obj.is_pro || obj.vip_type)
              if (id && typeof title === 'string' && title.trim().length > 1) {
                const sId = String(id)
                if (!metaMap.has(sId)) {
                  metaMap.set(sId, { name: title.trim(), isPro })
                }
              }
              for (const v of Object.values(obj)) walk(v)
            }
          }
          walk(parsed)
        } catch {}
      }
      db.close()
    } catch {
      // Best-effort SQLite inspection
    }
  }

  // 2. Query CapCut user drafts (highest priority for names used in projects)
  const draftsDir = getCapCutDraftsDir()
  if (!existsSync(draftsDir)) return metaMap

  try {
    const draftFolders = await readdir(draftsDir, { withFileTypes: true })
    for (const d of draftFolders) {
      if (!d.isDirectory()) continue
      const draftJsonPath = join(draftsDir, d.name, 'draft_content.json')
      if (!existsSync(draftJsonPath)) continue

      try {
        const contentStr = await readFile(draftJsonPath, 'utf8')
        const data = JSON.parse(contentStr)

        // CapCut stores effect materials under data.materials.video_effects
        const sources = [
          data?.materials?.video_effects,
          data?.materials?.material_effects,
          data?.video_effects,
          data?.effects
        ]

        for (const videoEffects of sources) {
          if (!Array.isArray(videoEffects)) continue
          for (const eff of videoEffects) {
            const name = eff.name?.trim()
            const effectId = eff.effect_id || eff.resource_id
            const effPath = eff.path?.replace(/\\/g, '/').toLowerCase()
            const isPro = Boolean(eff.is_pro || eff.vip_type || eff.item_effect_type === 1)

            if (name) {
              if (effectId) metaMap.set(String(effectId), { name, isPro })
              // Also key by the top-level effect folder ID extracted from path
              if (effPath) {
                metaMap.set(effPath, { name, isPro })
                const pathMatch = effPath.match(/[/\\]effect[/\\](\d+)[/\\]/)
                if (pathMatch) metaMap.set(pathMatch[1], { name, isPro })
              }
            }
          }
        }
      } catch {
        // Skip unparseable draft
      }
    }
  } catch (err) {
    logWarn(`Không thể quét thư mục draft CapCut: ${(err as Error).message}`)
  }

  return metaMap
}

/**
 * Clean and humanize an effect name from folder or file.
 */
let _humanizeCounter = 0
function humanizeEffectName(raw: string): string {
  // AE2Effect_TIMESTAMP → numbered effect
  if (/^AE2Effect_\d+$/i.test(raw)) {
    _humanizeCounter++
    return `Hiệu ứng video #${_humanizeCounter}`
  }
  // effect_portrait, effect_landscape, etc → clean up
  if (/^effect[_-]?(portrait|landscape|square)?$/i.test(raw)) {
    _humanizeCounter++
    return `Hiệu ứng video #${_humanizeCounter}`
  }
  if (/^Editor_Sticker_Config/i.test(raw)) {
    _humanizeCounter++
    return `Hiệu ứng hoạt họa #${_humanizeCounter}`
  }
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || `Hiệu ứng #${++_humanizeCounter}`
}

function findImageSequence(pngFiles: string[]): { folder: string; frames: string[] } | null {
  const groups = new Map<string, string[]>()
  for (const f of pngFiles) {
    const d = dirname(f)
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(f)
  }

  for (const [dir, files] of groups) {
    const parsed = files
      .map(f => {
        const m = basename(f).match(/^(.*?)(\d+)\.png$/i)
        return m ? { file: f, prefix: m[1], num: parseInt(m[2], 10) } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (parsed.length >= 6) {
      const byPrefix = new Map<string, typeof parsed>()
      for (const item of parsed) {
        if (!byPrefix.has(item.prefix)) byPrefix.set(item.prefix, [])
        byPrefix.get(item.prefix)!.push(item)
      }
      for (const [, list] of byPrefix) {
        if (list.length >= 6) {
          list.sort((a, b) => a.num - b.num)
          return { folder: dir, frames: list.map(x => x.file) }
        }
      }
    }
  }
  return null
}

async function getOrSynthesizeSequenceLoop(
  effectId: string,
  subId: string,
  frames: string[]
): Promise<{ videoPath: string; blendMode: OverlayBlendMode; thumbnailPath: string } | null> {
  const cacheDir = getGeneratedEffectCacheDir()
  await mkdir(cacheDir, { recursive: true })

  const safeName = `${effectId}_${subId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
  const metaJson = join(cacheDir, `${safeName}_meta.json`)
  const ffmpegCmd = (await resolveFfmpeg()) || 'ffmpeg'

  // Probe luminance of first frame to determine whether it's dark-on-white (multiply) or light-on-dark (screen)
  let blendMode: OverlayBlendMode = 'screen'
  try {
    const probeProc = spawn(ffmpegCmd, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', frames[0],
      '-vf', 'scale=1:1,format=gray',
      '-f', 'rawvideo',
      '-'
    ], { windowsHide: true })

    const chunks: Buffer[] = []
    probeProc.stdout?.on('data', (d: Buffer) => chunks.push(d))
    await new Promise<void>((resolve) => {
      probeProc.on('close', () => resolve())
      probeProc.on('error', () => resolve())
      setTimeout(resolve, 3000)
    })
    const outputBuf = Buffer.concat(chunks)
    if (outputBuf.length > 0 && outputBuf[0] > 128) {
      blendMode = 'multiply'
    }
  } catch {
    // default to screen
  }

  const outMp4 = join(cacheDir, `${safeName}_loop.mp4`)

  if (existsSync(outMp4) && existsSync(metaJson)) {
    try {
      const meta = JSON.parse(await readFile(metaJson, 'utf8'))
      const s = await stat(outMp4)
      if (s.size > 1000) {
        return {
          videoPath: outMp4,
          blendMode: meta.blendMode === 'multiply' ? 'multiply' : 'screen',
          thumbnailPath: frames[0]
        }
      }
    } catch {
      // re-synthesize
    }
  }

  // Concat demuxer repeating frames to reach ~2.5 - 3.5 seconds
  const concatPath = join(cacheDir, `${safeName}_concat.txt`)
  const lines: string[] = []
  const repeatCount = Math.max(2, Math.ceil(48 / frames.length))
  for (let r = 0; r < repeatCount; r++) {
    for (const f of frames) {
      const normalizedPath = f.replace(/\\/g, '/')
      lines.push(`file '${normalizedPath}'`)
      lines.push('duration 0.0416667')
    }
  }
  const lastNormalized = frames[frames.length - 1].replace(/\\/g, '/')
  lines.push(`file '${lastNormalized}'`)

  await writeFile(concatPath, lines.join('\n'), 'utf8')

  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(ffmpegCmd, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      outMp4
    ], { windowsHide: true })

    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
    setTimeout(() => {
      try { child.kill() } catch {}
      resolve(false)
    }, 15000)
  })

  rm(concatPath).catch(() => {})

  if (!ok || !existsSync(outMp4)) return null

  await writeFile(metaJson, JSON.stringify({ blendMode, frameCount: frames.length }, null, 2), 'utf8')
  logInfo(`Đã tự động chuyển đổi chuỗi ảnh CapCut sang video loop: ${safeName} (${frames.length} frames, mode: ${blendMode})`)

  return {
    videoPath: outMp4,
    blendMode,
    thumbnailPath: frames[0]
  }
}

/**
 * Scan CapCut effect cache for video loops and their alpha masks.
 */
export async function scanCapCutEffects(): Promise<CapCutScannedEffect[]> {
  _humanizeCounter = 0
  const cacheDir = getCapCutEffectCacheDir()
  if (!existsSync(cacheDir)) return []

  const draftMetaMap = await getDraftEffectMetaMap()
  const vaultEffects = await getSavedOverlayEffects()
  const savedIds = new Set(vaultEffects.map(e => e.id))

  const results: CapCutScannedEffect[] = []

  try {
    const topDirs = await readdir(cacheDir, { withFileTypes: true })
    for (const topDir of topDirs) {
      if (!topDir.isDirectory()) continue
      const topDirPath = join(cacheDir, topDir.name)

      // Traverse subdirectories (typically <effect_id>/<hash>/...)
      let subDirs: string[] = []
      try {
        const entries = await readdir(topDirPath, { withFileTypes: true })
        subDirs = entries.filter(e => e.isDirectory()).map(e => join(topDirPath, e.name))
      } catch {
        continue
      }

      if (subDirs.length === 0) subDirs = [topDirPath]

      for (const targetDir of subDirs) {
        // Recursively look for mp4 files
        const mp4Files: string[] = []
        const pngFiles: string[] = []
        const info = { configName: null as string | null }

        async function findFiles(dir: string, depth = 0): Promise<void> {
          if (depth > 4) return
          try {
            const files = await readdir(dir, { withFileTypes: true })
            for (const file of files) {
              const full = join(dir, file.name)
              if (file.isDirectory()) {
                await findFiles(full, depth + 1)
              } else if (file.isFile()) {
                const ext = extname(file.name).toLowerCase()
                if (ext === '.mp4') mp4Files.push(full)
                else if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') pngFiles.push(full)
                else if (file.name === 'config.json' && !info.configName) {
                  try {
                    const cfg = JSON.parse(await readFile(full, 'utf8'))
                    if (cfg?.name && typeof cfg.name === 'string') info.configName = cfg.name
                  } catch {
                    // ignore
                  }
                }
              }
            }
          } catch {
            // ignore
          }
        }

        await findFiles(targetDir)

        let sequenceInfo: Awaited<ReturnType<typeof getOrSynthesizeSequenceLoop>> = null
        if (mp4Files.length === 0) {
          const seq = findImageSequence(pngFiles)
          if (seq) {
            sequenceInfo = await getOrSynthesizeSequenceLoop(topDir.name, basename(targetDir), seq.frames)
            if (sequenceInfo) {
              mp4Files.push(sequenceInfo.videoPath)
            }
          }
        }

        if (mp4Files.length === 0) continue

        // Identify matte / alpha file if present
        const mattePath = mp4Files.find(p => {
          const fn = basename(p).toLowerCase()
          return fn.startsWith('matte')
        })

        // Identify main video file (priority: Portrait > Effect > any other)
        const nonMatteVideos = mp4Files.filter(p => p !== mattePath)
        if (nonMatteVideos.length === 0) continue

        const portraitVideo = nonMatteVideos.find(p => {
          const fn = basename(p).toLowerCase()
          return fn.includes('potrait') || fn.includes('portrait') || fn.includes('potret')
        })
        const landscapeVideo = nonMatteVideos.find(p => basename(p).toLowerCase().includes('landscape'))
        const squareVideo = nonMatteVideos.find(p => basename(p).toLowerCase().includes('square'))

        const mainVideo = portraitVideo || nonMatteVideos.find(p => basename(p).toLowerCase().startsWith('effect')) || nonMatteVideos[0]

        // Aspect ratio
        let aspectRatio: CapCutScannedEffect['aspectRatio'] = 'unknown'
        if (mainVideo === portraitVideo) aspectRatio = 'portrait'
        else if (mainVideo === landscapeVideo) aspectRatio = 'landscape'
        else if (mainVideo === squareVideo) aspectRatio = 'square'

        // Determine name — reject raw IDs like "AE2Effect_TIMESTAMP" from config.json
        const normalizedTargetDir = targetDir.replace(/\\/g, '/').toLowerCase()
        const metaFromDraft = draftMetaMap.get(topDir.name) || draftMetaMap.get(normalizedTargetDir)

        const isUsableName = (n: string | null | undefined): n is string =>
          !!n && !/^AE2Effect_\d+$/i.test(n) && !/^Editor_Sticker_Config/i.test(n) && !/^effect[_-]?(portrait|landscape|square)?$/i.test(n) && n.length > 1

        let displayName = ''
        if (isUsableName(metaFromDraft?.name)) displayName = metaFromDraft!.name
        else if (isUsableName(info.configName)) displayName = info.configName
        if (!displayName) {
          const rawName = basename(mainVideo, extname(mainVideo))
          displayName = humanizeEffectName(rawName)
        }

        // Determine thumbnail
        const thumb = sequenceInfo?.thumbnailPath || pngFiles.find(p => {
          const fn = basename(p).toLowerCase()
          return !fn.includes('alpha') && !fn.includes('mask')
        }) || pngFiles[0]

        const effectId = `${topDir.name}_${basename(targetDir)}`
        const isPro = Boolean(metaFromDraft?.isPro || info.configName?.toLowerCase().includes('pro') || topDir.name.toLowerCase().includes('vip'))
        const chromaKey = !mattePath && !sequenceInfo ? await readCapCutChromaKey(targetDir) : undefined
        const blendMode: OverlayBlendMode = mattePath ? 'alphamerge' : (chromaKey ? 'chromakey' : (sequenceInfo ? sequenceInfo.blendMode : 'screen'))

        results.push({
          id: effectId,
          name: displayName,
          folderPath: targetDir,
          videoPath: mainVideo,
          mattePath,
          thumbnailPath: thumb,
          blendMode,
          chromaKey,
          isPro,
          aspectRatio,
          isSaved: savedIds.has(effectId)
        })
      }
    }
  } catch (err) {
    logWarn(`Lỗi khi quét kho hiệu ứng CapCut: ${(err as Error).message}`)
  }

  // Sort: Portrait first, saved first, then by name
  return results.sort((a, b) => {
    if (a.aspectRatio === 'portrait' && b.aspectRatio !== 'portrait') return -1
    if (b.aspectRatio === 'portrait' && a.aspectRatio !== 'portrait') return 1
    return a.name.localeCompare(b.name, 'vi')
  })
}

/**
 * Get all permanent saved overlay effects in TediaPros Vault.
 */
export async function getSavedOverlayEffects(): Promise<SavedOverlayEffect[]> {
  const vaultDir = getTediaProsVaultDir()
  if (!existsSync(vaultDir)) return []

  const saved: SavedOverlayEffect[] = []
  try {
    const folders = await readdir(vaultDir, { withFileTypes: true })
    for (const f of folders) {
      if (!f.isDirectory()) continue
      const metaPath = join(vaultDir, f.name, 'metadata.json')
      if (!existsSync(metaPath)) continue

      try {
        const checkedMeta = await assertContainedRegularFile(metaPath, vaultDir, 'Metadata kho hiệu ứng')
        const raw = await readFile(checkedMeta, 'utf8')
        const meta = JSON.parse(raw)
        const videoPath = await assertContainedRegularFile(join(vaultDir, f.name, meta.videoFile || 'video.mp4'), join(vaultDir, f.name), 'Video trong kho hiệu ứng')

        const mattePath = meta.matteFile && existsSync(join(vaultDir, f.name, meta.matteFile)) ? await assertContainedRegularFile(join(vaultDir, f.name, meta.matteFile), join(vaultDir, f.name), 'Matte trong kho hiệu ứng') : undefined
        const thumbnailPath = meta.thumbnailFile && existsSync(join(vaultDir, f.name, meta.thumbnailFile)) ? await assertContainedRegularFile(join(vaultDir, f.name, meta.thumbnailFile), join(vaultDir, f.name), 'Ảnh trong kho hiệu ứng') : undefined
        const chromaKey = meta.chromaKey ? normalizeOverlayChromaKey(meta.chromaKey) : await resolveOverlayChromaKey(videoPath)
        const blendMode: OverlayBlendMode = chromaKey ? 'chromakey' : (meta.blendMode === 'multiply' ? 'multiply' : (meta.blendMode === 'alphamerge' ? 'alphamerge' : 'screen'))

        saved.push({
          id: meta.id || f.name,
          name: meta.name || f.name,
          videoPath,
          mattePath: mattePath && existsSync(mattePath) ? mattePath : undefined,
          thumbnailPath: thumbnailPath && existsSync(thumbnailPath) ? thumbnailPath : undefined,
          blendMode,
          chromaKey,
          isPro: Boolean(meta.isPro),
          savedAt: meta.savedAt || Date.now()
        })
      } catch {
        // Skip corrupted metadata
      }
    }
  } catch (err) {
    logWarn(`Không thể đọc kho hiệu ứng TediaPros: ${(err as Error).message}`)
  }

  return saved.sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Save / freeze an effect into TediaPros Permanent Vault so it never gets deleted by CapCut cache cleaners.
 */
export async function saveOverlayToVault(item: CapCutScannedEffect): Promise<SavedOverlayEffect> {
  const vaultDir = getTediaProsVaultDir()
  const sanitizedId = item.id.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!sanitizedId) throw new Error('ID hiệu ứng không hợp lệ.')
  const targetDir = join(vaultDir, sanitizedId)
  const chromaKey = item.chromaKey ? normalizeOverlayChromaKey(item.chromaKey) : await resolveOverlayChromaKey(item.videoPath)
  const blendMode = chromaKey ? 'chromakey' : item.blendMode

  const checkedSource = async (candidate: string): Promise<string> => {
    for (const root of [getCapCutEffectCacheDir(), getGeneratedEffectCacheDir()]) {
      if (containedParts(candidate, root)) return assertContainedRegularFile(candidate, root, 'Tài nguyên hiệu ứng')
    }
    throw new Error('Tài nguyên nằm ngoài thư mục hiệu ứng cho phép.')
  }
  const sourceVideo = await checkedSource(item.videoPath)
  const sourceMatte = item.mattePath && existsSync(item.mattePath) ? await checkedSource(item.mattePath) : undefined
  const sourceThumb = item.thumbnailPath && existsSync(item.thumbnailPath) ? await checkedSource(item.thumbnailPath) : undefined
  await mkdir(vaultDir, { recursive: true })
  await assertContainedParentDirectory(targetDir, vaultDir, 'Thư mục hiệu ứng')
  await mkdir(targetDir, { recursive: true })
  await assertContainedParentDirectory(join(targetDir, 'metadata.json'), vaultDir, 'Metadata hiệu ứng')

  // Copy video
  const videoExt = extname(item.videoPath) || '.mp4'
  const videoFile = `video${videoExt}`
  const targetVideoPath = join(targetDir, videoFile)
  await publishVaultFile(targetVideoPath, vaultDir, temp => copyFile(sourceVideo, temp, constants.COPYFILE_EXCL))

  // Copy matte if present
  let matteFile: string | undefined
  let targetMattePath: string | undefined
  if (sourceMatte) {
    const matteExt = extname(sourceMatte) || '.mp4'
    matteFile = `matte${matteExt}`
    targetMattePath = join(targetDir, matteFile)
    await publishVaultFile(targetMattePath, vaultDir, temp => copyFile(sourceMatte, temp, constants.COPYFILE_EXCL))
  }

  // Copy thumbnail if present
  let thumbnailFile: string | undefined
  let targetThumbPath: string | undefined
  if (sourceThumb) {
    const thumbExt = extname(sourceThumb) || '.png'
    thumbnailFile = `thumbnail${thumbExt}`
    targetThumbPath = join(targetDir, thumbnailFile)
    await publishVaultFile(targetThumbPath, vaultDir, temp => copyFile(sourceThumb, temp, constants.COPYFILE_EXCL))
  }

  const metaContent = {
    id: item.id,
    name: item.name,
    videoFile,
    matteFile,
    thumbnailFile,
    blendMode,
    chromaKey,
    isPro: item.isPro,
    savedAt: Date.now()
  }

  await publishVaultMetadata(join(targetDir, 'metadata.json'), vaultDir, metaContent)
  logInfo(`Đã lưu hiệu ứng vào kho vĩnh viễn TediaPros: ${item.name} (${item.id})`)

  return {
    id: item.id,
    name: item.name,
    videoPath: targetVideoPath,
    mattePath: targetMattePath,
    thumbnailPath: targetThumbPath,
    blendMode,
    chromaKey,
    isPro: item.isPro,
    savedAt: metaContent.savedAt
  }
}

/**
 * Remove an effect from TediaPros Permanent Vault.
 */
export async function deleteOverlayFromVault(id: string): Promise<boolean> {
  const vaultDir = getTediaProsVaultDir()
  const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const targetDir = join(vaultDir, sanitizedId)

  if (!existsSync(targetDir)) return false

  try {
    await rm(targetDir, { recursive: true, force: true })
    logInfo(`Đã xoá hiệu ứng khỏi kho TediaPros: ${id}`)
    return true
  } catch (err) {
    logWarn(`Lỗi khi xoá hiệu ứng ${id}: ${(err as Error).message}`)
    return false
  }
}
