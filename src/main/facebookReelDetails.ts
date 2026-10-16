import type { PlaylistEntry } from '../shared/types'
import { facebookReelId, facebookReelsSource, mergeFacebookReel, type FacebookReelsRequest } from '../shared/facebookReels'
import { facebookReelsBrowserDependencies, facebookBrowserUrl, readFacebookReelsPageScript, type FacebookReelsBrowserDependencies } from './facebookReels'
import { facebookAccountDigest } from './facebookReelsAccount'
import { reelsOperation } from './facebookReelsController'
import { observeFacebookReelsNetwork } from './facebookReelsNetwork'
import type { BrowserWindow } from 'electron'

export const reelCommentsClickScript=(id:string):string=>`(() => {
  if (!/^\\d{5,30}$/.test(${JSON.stringify(id)}) || location.pathname.replace(/\\/$/,'') !== '/reel/'+${JSON.stringify(id)}) return false;
  const root=document.querySelector('[role="dialog"]') || document.querySelector('[role="main"]');
  if(!root)return false;
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;};
  const button=[...root.querySelectorAll('[role="button"],button')].find(e=>visible(e)&&/^(Bình luận|Comment|Comments)$/i.test(e.getAttribute('aria-label')||''));
  if(button){button.click();return true;} return false;
})()`

/** One isolated Facebook session per export, recycled across its selected Reel IDs. */
export function createFacebookReelDetailsBrowser(request:FacebookReelsRequest,expectedAccount:string,
  dependencies:FacebookReelsBrowserDependencies=facebookReelsBrowserDependencies) {
  const source=facebookReelsSource(request.url)
  if(!source)throw Error('Nguồn Reels không hợp lệ.')
  let ses:Electron.Session|undefined, win:BrowserWindow|undefined, disposed=false
  let initializationError: Error | undefined
  let observer:ReturnType<typeof observeFacebookReelsNetwork>|undefined
  const initialize=async(signal:AbortSignal):Promise<BrowserWindow>=>{
    if(disposed)throw Error('Phiên Reels đã đóng.')
    if(initializationError)throw initializationError
    if(win){if(win.isDestroyed())throw Error('Phiên Reels đã đóng.');return win}
    try {
      ses=dependencies.newSession()
      await reelsOperation(ses.setProxy(request.proxy?{proxyRules:request.proxy}:{mode:'direct'}),signal)
      if(request.useCookies)await reelsOperation(dependencies.populateCookies('facebook.com',ses),signal)
      const cookie=(await reelsOperation(ses.cookies.get({name:'c_user'}),signal)).find(c=>c.domain?.replace(/^\./,'')==='facebook.com')?.value
      if(facebookAccountDigest(cookie)!==expectedAccount)throw Error('Tài khoản Facebook đã thay đổi. Hãy quét lại.')
      win=dependencies.newWindow(ses);const wc=win.webContents
      wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/[\d.]+/gi,'').replace(/\s(?:T-blao|TediaPros)\/[\d.]+/gi,''))
      wc.setAudioMuted(true);wc.setWindowOpenHandler(()=>({action:'deny'}))
      const guard=(e:Electron.Event,url:string):void=>{if(!facebookBrowserUrl(url))e.preventDefault()}
      wc.on('will-navigate',guard);wc.on('will-redirect',guard)
      return win
    } catch(error) {
      // A failed account/context stays failed for this batch; never create another session.
      initializationError=error instanceof Error?error:Error('Không mở được phiên Reels.')
      if(win&&!win.isDestroyed())win.destroy()
      win=undefined;const failedSession=ses;ses=undefined
      if(failedSession)await reelsOperation(failedSession.clearStorageData(),undefined,10000).catch(()=>{})
      throw initializationError
    }
  }
  return {
    async resolve(entry:PlaylistEntry,signal:AbortSignal,options:{captionOnly?:boolean}={}):Promise<PlaylistEntry> {
      if(facebookReelId(entry.url)!==entry.id)throw Error('Reel ID không hợp lệ.')
      const window=await initialize(signal),wc=window.webContents
      observer?.dispose();const network=observeFacebookReelsNetwork(wc.debugger,()=>({source:{...source,profileId:entry.facebook?.ownerId??source.profileId},knownIds:new Set([entry.id])}));observer=network
      const abort=():void=>{if(!window.isDestroyed())window.destroy()}
      signal.addEventListener('abort',abort,{once:true})
      const seen=new Set<string>();let current=entry,clicked=false
      const mergeSnapshot=():void=>{const found=network.snapshot().entries.find(e=>e.id===entry.id);if(found)current=mergeFacebookReel(current,found)}
      try {
        await reelsOperation(Promise.all([network.ready,window.loadURL(entry.url)]),signal,35000)
        const started=Date.now()
        while(Date.now()-started<15000&&!signal.aborted) {
          const page=await reelsOperation(wc.executeJavaScript(readFacebookReelsPageScript),signal) as {url:string;scripts:string[];blocked?:string}
          if(facebookReelId(page.url)!==entry.id)throw Error('Facebook đã chuyển sang Reel khác; dừng lấy dữ liệu để tránh nhầm nội dung.')
          if(page.blocked)throw Error('Facebook yêu cầu đăng nhập hoặc kiểm tra tài khoản.')
          for(const raw of page.scripts)if(!seen.has(raw)){seen.add(raw);network.ingest(raw)}
          mergeSnapshot()
          if(current.facebook?.caption && (options.captionOnly ? current.facebook.status === 'verified' : current.facebook.links?.length)) return current
          if(!options.captionOnly && !clicked)clicked=await reelsOperation(wc.executeJavaScript(reelCommentsClickScript(entry.id)),signal)
          await reelsOperation(new Promise(r=>setTimeout(r,400)),signal)
        }
        if(signal.aborted)throw Error('Đã hủy lấy chi tiết Reel.')
        mergeSnapshot()
        const warnings=network.snapshot().warnings
        if(warnings.length)throw Error(warnings.join(' '))
        return current
      }finally{signal.removeEventListener('abort',abort);network.dispose();observer=undefined}
    },
    async dispose():Promise<void>{
      disposed=true;observer?.dispose();if(win&&!win.isDestroyed())win.destroy()
      if(ses)await reelsOperation(ses.clearStorageData(),undefined,10000).catch(()=>{})
    }
  }
}
