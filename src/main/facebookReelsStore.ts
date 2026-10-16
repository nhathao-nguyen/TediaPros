import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { facebookReelId, facebookReelsSource, type FacebookReelsRequest } from '../shared/facebookReels'
import type { PlaylistProbe } from '../shared/types'
import { externalArticleUrl } from '../shared/facebookArticleLinks'

const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const maxBytes = 8 * 1024 * 1024
const ttl = 7 * 24 * 60 * 60 * 1000

/** Only a digest of source/account/proxy context is retained, never credentials. */
export function reelsContext(request: FacebookReelsRequest, account = 'guest'): string {
  const source = facebookReelsSource(request.url)
  if (!source) throw new Error('Nguồn Reels không hợp lệ.')
  return createHash('sha256').update(JSON.stringify([source.key, !!request.useCookies, request.proxy ?? '', account])).digest('hex')
}

export class FacebookReelsStore {
  constructor(private readonly root: string) {}
  private path(key: string): string {
    if (!keyPattern.test(key)) throw new Error('Mã tiếp tục Reels không hợp lệ.')
    return join(this.root, `${key}.json`)
  }
  async load(key: string, context: string): Promise<PlaylistProbe> {
    const path = await assertContainedRegularFile(this.path(key), this.root, 'Reels checkpoint')
    if ((await stat(path)).size > maxBytes) throw new Error('Checkpoint Reels quá lớn.')
    const data = JSON.parse(await readFile(path, 'utf8'))
    if (data.version !== 1 || data.context !== context || !Number.isFinite(data.savedAt) ||
      Date.now() - data.savedAt > ttl || data.savedAt > Date.now() + 60000) throw new Error('Lượt quét đã hết hạn hoặc khác nguồn/tài khoản/proxy.')
    const p = data.playlist as PlaylistProbe
    if (!p?.isPlaylist || typeof p.title !== 'string' || !p.facebook || !facebookReelsSource(p.facebook.sourceUrl) ||
      !Array.isArray(p.entries) || p.entries.length > 10000 || p.count !== p.entries.length) throw new Error('Checkpoint Reels hỏng.')
    const seen = new Set<string>()
    for (const e of p.entries) {
      if (!e || typeof e.id !== 'string' || facebookReelId(e.url) !== e.id || typeof e.title !== 'string' ||
        seen.has(e.id) || !e.facebook || !['verified','unverified','missing','error'].includes(e.facebook.status) ||
        !['graphql','ytdlp','dom','missing'].includes(e.facebook.titleSource) ||
        (e.facebook.caption !== null && typeof e.facebook.caption !== 'string')) throw new Error('Dữ liệu Reel trong checkpoint không hợp lệ.')
      if ((e.facebook.sourceVerified!=null&&typeof e.facebook.sourceVerified!=='boolean')||
        (e.facebook.ownerId!=null&&(typeof e.facebook.ownerId!=='string'||!/^\d{5,30}$/.test(e.facebook.ownerId)))||
        (e.facebook.links!=null&&(!Array.isArray(e.facebook.links)||e.facebook.links.length>100||e.facebook.links.some(l=>
          !l||typeof l.url!=='string'||externalArticleUrl(l.url)!==l.url||!['caption','comment'].includes(l.foundIn)))))throw Error('Link/nguồn Reel trong checkpoint không hợp lệ.')
      seen.add(e.id)
    }
    return p
  }
  async save(context: string, playlist: PlaylistProbe, previousKey?: string): Promise<string> {
    await mkdir(this.root, { recursive: true })
    const key = previousKey ?? randomUUID()
    const path = this.path(key); const temp = join(this.root, `${key}.${randomUUID()}.tmp`)
    await assertContainedParentDirectory(path, this.root, 'Reels checkpoint')
    const raw = JSON.stringify({ version: 1, context, savedAt: Date.now(), playlist })
    if (Buffer.byteLength(raw) > maxBytes) throw new Error('Checkpoint Reels quá lớn.')
    try { await writeFile(temp, raw, { flag: 'wx' }); await rename(temp, path) }
    finally { await rm(temp, { force: true }) }
    // Bound disk use, excluding the checkpoint just written. Remove only checked regular files.
    const files: { path: string; time: number }[] = []
    for (const name of (await readdir(this.root)).filter(n => keyPattern.test(n.replace(/\.json$/, '')) && n.endsWith('.json'))) {
      try {
        const candidate = await assertContainedRegularFile(join(this.root, name), this.root, 'Reels checkpoint cleanup')
        files.push({ path: candidate, time: (await stat(candidate)).mtimeMs })
      } catch { /* Do not touch foreign entries or links. */ }
    }
    files.sort((a, b) => b.time - a.time)
    for (const [i, file] of files.entries()) if (file.path !== path && (i >= 16 || Date.now() - file.time > ttl)) await rm(file.path, { force: true })
    return key
  }
}
