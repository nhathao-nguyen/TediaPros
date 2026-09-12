// Isolated Electron component smoke: no access to the user's app profile or settings.
import { build } from 'esbuild'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const work = await mkdtemp(join(tmpdir(), 'tedia-overlay-ui-'))
const evidence = join(repo, '.ai/tasks/2026-09-12-autoshort-overlays')
await mkdir(evidence, { recursive: true })
const require = createRequire(import.meta.url)
try {
  await build({ stdin: { contents: `
    import { useRef, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import Control from './src/renderer/src/components/AutoShortOverlayControl';
    import Preview from './src/renderer/src/components/AutoShortOverlayPreview';
    import { PortraitFramePreview } from './src/renderer/src/components/PortraitFramePreview';
    import './src/renderer/src/styles.css';
    function Fixture() {
      const [value, setValue] = useState({});
      const [disabled, setDisabled] = useState(false);
      const videoRef = useRef(null);
      return <main style={{padding:24}}><h2>AutoShort · Ảnh / Chữ</h2>
        <Control value={value} onChange={setValue} disabled={disabled} />
        <button id="running" onClick={() => setDisabled(!disabled)}>Toggle running</button>
        <div style={{position:'relative',marginTop:20,width:360,height:640}}>
          <PortraitFramePreview enabled videoRef={videoRef} source={null} videoWidth={640} videoHeight={360} width={360} height={640}
            overlay={<Preview value={value} width={360} height={640} fontFamily="" fontId="auto" />}>
            <div style={{height:'100%',background:'#173954',display:'grid',placeItems:'center'}}>VIDEO NỘI DUNG</div>
          </PortraitFramePreview>
        </div>
        <output id="state" style={{display:'none'}}>{JSON.stringify(value)}</output>
      </main>
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `, resolveDir: repo, loader: 'tsx' }, bundle: true, jsx: 'automatic', format: 'iife', outfile: join(work, 'ui.js'),
    define: { 'process.env.NODE_ENV': '"production"' } })
  const appHtml = await readFile(join(repo, 'src/renderer/index.html'), 'utf8')
  const csp = appHtml.match(/content="(default-src[^"]+)"/)[1]
  await writeFile(join(work, 'index.html'), `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>`)
  const fontPath = join(repo, 'resources/fonts/NotoSans.ttf')
  const imagePath = join(repo, 'build/icon.png')
  await writeFile(join(work, 'preload.cjs'), `
    const {contextBridge,ipcRenderer}=require('electron');
    contextBridge.exposeInMainWorld('api',{
      autoShortChooseOverlayImage:()=>ipcRenderer.invoke('fixture:choose'),
      loadBurnFontData:()=>ipcRenderer.invoke('fixture:font')
    });
  `)
  await writeFile(join(work, 'main.cjs'), `
    const {app,BrowserWindow,ipcMain,protocol}=require('electron');
    const {readFileSync,writeFileSync}=require('fs');
    const {join}=require('path');
    const assert=require('assert/strict');
    const {createHash}=require('crypto');
    app.setPath('userData',join(__dirname,'profile')); app.disableHardwareAcceleration();
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
    app.whenReady().then(async()=>{
      const imagePath=${JSON.stringify(imagePath)};
      ipcMain.handle('fixture:choose',()=>({ok:true,asset:{path:imagePath,sha256:createHash('sha256').update(readFileSync(imagePath)).digest('hex')}}));
      ipcMain.handle('fixture:font',()=>({id:'noto-sans',family:'Noto Sans',data:Uint8Array.from(readFileSync(${JSON.stringify(fontPath)})).buffer}));
      protocol.handle('tblao',()=>new Response(readFileSync(imagePath),{headers:{'Content-Type':'image/png','Access-Control-Allow-Origin':'*'}}));
      const w=new BrowserWindow({show:false,width:1120,height:900,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,preload:join(__dirname,'preload.cjs')}});
      const js=(code)=>w.webContents.executeJavaScript(code);
      const wait=async(code)=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait timed out: '+code)};
      const click=async(text)=>js('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()==='+JSON.stringify(text)+').click()');
      await w.loadFile(join(__dirname,'index.html'));
      await wait('!!document.querySelector(".autoshort-overlay-control button")');
      await click('Ảnh / Chữ');
      await click('Chọn ảnh PNG / JPG');
      await wait('document.querySelector(".autoshort-overlay-preview img")?.naturalWidth>0');
      await js('document.querySelector("input[type=checkbox]").click()');
      await wait('document.querySelector(".autoshort-overlay-preview span")?.textContent==="Tên kênh"');
      await wait(${JSON.stringify('document.fonts.check(\'22px "overlay-noto-sans"\')')});
      const state=JSON.parse(await js('document.getElementById("state").textContent'));
      assert.ok(state.image&&state.text);
      const geometry=await js('(()=>{const p=document.querySelector(".autoshort-overlay-preview").getBoundingClientRect();const i=document.querySelector(".autoshort-overlay-preview img").getBoundingClientRect();return {imageW:i.width,imageH:i.height,x:i.x-p.x,y:i.y-p.y,parentW:p.width,parentH:p.height}})()');
      assert.ok(geometry.imageW>0&&geometry.x>=0&&geometry.y>=0&&geometry.x+geometry.imageW<=geometry.parentW);
      await new Promise(r=>setTimeout(r,150));
      writeFileSync(${JSON.stringify(join(evidence, 'overlay-ui.png'))},(await w.webContents.capturePage()).toPNG());
      await click('Bỏ ảnh');
      await wait('!document.querySelector(".autoshort-overlay-preview img")');
      await js('document.querySelector("input[type=checkbox]").click()');
      await wait('!document.querySelector(".autoshort-overlay-preview span")');
      await js('document.getElementById("running").click()');
      await wait('document.querySelector(".autoshort-overlay-control button").disabled&&!document.querySelector(".autoshort-overlay-panel")');
      console.log('PASS overlay UI: image load under app CSP, automatic font, text toggle, removal, containment, running lock');
      w.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});
    setTimeout(()=>{console.error('UI smoke timeout');app.exit(1)},20000).unref();
  `)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [join(work, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' })
    child.on('error', reject); child.on('exit', resolve)
  })
  if (code !== 0) throw new Error(`Overlay UI smoke exited ${code}`)
} finally {
  const rel = relative(tmpdir(), work)
  if (!rel.startsWith('tedia-overlay-ui-') || rel.includes('..')) throw new Error('Unsafe smoke cleanup path')
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
