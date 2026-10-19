import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { AutoShortItemResult, PlaylistEntry } from '../shared/types'
import type { FacebookReelsChannel } from '../shared/facebookReels'
import type { ReelsNotice, ReelsWatch } from '../shared/facebookReelsMonitor'
import type { ReelsMonitorDependencies } from './facebookReelsMonitor'
import { externalArticleUrl, articleLinksFromMessage } from '../shared/facebookArticleLinks'
import { downloadArticleThumbnail } from './facebookArticle'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { atomicWorkflowWrite, ReelsWorkflowStore, type ReelsWorkflowItem } from './reelsWorkflowStore'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 800)
const unfinished = (state: string): boolean => !['done','disabled','no-link'].includes(state)

export async function runDailyReelsWorkflow(
  entries: PlaylistEntry[], day: string, watch: ReelsWatch, channel: FacebookReelsChannel,
  notice: ReelsNotice, deps: ReelsMonitorDependencies, signal: AbortSignal,
  progress: (text: string) => void, canContinue: () => Promise<boolean>
): Promise<{ incomplete: boolean; reason: string; worked: boolean }> {
  const store = new ReelsWorkflowStore(channel.outputDir, channel.key), items = await store.read()
  const touchedDays = new Set<string>(), attempted = new Set<ReelsWorkflowItem>()
  const completedThisRun = new Set<ReelsWorkflowItem>()
  for (const entry of entries) {
    if (items.some(i => i.id === entry.id && i.account === watch.account)) continue
    const ordinal = items.filter(i => i.day === day).length + 1
    items.push({ id: entry.id, account: watch.account, day, stem: `${String(ordinal).padStart(3, '0')}_${entry.id}`,
      entry, video: 'pending', caption: 'pending', article: watch.autoExportArticle !== false ? 'pending' : 'disabled',
      autoshort: watch.autoRunAutoShort === true ? 'pending' : 'disabled', excel: 'pending' })
  }
  if (entries.length) await store.save(items)
  const pending = items.filter(i => i.account === watch.account && (unfinished(i.video) || unfinished(i.caption) ||
    (watch.autoExportArticle !== false && unfinished(i.article)) || (watch.autoRunAutoShort === true && unfinished(i.autoshort)) || unfinished(i.excel || 'pending')))
  let stopped = false
  for (const item of pending) {
    if (signal.aborted || !await canContinue()) { stopped = true; break }
    attempted.add(item); touchedDays.add(item.day); item.excel = 'pending'; item.error = undefined
    const dirs = await store.directories(item.day)
    notice.outputDir = dirs.day
    try {
      if (item.video !== 'done') {
        progress(`Đang tải ${item.id}…`)
        const result = await deps.download(item.entry, channel, watch, signal, dirs.video, item.stem)
        if (!result.ok || !result.file) throw Error(result.error || 'Không tải được video.')
        await assertContainedRegularFile(result.file, channel.outputDir, 'Video workflow')
        item.file = result.file; item.video = 'done'
        await store.save(items) // receipt before download-history commit
        if (result.skipped) notice.skipped++; else notice.downloaded++
      }
      await assertContainedRegularFile(item.file!, channel.outputDir, 'Video workflow')
      await deps.library.recordCopy(item.id, item.file!, channel.outputDir)
      if (notice.videos.length < 100) notice.videos.push({ id: item.id, title: item.entry.title.slice(0, 500), file: item.file!, autoshortFile: item.outputPath })
    } catch (error) {
      if (item.video !== 'done') item.video = signal.aborted ? 'cancelled' : 'error'
      item.error = message(error); notice.failed++
      await store.save(items)
      if (signal.aborted || notice.failed >= 3) { stopped = true; break }
      continue
    }
    if (signal.aborted) break
    try {
      if (item.caption !== 'done') {
        const resolved = deps.resolveDetails ? await deps.resolveDetails(item.entry, signal, watch.account, watch) : item.entry
        signal.throwIfAborted()
        item.entry = resolved
        const caption = resolved.facebook?.caption || ''
        const path = join(dirs.caption, `${item.stem}.txt`)
        await atomicWorkflowWrite(path, channel.outputDir, caption)
        item.captionPath = path; item.caption = caption ? 'done' : 'error'
        if (!caption) item.error = 'Chưa lấy được caption đầy đủ.'
      }
      if (watch.autoExportArticle !== false && unfinished(item.article)) {
        progress(`Đang cào bài và chapter ${item.id}…`)
        const caption = item.entry.facebook?.caption || ''
        const links = [...(item.entry.facebook?.links || []).map(l => l.url), ...articleLinksFromMessage({ text: caption })]
        item.targetUrl = links.map(externalArticleUrl).find((url): url is string => !!url)
        if (!item.targetUrl) item.article = item.caption === 'done' ? 'no-link' : 'error'
        else {
          if (!deps.fetchArticle) throw Error('Chưa kết nối bộ cào bài viết.')
          const article = await deps.fetchArticle(item.targetUrl, signal)
          signal.throwIfAborted()
          item.articleTitle = article.title; item.articleStopReason = article.stopReason
          if (article.status !== 'success' || !article.content) throw Error(article.error || 'Không trích xuất được bài viết.')
          const path = join(dirs.article, `${item.stem}.txt`)
          await atomicWorkflowWrite(path, channel.outputDir, article.content)
          item.articlePath = path
          for (const chapter of article.chapters || []) {
            if (!Number.isSafeInteger(chapter.index) || chapter.index < 1) throw Error('Số chapter không hợp lệ.')
            const chaptersDir = join(dirs.article, `${item.stem}_chapters`)
            await assertContainedParentDirectory(join(chaptersDir, '.check'), channel.outputDir, 'Thư mục chapter')
            await mkdir(chaptersDir, { recursive: true })
            await atomicWorkflowWrite(join(chaptersDir, `chapter_${String(chapter.index).padStart(2, '0')}.txt`), channel.outputDir, `${chapter.title}\n\n${chapter.content}`)
          }
          if (article.thumbnailUrl) {
            item.thumbnailUrl = article.thumbnailUrl
            try {
              progress(`Đang tải thumbnail ${item.id}…`)
              const fetchThumb = deps.thumbnail || downloadArticleThumbnail
              const thumb = await fetchThumb(article.thumbnailUrl, signal)
              if (thumb && thumb.buffer.length > 0) {
                const thumbPath = join(dirs.thumbnail, `${item.stem}${thumb.ext}`)
                await atomicWorkflowWrite(thumbPath, channel.outputDir, thumb.buffer)
                item.thumbnailPath = thumbPath
              }
            } catch {
              // Non-fatal error for thumbnail download
            }
          }
          item.article = article.completion === 'partial' ? 'partial' : 'done'
          if (item.article === 'partial') item.error = `Bài viết chưa đầy đủ: ${article.stopReason || 'unknown'}`
        }
      }
    } catch (error) {
      if (item.caption !== 'done') item.caption = signal.aborted ? 'cancelled' : 'error'
      if (watch.autoExportArticle !== false && unfinished(item.article)) item.article = signal.aborted ? 'cancelled' : 'error'
      item.error = message(error)
    }
    await store.save(items)
    await deps.changed?.()
  }

  if (watch.autoRunAutoShort === true && deps.runAutoShort && !signal.aborted && !stopped) {
    // A crash may occur after the core committed its receipt but before our ledger write.
    const jobIds = new Set(pending.filter(i => i.jobId && unfinished(i.autoshort)).map(i => i.jobId!))
    if (deps.recoverAutoShort) for (const jobId of jobIds) {
      const results = await deps.recoverAutoShort(jobId)
      for (const result of results) {
        const item = pending.find(i => i.jobId === jobId && i.file === result.filePath)
        if (item && result.status === 'done' && result.outputPath) {
          await assertContainedRegularFile(result.outputPath, join(channel.outputDir, item.day, 'autoshort'), 'Output AutoShort phục hồi')
          item.autoshort = 'done'; item.outputPath = result.outputPath
          completedThisRun.add(item)
          touchedDays.add(item.day); attempted.add(item)
        }
      }
    }
    await store.save(items)
    for (const outputDay of new Set(pending.map(i => i.day))) {
      const candidates = pending.filter(i => i.day === outputDay && i.video === 'done' && i.file && unfinished(i.autoshort))
      for (let offset = 0; offset < candidates.length && !signal.aborted; offset += 500) {
        if (!await canContinue()) { stopped = true; break }
        const batch = candidates.slice(offset, offset + 500), dirs = await store.directories(outputDay)
        const result = async (receipt: AutoShortItemResult): Promise<void> => {
          const item = batch.find(i => i.file === receipt.filePath)
          if (!item) throw Error('AutoShort trả kết quả không khớp đầu vào.')
          if (receipt.status === 'done' && receipt.outputPath) {
            await assertContainedRegularFile(receipt.outputPath, dirs.autoshort, 'Output AutoShort')
            item.autoshort = 'done'; item.outputPath = receipt.outputPath
            const video = notice.videos.find(v => v.id === item.id)
            if (video) video.autoshortFile = receipt.outputPath
          } else { item.autoshort = receipt.status === 'cancelled' ? 'cancelled' : 'error'; item.error = receipt.error || 'AutoShort không trả file thành phẩm.' }
          await store.save(items)
          if (item.autoshort === 'done') completedThisRun.add(item)
        }
        batch.forEach(i => { i.autoshort = 'running'; attempted.add(i); touchedDays.add(i.day) })
        await store.save(items)
        try {
          if (watch.autoShortPresetId) throw Error('Preset AutoShort theo kênh chưa được hỗ trợ. Hãy lưu lại lựa chọn theo dõi để dùng cấu hình hiện tại.')
          const results = await deps.runAutoShort(batch.map(i => i.file!), dirs.autoshort, signal,
            p => progress(`AutoShort (${p.index}/${p.total}): ${p.message}`), {
              started: async (jobId, configRevision) => { batch.forEach(i => { i.jobId = jobId; i.configRevision = configRevision }); await store.save(items) }, result
            })
          for (const receipt of results) await result(receipt)
          for (const item of batch.filter(i => i.autoshort === 'running')) { item.autoshort = 'error'; item.error = 'AutoShort thiếu kết quả cho video.' }
        } catch (error) {
          for (const item of batch.filter(i => i.autoshort !== 'done')) { item.autoshort = signal.aborted ? 'cancelled' : 'error'; item.error = message(error) }
        }
        await store.save(items)
      }
    }
  }
  notice.autoShortProcessed = completedThisRun.size
  notice.autoShortFailed = [...attempted].filter(i => watch.autoRunAutoShort === true && unfinished(i.autoshort)).length
  const errors: string[] = []
  for (const outputDay of touchedDays) {
    try {
      await store.exportDay(outputDay, items)
      items.filter(i => i.day === outputDay).forEach(i => { i.excel = 'done' })
    } catch (error) {
      items.filter(i => i.day === outputDay).forEach(i => { i.excel = 'error'; i.error = `Excel: ${message(error)}` })
      errors.push(`Excel: ${message(error)}`)
    }
    await store.save(items)
  }
  const incompleteItems = [...attempted].filter(i => unfinished(i.video) || unfinished(i.caption) ||
    (watch.autoExportArticle !== false && unfinished(i.article)) || (watch.autoRunAutoShort === true && unfinished(i.autoshort)))
  if (incompleteItems.length) errors.push(`${incompleteItems.length} video còn bước chưa hoàn tất. ${incompleteItems[0].error || ''}`)
  if (stopped) errors.push('Đã dừng; công việc chưa xong được giữ để chạy lại ở lượt kế tiếp.')
  return { incomplete: errors.length > 0, reason: errors.join(' ').slice(0, 1000), worked: attempted.size > 0 }
}
