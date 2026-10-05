/** Normalize only external HTTP(S) links. Never pass Facebook cookies to this destination. */
export function externalArticleUrl(raw: string): string | null {
  try {
    let url=new URL(raw.startsWith('www.') ? `https://${raw}` : raw)
    if ((url.hostname==='l.facebook.com' || url.hostname==='lm.facebook.com' || url.hostname==='www.facebook.com') && url.pathname==='/l.php') {
      const target=url.searchParams.get('u'); if(!target) return null; url=new URL(target)
    }
    const host=url.hostname.toLowerCase().replace(/\.+$/,'')
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password ||
      !host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':') ||
      /(?:^|\.)(?:facebook\.com|fb\.com|fb\.watch|instagram\.com|messenger\.com|meta\.com|localhost|local|internal|lan)$/.test(host) ||
      /[…]|\.\.\./.test(url.pathname)) return null
    url.hostname=host; url.searchParams.delete('fbclid'); url.hash=''
    return url.toString()
  } catch { return null }
}
export function articleLinksFromMessage(message: unknown): string[] {
  if (!message || typeof message!=='object') return []
  const m=message as {text?:string;ranges?:{entity?:{external_url?:string;url?:string;web_link?:{url?:string}}}[]}
  const candidates: string[]=[]
  // Entities preserve the full URL when Facebook renders an abbreviated label.
  for(const r of Array.isArray(m.ranges)?m.ranges:[]) {const e=r?.entity; for(const u of [e?.external_url,e?.url,e?.web_link?.url])if(typeof u==='string')candidates.push(u)}
  if(typeof m.text==='string') {
    for(const match of m.text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"“”]+/gi)) candidates.push(match[0].replace(/[.,;!?)\]}]+$/,''))
    for(const match of m.text.matchAll(/(?<![\w@/])(?:[a-z0-9][a-z0-9-]*\.)+(?:com|net|org|info|biz|io|co|xyz|site|top|online|news|blog|vn)\/[^\s<>"“”]+/gi))
      candidates.push('https://'+match[0].replace(/[.,;!?)\]}]+$/,''))
  }
  return [...new Set(candidates.map(externalArticleUrl).filter((u):u is string=>u!==null))]
}
