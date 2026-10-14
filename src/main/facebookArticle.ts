import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest, type RequestOptions, type IncomingMessage, type ClientRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { externalArticleUrl } from '../shared/facebookArticleLinks'
import { reelsOperation } from './facebookReelsController'

export interface StoryChapter {
  index: number
  title: string
  content: string
  wordCount: number
}

export interface FacebookArticle {
  url: string
  title: string
  content: string
  status: 'success' | 'no-article' | 'error'
  error?: string
  chapters?: StoryChapter[]
  completion?: 'complete' | 'partial'
  stopReason?: string
  extractionMethod?: 'json-ld' | 'readability' | 'offscreen-browser'
  thumbnailUrl?: string | null
}

export function isPublicArticleAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (isIP(ip) === 6) return /^[23]/i.test(ip) && !/^(?:2001:(?:db8|0:)|2002:)/i.test(ip)
  return false
}

// Danh sách các mẫu câu kêu gọi / quảng cáo / disclaimer cần lọc bỏ (Zero-AI)
const CTA_PATTERNS = [
  /^(?:follow|subscribe|share this|like our page|read more|click here|continue reading|join our\b)/i,
  /^(?:theo dõi|chia sẻ|đăng ký|thích trang|đọc tiếp|bấm vào đây|nguồn:|tác giả:)/i,
  /^(?:for more stories|all rights reserved|photo credit|disclaimer:|sponsored by\b)/i,
  /^(?:bản quyền thuộc về|chúc các bạn đọc truyện vui vẻ|hãy để lại bình luận)/i,
  /^\d+\s*(?:shares?|comments?|likes?|lượt chia sẻ|bình luận)\b/i
]

export function isJunkParagraph(p: string): boolean {
  const text = p.trim()
  if (text.length < 20 && !/[.!?…"”]$/.test(text)) return true
  return CTA_PATTERNS.some((regex) => regex.test(text))
}

export function cleanStoryContent(rawText: string): string {
  if (!rawText) return ''
  return rawText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => !isJunkParagraph(p))
    .join('\n\n')
    .replace(/[\u00a0\t ]+/g, ' ')
    .trim()
}

const CHAPTER_REGEX = /^(?:Chapter|Chương|Part|Phần|Episode|Hồi)\s*\d+[:\s\-\.]*(.*)$/im

export function parseStoryChapters(text: string): StoryChapter[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length === 0) return []

  const chapters: StoryChapter[] = []
  let currentTitle = 'Mở đầu'
  let currentBody: string[] = []

  for (const p of paragraphs) {
    const firstLine = p.split('\n')[0].trim()
    const match = firstLine.match(CHAPTER_REGEX)
    if (match && currentBody.length > 0 && chapters.length === 0 && currentTitle === 'Mở đầu') {
      const matchNum = chapterNumber(firstLine)
      if (matchNum && matchNum === 2) {
        const joined = currentBody.join('\n\n')
        chapters.push({
          index: 1,
          title: 'Chapter 1',
          content: joined,
          wordCount: joined.split(/\s+/).filter(Boolean).length
        })
        currentTitle = p
        currentBody = []
        continue
      } else if (matchNum && matchNum > 2) {
        const joined = currentBody.join('\n\n')
        chapters.push({
          index: 1,
          title: 'Mở đầu',
          content: joined,
          wordCount: joined.split(/\s+/).filter(Boolean).length
        })
        currentTitle = p
        currentBody = []
        continue
      }
      currentTitle = p
      continue // keep the introduction with the first numbered chapter
    }
    if (match && currentBody.length > 0) {
      const joined = currentBody.join('\n\n')
      chapters.push({
        index: chapterNumber(currentTitle) || chapters.length + 1,
        title: currentTitle,
        content: joined,
        wordCount: joined.split(/\s+/).filter(Boolean).length
      })
      currentTitle = p
      currentBody = []
    } else if (match && currentBody.length === 0) {
      currentTitle = p
    } else {
      currentBody.push(p)
    }
  }

  if (currentBody.length > 0 || chapters.length === 0) {
    const joined = currentBody.join('\n\n')
    chapters.push({
      index: chapterNumber(currentTitle) || chapters.length + 1,
      title: currentTitle,
      content: joined,
      wordCount: joined.split(/\s+/).filter(Boolean).length
    })
  }

  return chapters
}

