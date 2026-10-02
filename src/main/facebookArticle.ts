import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest, type RequestOptions, type IncomingMessage, type ClientRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { externalArticleUrl } from '../shared/facebookArticleLinks'
import { reelsOperation } from './facebookReelsController'

export interface FacebookArticle { url: string; title: string; content: string; status: 'success' | 'no-article' | 'error'; error?: string }
export function isPublicArticleAddress(ip: string): boolean {
  if(isIP(ip)===4) {
    const [a,b,c]=ip.split('.').map(Number)
    return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) || (a===172 && b>=16 && b<=31) ||
      (a===192 && (b===168 || b===0 || (b===88 && c===99))) ||
      (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113))
  }
  if(isIP(ip)===6) return /^[23]/i.test(ip) && !/^(?:2001:(?:db8|0:)|2002:)/i.test(ip)
  return false
}
export function extractArticleHtml(html: string, url: string): FacebookArticle {
  if (Buffer.byteLength(html)>4*1024*1024) throw new Error('Trang web vượt giới hạn 4 MB.')
  // JSDOM defaults: scripts and external resources are disabled.
  const dom=new JSDOM(html,{url})
  try {
    const article=new Readability(dom.window.document,{maxElemsToParse:20000,charThreshold:200}).parse()
    if(!article || (article.length??0)<200) return {url,title:dom.window.document.title,content:'',status:'no-article',error:'Không tìm thấy phần nội dung bài viết trong HTML.'}
    const fragment=new JSDOM(article.content??'')
    try {
      const doc=fragment.window.document
      for(const br of doc.querySelectorAll('br')) br.replaceWith('\n')
      for(const el of doc.querySelectorAll('p,h1,h2,h3,h4,li,blockquote,tr,pre')) el.append('\n\n')
      const content=(doc.body.textContent??'').replace(/[\t \u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim()
      return {url,title:article.title??'',content,status:content.length>=200?'success':'no-article'}
    } finally {fragment.window.close()}
  } finally { dom.window.close() }
}

export interface FacebookArticleTransport {
  resolveHost(hostname:string):Promise<{address:string;family:number}[]>
  request(url:URL,options:RequestOptions,listener:(res:IncomingMessage)=>void):ClientRequest
}
const articleTransport:FacebookArticleTransport={resolveHost:hostname=>lookup(hostname,{all:true}),request:(url,options,listener)=>(url.protocol==='https:'?httpsRequest:httpRequest)(url,options,listener)}
async function getHtml(url: URL, signal: AbortSignal, transport:FacebookArticleTransport): Promise<{status:number;location?:string;html:string}> {
  const addresses=await reelsOperation(transport.resolveHost(url.hostname),signal,10000)
  if (!addresses.length || addresses.some(a=>!isPublicArticleAddress(a.address))) throw new Error('Không truy cập địa chỉ mạng nội bộ từ link Reel.')
  const address=addresses[0]
  return new Promise((resolve,reject)=>{
    // Pin the validated address for this request, preventing DNS rebinding.
    const req=transport.request(url,{
      signal,headers:{'User-Agent':'Mozilla/5.0 TediaPros Article Reader','Accept':'text/html,application/xhtml+xml','Accept-Encoding':'identity'},
      family:address.family,
      lookup:(_host,_options,callback)=>{callback(null,address.address,address.family)}
    },res=>{
      const status=res.statusCode??0
      if(status>=300&&status<400) {res.resume();resolve({status,location:res.headers.location,html:''});return}
      if(status!==200) {res.resume();reject(new Error(`Website trả HTTP ${status}.`));return}
      if(!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type']??'')){res.destroy();reject(new Error('Link không trả về trang HTML.'));return}
      const chunks:Buffer[]=[];let size=0
      res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>4*1024*1024){req.destroy(new Error('Trang web vượt giới hạn 4 MB.'))}else chunks.push(chunk)})
      res.on('error',reject)
      res.on('end',()=>{
        try {const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(res.headers['content-type']??'')?.[1]??'utf-8'
          resolve({status,html:new TextDecoder(charset).decode(Buffer.concat(chunks))})
        } catch {reject(new Error('Không đọc được mã hóa của bài viết.'))}
      })
    })
    req.on('error',reject);req.end()
  })
}
export async function fetchArticle(raw: string, parent: AbortSignal, transport:FacebookArticleTransport=articleTransport): Promise<FacebookArticle> {
  if(parent.aborted) throw new Error('Article cancelled')
  const controller=new AbortController(); const abort=():void=>controller.abort()
  parent.addEventListener('abort',abort,{once:true}); const timer=setTimeout(abort,30000)
  let current=raw
  try {
    for(let i=0;i<6;i++) {
      const normalized=externalArticleUrl(current)
      if(!normalized)throw new Error('Link website không hợp lệ hoặc trỏ về mạng nội bộ.')
      const url=new URL(normalized);if(url.port && !['80','443'].includes(url.port)) throw new Error('Link website sử dụng cổng không hỗ trợ.')
      const response=await getHtml(url,controller.signal,transport)
      if(response.status>=300&&response.status<400) {if(!response.location)throw Error('Website chuyển hướng thiếu đích.');current=new URL(response.location,url).href;continue}
      return extractArticleHtml(response.html,url.href)
    }
    throw new Error('Website chuyển hướng quá nhiều lần.')
  } finally {clearTimeout(timer);parent.removeEventListener('abort',abort)}
}
