import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import type { PlaylistEntry } from '../shared/types'
import { facebookReelId } from '../shared/facebookReels'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'

export type WorkflowStage = 'pending' | 'running' | 'done' | 'error' | 'cancelled' | 'disabled' | 'no-link' | 'partial'
export interface ReelsWorkflowItem {
  id: string; account: string; day: string; stem: string; entry: PlaylistEntry
  video: WorkflowStage; caption: WorkflowStage; article: WorkflowStage; autoshort: WorkflowStage
  excel?: WorkflowStage
  file?: string; captionPath?: string; articlePath?: string; outputPath?: string
  thumbnailPath?: string; thumbnailUrl?: string
  targetUrl?: string; articleTitle?: string; articleStopReason?: string
  jobId?: string; configRevision?: string; error?: string
}

export async function atomicWorkflowWrite(path: string, root: string, data: string | Buffer): Promise<void> {
  await assertContainedParentDirectory(path, root, 'Workflow Reels')
  try { await lstat(path); await assertContainedRegularFile(path, root, 'Workflow Reels') }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const temp = `${path}.${randomUUID()}.tmp`
  await assertContainedParentDirectory(temp, root, 'Workflow Reels')
  try {
    await writeFile(temp, data, { flag: 'wx' })
    await assertContainedRegularFile(temp, root, 'Workflow Reels')
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}

/** Per channel ledger, independent of capped notifications and download history. */
export class ReelsWorkflowStore {
  constructor(readonly root: string, private readonly channelKey: string) {}
  async read(): Promise<ReelsWorkflowItem[]> {
    const path = join(this.root, '.reels-workflow.json')
    try { await lstat(path) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    await assertContainedRegularFile(path, this.root, 'Ledger Reels')
    if ((await lstat(path)).size > 32 * 1024 * 1024) throw Error('Ledger Reels quá lớn.')
    const data = JSON.parse(await readFile(path, 'utf8'))
    if (data.version !== 1 || data.channelKey !== this.channelKey || !Array.isArray(data.items) || data.items.length > 10000) throw Error('Ledger Reels không hợp lệ.')
    const keys = new Set<string>()
    for (const item of data.items as ReelsWorkflowItem[]) {
      if (item && item.excel === undefined) item.excel = 'pending'
      const key = `${item?.account}:${item?.id}`
      if (!item || !/^\d{5,30}$/.test(item.id) || !/^(guest|[a-f0-9]{64})$/.test(item.account) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.day) || !/^\d+_\d{5,30}$/.test(item.stem) ||
        !item.entry || item.entry.id !== item.id || facebookReelId(item.entry.url) !== item.id || !item.entry.facebook?.sourceVerified || typeof item.entry.title !== 'string' ||
        [item.video, item.caption, item.article, item.autoshort, item.excel!].some(s => !['pending','running','done','error','cancelled','disabled','no-link','partial'].includes(s)) || keys.has(key)) throw Error('Mục ledger Reels không hợp lệ.')
      keys.add(key)
      for (const file of [item.file, item.captionPath, item.articlePath, item.outputPath, item.thumbnailPath]) if (file !== undefined) await assertContainedParentDirectory(file, this.root, 'Đường dẫn ledger Reels')
    }
    return data.items
  }
  async save(items: ReelsWorkflowItem[]): Promise<void> {
    const raw = JSON.stringify({ version: 1, channelKey: this.channelKey, items })
    if (items.length > 10000 || Buffer.byteLength(raw) > 32 * 1024 * 1024) throw Error('Ledger Reels quá lớn.')
    await atomicWorkflowWrite(join(this.root, '.reels-workflow.json'), this.root, raw)
  }
  async directories(day: string): Promise<Record<'day'|'video'|'caption'|'article'|'thumbnail'|'excel'|'autoshort', string>> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error('Ngày workflow không hợp lệ.')
    const directory = join(this.root, day)
    await assertContainedParentDirectory(join(directory, '.check'), this.root, 'Thư mục ngày')
    await mkdir(directory, { recursive: true })
    const dirs = { day: directory, video: join(directory, 'video'), caption: join(directory, 'caption'), article: join(directory, 'article'), thumbnail: join(directory, 'thumbnail'), excel: join(directory, 'excel'), autoshort: join(directory, 'autoshort') }
    for (const dir of Object.values(dirs)) {
      await assertContainedParentDirectory(join(dir, '.check'), this.root, 'Thư mục workflow')
      await mkdir(dir, { recursive: true })
    }
    return dirs
  }
  async exportDay(day: string, items: ReelsWorkflowItem[]): Promise<void> {
    const dirs = await this.directories(day), wb = new ExcelJS.Workbook(), sheet = wb.addWorksheet('Reels Content')
    sheet.columns = ['Reel ID','Link Reel','Caption','Link Web','Nội dung bài viết','Video','Caption status','Article status','Article stop reason','AutoShort status','AutoShort output','Link Thumbnail','File thumbnail','Error']
      .map(header => ({ header, width: 35 }))
    sheet.views = [{ state: 'frozen', ySplit: 1 }]; sheet.getRow(1).font = { bold: true }
    const readText = async (path?: string): Promise<string> => {
      if (!path) return ''
      await assertContainedRegularFile(path, this.root, 'Nội dung Excel Reels')
      const text = await readFile(path, 'utf8')
      return text.length > 32767 ? text.slice(0, 32700) + '\n[Nội dung đầy đủ trong TXT]' : text
    }
    for (const item of items.filter(i => i.day === day)) {
      sheet.addRow([item.id, item.entry.url, await readText(item.captionPath), item.targetUrl || '', await readText(item.articlePath),
        item.file || '', item.caption, item.article, item.articleStopReason || '', item.autoshort, item.outputPath || '', item.thumbnailUrl || '', item.thumbnailPath || '', item.error || ''])
    }
    await atomicWorkflowWrite(join(dirs.excel, 'reels_content.xlsx'), this.root, Buffer.from(await wb.xlsx.writeBuffer()))
  }
}
