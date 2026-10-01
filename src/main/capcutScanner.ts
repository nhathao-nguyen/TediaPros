import { existsSync } from 'node:fs'
import { readdir, readFile, mkdir, copyFile, stat, rm, writeFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
import type { CapCutScannedEffect, SavedOverlayEffect } from '../shared/videoEffects'
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

export function getTediaProsVaultDir(): string {
  const userData = app?.getPath?.('userData') || join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'tedia-pros')
  return join(userData, 'library', 'effects')
}

/**
 * Scan recent CapCut draft_content.json files to discover human-readable names and metadata for effects.
 */
async function getDraftEffectMetaMap(): Promise<Map<string, { name: string; isPro?: boolean }>> {
  const metaMap = new Map<string, { name: string; isPro?: boolean }>()
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
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || `Hiệu ứng #${++_humanizeCounter}`
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
          !!n && !/^AE2Effect_\d+$/i.test(n) && !/^effect[_-]?(portrait|landscape|square)?$/i.test(n) && n.length > 1

        let displayName = ''
        if (isUsableName(metaFromDraft?.name)) displayName = metaFromDraft!.name
        else if (isUsableName(info.configName)) displayName = info.configName
        if (!displayName) {
          const rawName = basename(mainVideo, extname(mainVideo))
          displayName = humanizeEffectName(rawName)
        }

        // Determine thumbnail
        const thumb = pngFiles.find(p => {
          const fn = basename(p).toLowerCase()
          return !fn.includes('alpha') && !fn.includes('mask')
        }) || pngFiles[0]

        const effectId = `${topDir.name}_${basename(targetDir)}`
        const isPro = Boolean(metaFromDraft?.isPro || info.configName?.toLowerCase().includes('pro') || topDir.name.toLowerCase().includes('vip'))

        results.push({
          id: effectId,
          name: displayName,
          folderPath: targetDir,
          videoPath: mainVideo,
          mattePath,
          thumbnailPath: thumb,
          blendMode: mattePath ? 'alphamerge' : 'screen',
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
        const raw = await readFile(metaPath, 'utf8')
        const meta = JSON.parse(raw)
        const videoPath = join(vaultDir, f.name, meta.videoFile || 'video.mp4')
        if (!existsSync(videoPath)) continue

        const mattePath = meta.matteFile ? join(vaultDir, f.name, meta.matteFile) : undefined
        const thumbnailPath = meta.thumbnailFile ? join(vaultDir, f.name, meta.thumbnailFile) : undefined

        saved.push({
          id: meta.id || f.name,
          name: meta.name || f.name,
          videoPath,
          mattePath: mattePath && existsSync(mattePath) ? mattePath : undefined,
          thumbnailPath: thumbnailPath && existsSync(thumbnailPath) ? thumbnailPath : undefined,
          blendMode: meta.blendMode === 'alphamerge' ? 'alphamerge' : 'screen',
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
  const targetDir = join(vaultDir, sanitizedId)

  await mkdir(targetDir, { recursive: true })

  // Copy video
  const videoExt = extname(item.videoPath) || '.mp4'
  const videoFile = `video${videoExt}`
  const targetVideoPath = join(targetDir, videoFile)
  await copyFile(item.videoPath, targetVideoPath)

  // Copy matte if present
  let matteFile: string | undefined
  let targetMattePath: string | undefined
  if (item.mattePath && existsSync(item.mattePath)) {
    const matteExt = extname(item.mattePath) || '.mp4'
    matteFile = `matte${matteExt}`
    targetMattePath = join(targetDir, matteFile)
    await copyFile(item.mattePath, targetMattePath)
  }

  // Copy thumbnail if present
  let thumbnailFile: string | undefined
  let targetThumbPath: string | undefined
  if (item.thumbnailPath && existsSync(item.thumbnailPath)) {
    const thumbExt = extname(item.thumbnailPath) || '.png'
    thumbnailFile = `thumbnail${thumbExt}`
    targetThumbPath = join(targetDir, thumbnailFile)
    await copyFile(item.thumbnailPath, targetThumbPath)
  }

  const metaContent = {
    id: item.id,
    name: item.name,
    videoFile,
    matteFile,
    thumbnailFile,
    blendMode: item.blendMode,
    isPro: item.isPro,
    savedAt: Date.now()
  }

  await writeFile(join(targetDir, 'metadata.json'), JSON.stringify(metaContent, null, 2), 'utf8')
  logInfo(`Đã lưu hiệu ứng vào kho vĩnh viễn TediaPros: ${item.name} (${item.id})`)

  return {
    id: item.id,
    name: item.name,
    videoPath: targetVideoPath,
    mattePath: targetMattePath,
    thumbnailPath: targetThumbPath,
    blendMode: item.blendMode,
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