function extractJsonLdArticle(doc: Document): { title?: string; body?: string } | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '')
      const candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data]
      for (const item of candidates) {
        if (item && typeof item === 'object') {
          const type = item['@type']
          const isArticle =
            type === 'Article' ||
            type === 'NewsArticle' ||
            type === 'BlogPosting' ||
            (Array.isArray(type) && type.some((t: string) => ['Article', 'NewsArticle', 'BlogPosting'].includes(t)))
          if (isArticle && typeof item.articleBody === 'string' && item.articleBody.length >= 200) {
            return {
              title: typeof item.headline === 'string' ? item.headline : undefined,
              body: item.articleBody
            }
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null
}

function extractJsonLdThumbnail(doc: Document, baseUrl: string): string | null {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '')
      const candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data]
      for (const item of candidates) {
        if (item && typeof item === 'object') {
          const img = item.image || item.thumbnailUrl
          if (typeof img === 'string' && img.trim()) {
            return new URL(img.trim(), baseUrl).href
          }
          if (img && typeof img === 'object') {
            if (typeof img.url === 'string' && img.url.trim()) {
              return new URL(img.url.trim(), baseUrl).href
            }
            if (Array.isArray(img) && img.length > 0) {
              const first = img[0]
              if (typeof first === 'string' && first.trim()) return new URL(first.trim(), baseUrl).href
              if (first && typeof first.url === 'string' && first.url.trim()) return new URL(first.url.trim(), baseUrl).href
            }
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null
}

const JUNK_IMAGE_PATTERNS = /(?:avatar|author-image|profile-pic|user-icon|favicon|spacer|pixel|blank|tracking|spinner|placeholder|share-icon|share-btn|1x1)/i

function isCandidateImage(src: string, el?: Element | null): boolean {
  if (!src || src.startsWith('data:')) return false
  const lower = src.toLowerCase()
  if (lower.endsWith('.svg') || lower.endsWith('.ico')) return false
  if (JUNK_IMAGE_PATTERNS.test(lower)) return false
  if (el) {
    const w = el.getAttribute('width')
    const h = el.getAttribute('height')
    if (w && Number(w) > 0 && Number(w) < 100) return false
    if (h && Number(h) > 0 && Number(h) < 100) return false
    const cls = ((el.getAttribute('class') || '') + ' ' + (el.parentElement?.getAttribute('class') || '')).toLowerCase()
    if (/(?:avatar|author|author-bio|profile|share|social|comment|widget|badge)/i.test(cls)) return false
  }
  return true
}

export function extractThumbnailUrl(doc: Document, baseUrl: string): string | null {
  try {
    // 1. JSON-LD structured data (Cao nhất - do chính CMS chỉ định rõ ràng cho bài viết)
    const jsonLdImg = extractJsonLdThumbnail(doc, baseUrl)
    if (jsonLdImg && isCandidateImage(jsonLdImg)) return jsonLdImg

    // 2. OpenGraph & Twitter Cards (Thẻ meta mạng xã hội - tiêu chuẩn vàng cho ảnh đại diện bài viết)
    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[name="og:image"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'meta[itemprop="image"]',
      'link[rel="image_src"]'
    ]
    for (const sel of metaSelectors) {
      const el = doc.querySelector(sel)
      if (el) {
        const val = (el.getAttribute('content') || el.getAttribute('href') || '').trim()
        if (isCandidateImage(val)) {
          try {
            const resolved = new URL(val, baseUrl).href
            if (/^https?:\/\//i.test(resolved)) return resolved
          } catch {}
        }
      }
    }

    // 3. Featured Image trong DOM (Phân cấp theo ngữ nghĩa và vị trí)
    // Ưu tiên 3.1: Các class chuyên dụng cho ảnh bìa/ảnh đại diện bài viết
    const featuredSelectors = [
      '[class*="featured-image"] img',
      '[class*="post-thumbnail"] img',
      '[class*="entry-thumb"] img',
      '[class*="cover-image"] img',
      '[class*="hero-image"] img',
      'article > figure:first-of-type img',
      'article header img'
    ]
    for (const sel of featuredSelectors) {
      const el = doc.querySelector(sel)
      if (el) {
        const src = (el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '').trim()
        if (isCandidateImage(src, el)) {
          try {
            const resolved = new URL(src, baseUrl).href
            if (/^https?:\/\//i.test(resolved)) return resolved
          } catch {}
        }
      }
    }

    // Ưu tiên 3.2: Ảnh lớn đầu tiên trong nội dung bài viết chính
    const contentImages = Array.from(doc.querySelectorAll('article img, [class*="entry-content"] img, main img'))
    for (const el of contentImages) {
      const src = (el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '').trim()
      if (isCandidateImage(src, el)) {
        try {
          const resolved = new URL(src, baseUrl).href
          if (/^https?:\/\//i.test(resolved)) return resolved
        } catch {}
      }
    }
  } catch {}
  return null
}

export function extractArticleHtml(html: string, url: string): FacebookArticle {
  if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new Error('Trang web vượt giới hạn 4 MB.')
  const dom = new JSDOM(html, { url })
  try {
    const doc = dom.window.document
    const thumbnailUrl = extractThumbnailUrl(doc, url)

    // 1. Tier 1: Check Structured Data (JSON-LD)
    const jsonLd = extractJsonLdArticle(doc)
    if (jsonLd && jsonLd.body) {
      const cleaned = cleanStoryContent(jsonLd.body)
      if (cleaned.length >= 200) {
        const title = jsonLd.title || doc.title || ''
        const chapters = parseStoryChapters(cleaned)
        return {
          url,
          title,
          content: cleaned,
          status: 'success',
          extractionMethod: 'json-ld',
          chapters,
          thumbnailUrl
        }
      }
    }

    // 2. Pre-DOM Sanitize: Loại bỏ các selector rác trước khi Readability phân tích
    const junkSelectors = [
      'style', 'noscript', 'iframe', 'svg', 'header', 'footer', 'nav', 'aside',
      '[class*="share"]', '[class*="social"]', '[class*="follow"]',
      '[class*="newsletter"]', '[class*="subscribe"]', '[class*="banner"]',
      '[class*="author-bio"]', '[class*="related-post"]', '[id*="comment"]',
      '[class*="disclaimer"]', '[class*="advertisement"]', '[class*="adsbygoogle"]'
    ]
    for (const sel of junkSelectors) {
      for (const el of doc.querySelectorAll(sel)) {
        el.remove()
      }
    }

    // 3. Tier 2: Mozilla Readability Heuristic Extraction
    const article = new Readability(doc, { maxElemsToParse: 30000, charThreshold: 200 }).parse()
    if (!article || (article.length ?? 0) < 200) {
      return {
        url,
        title: doc.title,
        content: '',
        status: 'no-article',
        error: 'Không tìm thấy phần nội dung bài viết trong HTML.',
        thumbnailUrl
      }
    }

    const fragment = new JSDOM(article.content ?? '')
    try {
      const fragDoc = fragment.window.document
      for (const br of fragDoc.querySelectorAll('br')) br.replaceWith('\n')
      for (const el of fragDoc.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,tr,pre')) el.append('\n\n')
      const rawExtracted = (fragDoc.body.textContent ?? '')
        .replace(/[\t \u00a0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

      const cleaned = cleanStoryContent(rawExtracted)
      const finalContent = cleaned.length >= 200 ? cleaned : rawExtracted
      const chapters = parseStoryChapters(finalContent)

      return {
        url,
        title: article.title ?? '',
        content: finalContent,
        status: finalContent.length >= 200 ? 'success' : 'no-article',
        extractionMethod: 'readability',
        chapters,
        thumbnailUrl
      }
    } finally {
      fragment.window.close()
    }
  } finally {
    dom.window.close()
  }
}

/** Tier 3: Offscreen Electron Chromium Fallback cho web SPA/React/Cloudflare */
async function fetchViaOffscreenBrowser(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const electron = await import('electron')
    const { BrowserWindow, session } = electron
    if (!BrowserWindow || !session || typeof session.fromPartition !== 'function') return null

    return await new Promise<string | null>((resolve) => {
      let win: Electron.BrowserWindow | undefined
      let cleanedUp = false
      const partitionKey = `article-render:${Math.random().toString(36).slice(2)}`
      const ses = session.fromPartition(partitionKey)

      const cleanup = async (): Promise<void> => {
        if (cleanedUp) return
        cleanedUp = true
        try {
          if (win && !win.isDestroyed()) win.destroy()
          await ses.clearStorageData().catch(() => {})
        } catch {}
      }

      const timer = setTimeout(async () => {
        try {
          if (win && !win.isDestroyed()) {
            const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML')
            await cleanup()
            resolve(typeof html === 'string' && html.length > 500 ? html : null)
            return
          }
        } catch {}
        await cleanup()
        resolve(null)
      }, 10000)

      signal.addEventListener('abort', async () => {
        clearTimeout(timer)
        await cleanup()
        resolve(null)
      }, { once: true })

      try {
        win = new BrowserWindow({
          width: 1280,
          height: 900,
          show: false,
          webPreferences: {
            session: ses,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
          }
        })
      } catch {
        clearTimeout(timer)
        return resolve(null)
      }

      const wc = win.webContents
      if (!wc) {
        clearTimeout(timer)
        cleanup()
        return resolve(null)
      }

      wc.setAudioMuted(true)
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))

      wc.on('did-finish-load', () => {
        setTimeout(async () => {
          clearTimeout(timer)
          try {
            if (win && !win.isDestroyed()) {
              const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML')
              await cleanup()
              resolve(typeof html === 'string' && html.length > 500 ? html : null)
              return
            }
          } catch {}
          await cleanup()
          resolve(null)
        }, 1500)
      })

      win.loadURL(url).catch(async () => {
        clearTimeout(timer)
        await cleanup()
        resolve(null)
      })
    })
  } catch {
    return null
  }
}

export interface FacebookArticleTransport {
  resolveHost(hostname: string): Promise<{ address: string; family: number }[]>
  request(url: URL, options: RequestOptions, listener: (res: IncomingMessage) => void): ClientRequest
}

const articleTransport: FacebookArticleTransport = {
  resolveHost: (hostname) => lookup(hostname, { all: true }),
  request: (url, options, listener) => (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, listener)
}


export function contentHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex')
}

function chapterNumber(raw: string): number | null {
  const matches = [...raw.matchAll(/(?:^|[^a-z0-9à-ỹ])(?:chapter|chuong|chương|part|phan|phần|ep|episode|page|trang)[\s/_-]*(\d+)/gi)]
  if (!matches.length) return null
  return Number(matches[matches.length - 1][1])
}

export function getStoryBasePath(raw: string): string {
  const url = new URL(raw)
  // Exact story identity: remove only a terminal chapter suffix, never category membership.
  const path = url.pathname.replace(/[/_-](?:chapter|chuong|chương|part|phan|phần|ep|episode|page|trang)[/_-]?\d+\/?$/i, '').replace(/\/$/, '')
  return `${url.origin}${path}`
}

function sameStory(current: string, target: string): boolean {
  const base = getStoryBasePath(current)
  return new URL(base).pathname !== '/' && base === getStoryBasePath(target)
}

export interface SiblingChapterLink { index: number; url: string; title: string }
export function findSiblingChapterUrls(html: string, currentUrl: string): SiblingChapterLink[] {
  const dom = new JSDOM(html, { url: currentUrl })
  try {
    const found = new Map<number, SiblingChapterLink>()
    const ambiguous = new Set<number>()
    for (const a of Array.from(dom.window.document.querySelectorAll('a[href]'))) {
      const raw = a.getAttribute('href') || ''
      if (!raw || raw.startsWith('#')) continue
      try {
        const url = new URL(raw, currentUrl).href
        if (!externalArticleUrl(url) || !sameStory(currentUrl, url)) continue
        const title = (a.textContent || '').trim(), index = chapterNumber(new URL(url).pathname) || chapterNumber(title)
        if (!index || index > 10000) continue
        if (found.has(index) && found.get(index)!.url !== url) ambiguous.add(index)
        else found.set(index, { index, url, title })
      } catch { /* unsupported URL */ }
    }
    return [...found.values()].filter(c => !ambiguous.has(c.index)).sort((a, b) => a.index - b.index)
  } finally { dom.window.close() }
}

function nextChapterLink(html: string, currentUrl: string): { url?: string; ambiguous: boolean; candidates: { text: string; url: string }[] } {
  const dom = new JSDOM(html, { url: currentUrl })
  try {
    const urls = new Set<string>()
    const candidates: { text: string; url: string }[] = []
    for (const a of Array.from(dom.window.document.querySelectorAll('a[href], link[rel="next"][href]'))) {
      const rel = (a.getAttribute('rel') || '').split(/\s+/)
      const text = (a.textContent || '').trim()
      if (!rel.includes('next') && !/^(?:next(?:\s+(?:chapter|page))?|chương tiếp(?: theo)?|tiếp(?: theo)?|đọc tiếp|trang sau|continue(?: reading)?)\s*[»›→]?$/i.test(text)) continue
      try {
        const url = new URL(a.getAttribute('href')!, currentUrl).href
        if (url !== currentUrl && externalArticleUrl(url) && sameStory(currentUrl, url)) {
          urls.add(url)
          candidates.push({ text, url })
        }
      } catch { /* unsupported URL */ }
    }
    return { url: urls.size === 1 ? [...urls][0] : undefined, ambiguous: urls.size > 1, candidates }
  } finally { dom.window.close() }
}

async function getHtml(url: URL, signal: AbortSignal, transport: FacebookArticleTransport): Promise<{ status: number; location?: string; html: string }> {
  const addresses = await reelsOperation(transport.resolveHost(url.hostname), signal, 10000)
  if (!addresses.length || addresses.some((a) => !isPublicArticleAddress(a.address))) {
    throw new Error('Không truy cập địa chỉ mạng nội bộ từ link Reel.')
  }
  const address = addresses[0]
  return new Promise((resolve, reject) => {
    // Pin the validated address for this request, preventing DNS rebinding.
    const req = transport.request(
      url,
      {
        signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
          'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'Accept-Encoding': 'identity'
        },
        family: address.family,
        lookup: (_host, _options, callback) => {
          callback(null, address.address, address.family)
        }
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          resolve({ status, location: res.headers.location, html: '' })
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error(`Website trả HTTP ${status}.`))
          return
        }
        if (!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type'] ?? '')) {
          res.destroy()
          reject(new Error('Link không trả về trang HTML.'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 4 * 1024 * 1024) {
            req.destroy(new Error('Trang web vượt giới hạn 4 MB.'))
          } else {
            chunks.push(chunk)
          }
        })
        res.on('error', reject)
        res.on('end', () => {
          try {
            const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(res.headers['content-type'] ?? '')?.[1] ?? 'utf-8'
            resolve({ status, html: new TextDecoder(charset).decode(Buffer.concat(chunks)) })
          } catch {
            reject(new Error('Không đọc được mã hóa của bài viết.'))
          }
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

export async function downloadArticleThumbnail(
  rawUrl: string,
  signal: AbortSignal,
  transport: FacebookArticleTransport = articleTransport
): Promise<{ buffer: Buffer; ext: string } | null> {
  try {
    let current = new URL(rawUrl)
    if (!['http:', 'https:'].includes(current.protocol)) return null
    for (let redirect = 0; redirect < 3; redirect++) {
      signal.throwIfAborted()
      const addresses = await reelsOperation(transport.resolveHost(current.hostname), signal, 10000)
      if (!addresses.length || addresses.some((a) => !isPublicArticleAddress(a.address))) {
        return null
      }
      const address = addresses[0]
      const res = await new Promise<{ status: number; location?: string; buffer: Buffer; contentType: string }>((resolve, reject) => {
        const req = transport.request(
          current,
          {
            signal,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
              'Accept-Encoding': 'identity'
            },
            family: address.family,
            lookup: (_host, _options, callback) => {
              callback(null, address.address, address.family)
            }
          },
          (res) => {
            const status = res.statusCode ?? 0
            if (status >= 300 && status < 400 && res.headers.location) {
              res.resume()
              resolve({ status, location: res.headers.location, buffer: Buffer.alloc(0), contentType: '' })
              return
            }
            if (status !== 200) {
              res.resume()
              resolve({ status, buffer: Buffer.alloc(0), contentType: '' })
              return
            }
            const contentType = res.headers['content-type'] ?? ''
            const chunks: Buffer[] = []
            let size = 0
            res.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > 10 * 1024 * 1024) {
                req.destroy()
              } else {
                chunks.push(chunk)
              }
            })
            res.on('error', reject)
            res.on('end', () => {
              resolve({ status, buffer: Buffer.concat(chunks), contentType })
            })
          }
        )
        req.on('error', reject)
        req.end()
      })

      if (res.status >= 300 && res.status < 400 && res.location) {
        current = new URL(res.location, current)
        continue
      }
      if (res.status === 200 && res.buffer.length > 0) {
        let ext = '.jpg'
        const ct = res.contentType.toLowerCase()
        if (ct.includes('webp')) ext = '.webp'
        else if (ct.includes('png')) ext = '.png'
        else if (ct.includes('gif')) ext = '.gif'
        else if (ct.includes('avif')) ext = '.avif'
        else if (ct.includes('jpeg') || ct.includes('jpg')) ext = '.jpg'
        else {
          const pathname = current.pathname.toLowerCase()
          if (pathname.endsWith('.webp')) ext = '.webp'
          else if (pathname.endsWith('.png')) ext = '.png'
          else if (pathname.endsWith('.gif')) ext = '.gif'
          else if (pathname.endsWith('.avif')) ext = '.avif'
          else if (pathname.endsWith('.jpeg') || pathname.endsWith('.jpg')) ext = '.jpg'
        }
        return { buffer: res.buffer, ext }
      }
      return null
    }
    return null
  } catch {
    return null
  }
}

async function fetchSingleArticleRaw(
  current: string,
  controller: AbortController,
  transport: FacebookArticleTransport
): Promise<{ html: string; article: FacebookArticle }> {
  for (let i = 0; i < 6; i++) {
    const normalized = externalArticleUrl(current)
    if (!normalized) throw new Error('Link website không hợp lệ hoặc trỏ về mạng nội bộ.')
    const url = new URL(normalized)
    if (url.port && !['80', '443'].includes(url.port)) throw new Error('Link website sử dụng cổng không hỗ trợ.')

    let httpSuccess = false
    let htmlContent = ''

    try {
      const response = await getHtml(url, controller.signal, transport)
      if (response.status >= 300 && response.status < 400) {
        if (!response.location) throw Error('Website chuyển hướng thiếu đích.')
        current = new URL(response.location, url).href
        continue
      }
      htmlContent = response.html
      httpSuccess = true
    } catch (httpErr: any) {
      if (controller.signal.aborted) throw httpErr
      const msg = httpErr?.message ?? ''
      if (msg.includes('nội bộ') || msg.includes('chuyển hướng')) throw httpErr
    }

    if (httpSuccess && htmlContent) {
      const parsed = extractArticleHtml(htmlContent, url.href)
      if (parsed.status === 'success') return { html: htmlContent, article: parsed }
    }

    // Kích hoạt Tier 3: Offscreen Browser Fallback cho web SPA/JS/Chặn bot
    const offscreenHtml = transport === articleTransport ? await fetchViaOffscreenBrowser(url.href, controller.signal) : null
    if (offscreenHtml) {
      const parsedOffscreen = extractArticleHtml(offscreenHtml, url.href)
      if (parsedOffscreen.status === 'success') {
        return { html: offscreenHtml, article: { ...parsedOffscreen, extractionMethod: 'offscreen-browser' } }
      }
    }

    if (httpSuccess && htmlContent) {
      return { html: htmlContent, article: extractArticleHtml(htmlContent, url.href) }
    }

    throw new Error('Không thể tải hoặc trích xuất nội dung từ website.')
  }
  throw new Error('Website chuyển hướng quá nhiều lần.')
}


export async function fetchArticle(
  raw: string,
  parent: AbortSignal,
  transportOrChapters?: FacebookArticleTransport | number,
  maxChapters = 25
): Promise<FacebookArticle> {
  const transport: FacebookArticleTransport =
    typeof transportOrChapters === 'object' && transportOrChapters !== null
      ? transportOrChapters
      : articleTransport
  const limit: number =
    typeof transportOrChapters === 'number'
      ? transportOrChapters
      : maxChapters

  parent.throwIfAborted()
  const controller = new AbortController(), abort = (): void => controller.abort()
  parent.addEventListener('abort', abort, { once: true })
  if (parent.aborted) abort()
  let timer = setTimeout(abort, 60000)
  const resetTimer = (): void => {
    clearTimeout(timer)
    timer = setTimeout(abort, 60000)
  }
  try {
    const first = await fetchSingleArticleRaw(raw, controller, transport)
    if (first.article.status !== 'success') return first.article
    const urlPageNum = chapterNumber(new URL(first.article.url).pathname) || chapterNumber(new URL(first.article.url).search)
    const startInlineNum = chapterNumber(first.article.chapters?.[0]?.title || '')
    const startTitleNum = chapterNumber(first.article.title)
    const startIndex = urlPageNum || startInlineNum || startTitleNum || 1
    const chapters: StoryChapter[] = []
    const visited = new Set<string>(), hashes = new Set<string>()
    let current = first, pageIndex = urlPageNum || 1, nextChapterIndex = startIndex, stopReason = 'single-page', complete = true, followedNext = false
    for (let page = 0; page < limit; page++) {
      if (controller.signal.aborted) { complete = false; stopReason = 'timeout'; break }
      if (visited.has(current.article.url) || hashes.has(contentHash(current.article.content))) { complete = false; stopReason = 'duplicate-content'; break }
      visited.add(current.article.url); hashes.add(contentHash(current.article.content))
      const inline = current.article.chapters || []
      if (inline.length > 0) {
        for (let i = 0; i < inline.length; i++) {
          const ch = inline[i]
          const num = chapterNumber(ch.title)
          if (page > 0 && i === 0 && chapters.length > 0 && (ch.title === 'Mở đầu' || (num !== null && num <= chapters[chapters.length - 1].index))) {
            const prev = chapters[chapters.length - 1]
            prev.content += '\n\n' + ch.content
            prev.wordCount = prev.content.split(/\s+/).filter(Boolean).length
            continue
          }
          const actual = (num !== null && num >= nextChapterIndex) ? num : nextChapterIndex
          chapters.push({
            ...ch,
            index: actual,
            title: ch.title && ch.title !== 'Mở đầu' ? ch.title : (first.article.title || `Chapter ${actual}`)
          })
          nextChapterIndex = Math.max(nextChapterIndex, actual) + 1
        }
      } else {
        const urlNum = chapterNumber(new URL(current.article.url).pathname) || chapterNumber(new URL(current.article.url).search)
        const isUrlChapter = urlNum !== null && urlNum > 1
        if (page > 0 && chapters.length > 0 && !chapterNumber(current.article.title) && !isUrlChapter) {
          const prev = chapters[chapters.length - 1]
          prev.content += '\n\n' + current.article.content
          prev.wordCount = prev.content.split(/\s+/).filter(Boolean).length
        } else {
          const num = chapterNumber(current.article.title) || urlNum
          const actual = (num !== null && num >= nextChapterIndex) ? num : nextChapterIndex
          chapters.push({
            index: actual,
            title: current.article.title && current.article.title !== first.article.title ? current.article.title : `Chapter ${actual}`,
            content: current.article.content,
            wordCount: current.article.content.split(/\s+/).filter(Boolean).length
          })
          nextChapterIndex = Math.max(nextChapterIndex, actual) + 1
        }
      }
      if (!complete) break
      const siblings = findSiblingChapterUrls(current.html, current.article.url)
      const next = nextChapterLink(current.html, current.article.url)
      let nextUrl: string | undefined = undefined

      if (next.ambiguous) {
        try {
          const { arbitrateNextChapterWithJev } = await import('./typesafeArbiter')
          const jevRes = await arbitrateNextChapterWithJev({
            storyTitle: first.article.title || current.article.title,
            currentUrl: current.article.url,
            candidates: next.candidates
          })
          if (jevRes.choiceUrl) nextUrl = jevRes.choiceUrl
        } catch { /* TypeSafe Jev fallback */ }

        if (!nextUrl) { complete = false; stopReason = 'ambiguous-next-link'; break }
      }

      const numbered = siblings.find(c => c.index === pageIndex + 1)
      if (!nextUrl) nextUrl = numbered?.url || next.url
      if (numbered && next.url && numbered.url !== next.url) {
        try {
          const { arbitrateNextChapterWithJev } = await import('./typesafeArbiter')
          const jevRes = await arbitrateNextChapterWithJev({
            storyTitle: first.article.title || current.article.title,
            currentUrl: current.article.url,
            candidates: [
              { text: `Page/Chapter ${pageIndex + 1} (numbered)`, url: numbered.url },
              { text: `Next button link`, url: next.url }
            ]
          })
          if (jevRes.choiceUrl) nextUrl = jevRes.choiceUrl
        } catch {}

        if (!nextUrl || (nextUrl !== numbered.url && nextUrl !== next.url)) {
          complete = false; stopReason = 'ambiguous-next-link'; break
        }
      }
      if (!nextUrl) {
        const later = siblings.some(c => c.index > pageIndex)
        const numberedPage = chapterNumber(current.article.url) !== null
        const knownEnd = siblings.some(c => c.index < pageIndex) && siblings.some(c => c.index === pageIndex)
        let endVerified = followedNext || knownEnd || !numberedPage || /(?:the end|hết truyện|end of story)/i.test(current.article.content.slice(-300))
        if (!endVerified && !later) {
          try {
            const { arbitrateStoryConclusionWithJev } = await import('./typesafeArbiter')
            endVerified = await arbitrateStoryConclusionWithJev({
              storyTitle: first.article.title || current.article.title,
              contentEnding: current.article.content
            })
          } catch {}
        }
        complete = !later && endVerified
        stopReason = later ? 'chapter-gap' : complete ? (chapters.length > 1 ? 'end-of-story' : 'single-page') : 'missing-next-link'
        break
      }
      if (page === limit - 1) { complete = false; stopReason = 'chapter-limit'; break }
      const targetPageIndex = chapterNumber(new URL(nextUrl).pathname) || chapterNumber(new URL(nextUrl).search)
      const currentUrlIndex = chapterNumber(new URL(current.article.url).pathname) || chapterNumber(new URL(current.article.url).search)
      const isSequentialUrlPage = currentUrlIndex !== null && targetPageIndex !== null && targetPageIndex === currentUrlIndex + 1
      const isVerifiedNextButton = next.url === nextUrl

      if (!sameStory(first.article.url, nextUrl)) {
        complete = false; stopReason = 'chapter-gap'; break
      }
      if (!isSequentialUrlPage && !isVerifiedNextButton) {
        if (targetPageIndex !== null && targetPageIndex !== pageIndex + 1) {
          let allowGap = false
          try {
            const { arbitrateContinuityWithJev } = await import('./typesafeArbiter')
            allowGap = await arbitrateContinuityWithJev({
              storyTitle: first.article.title || current.article.title,
              previousExcerpt: current.article.content,
              nextExcerpt: nextUrl
            })
          } catch {}
          if (!allowGap) {
            complete = false; stopReason = 'chapter-gap'; break
          }
        }
      }
      try {
        const fetched = await fetchSingleArticleRaw(nextUrl, controller, transport)
        if (fetched.article.status !== 'success' || !sameStory(first.article.url, fetched.article.url)) throw Error('Chapter không hợp lệ hoặc chuyển sang truyện khác.')
        current = fetched; pageIndex = targetPageIndex ?? (pageIndex + 1); followedNext = true; resetTimer()
      } catch { complete = false; stopReason = controller.signal.aborted ? 'timeout' : 'request-error'; break }
    }
    parent.throwIfAborted()
    if (startIndex > 1) {
      complete = false; stopReason = 'started-after-first'
    }
    return { ...first.article, chapters, content: chapters.length > 1 ? chapters.map(ch => `${ch.title}\n\n${ch.content}`).join('\n\n---\n\n') : first.article.content,
      completion: complete ? 'complete' : 'partial', stopReason }
  } finally { clearTimeout(timer); parent.removeEventListener('abort', abort) }
}
