import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const repo = process.cwd()
const work = await mkdtemp(join(tmpdir(), 'tedia-chroma-ui-'))
const evidence = join(repo, '.ai/tasks/2026-10-01-bursting-smoke-fix')
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros/bin/ffmpeg.exe')
try {
  await mkdir(evidence, { recursive: true })
  const source = join(work, 'source.mp4')
  const synthetic = join(work, 'texture.mp4')
  const generate = args => {
    const p = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 15000 })
    if (p.status !== 0) throw new Error(p.stderr?.toString() || p.error?.message)
  }
  generate(['-f', 'lavfi', '-i', 'color=0x404040:s=360x640:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source])
  const asset = process.env.TEDIAPROS_CHROMA_KEY_ASSET || synthetic
  if (asset === synthetic) generate(['-f', 'lavfi', '-i', 'color=0x00FF00:s=360x640:r=30:d=2,drawbox=x=100:y=250:w=160:h=140:c=0xC0C0C0:t=fill', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', synthetic])
  await build({ stdin: { contents: `
    import React, {useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import Preview from './src/renderer/src/components/VideoEffectsPreview';
    import {localMediaSource} from './src/renderer/src/lib/localMedia';
    import './src/renderer/src/components/VideoEffectsControl.css';
    function Fixture(){
      const ref=useRef(null);const [intensity,setIntensity]=useState(75);
      return <main style={{fontFamily:'sans-serif',padding:24,color:'#eee',background:'#141820'}}>
        <h2>BurstingSmoke · kiểm tra tách nền</h2>
        <div style={{display:'flex',gap:24}}>
          <section><p>Video nguyên liệu</p><video id="raw" muted src={localMediaSource(${JSON.stringify(asset)})} style={{width:360,height:640,objectFit:'cover'}} /></section>
          <section><p>Preview đã tách nền</p><div style={{position:'relative',width:360,height:640,overflow:'hidden',background:'#404040'}}>
            <video id="main" ref={ref} muted src={localMediaSource(${JSON.stringify(source)})} style={{width:'100%',height:'100%'}} />
            <Preview videoRef={ref} effects={[{kind:'custom_overlay',assetPath:${JSON.stringify(asset)},sourceType:'capcut',blendMode:'screen',intensity}]} width={360} height={640} />
          </div></section>
        </div><button id="weak" onClick={()=>setIntensity(25)}>25%</button>
      </main>
    }createRoot(document.getElementById('root')).render(<Fixture/>);
  `, resolveDir: repo, loader: 'tsx' }, bundle: true, jsx: 'automatic', format: 'iife', outfile: join(work, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } })
  const appHtml = await readFile(join(repo, 'src/renderer/index.html'), 'utf8')
  const csp = appHtml.match(/content="(default-src[^"]+)"/)[1]
  await writeFile(join(work, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="ui.css"></head><body style="margin:0"><div id="root"></div><script src="ui.js"></script></body></html>`)
  await writeFile(join(work, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('api',{resolveOverlayChromaKey:p=>ipcRenderer.invoke('key',p)});`)
  await writeFile(join(work, 'main.cjs'), `
    const {app,BrowserWindow,protocol,ipcMain}=require('electron');
    const {readFileSync,writeFileSync}=require('node:fs');const {join}=require('node:path');const assert=require('node:assert/strict');
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
    app.setPath('userData',join(__dirname,'profile'));app.disableHardwareAcceleration();
    let lookups=0;
    app.whenReady().then(async()=>{
      const allowed=new Set([${JSON.stringify(asset)},${JSON.stringify(source)}]);
      protocol.handle('tblao',req=>{const p=Buffer.from(new URL(req.url).pathname.slice(1),'base64url').toString('utf8');if(!allowed.has(p))return new Response('Not found',{status:404});
        const bytes=readFileSync(p);const range=req.headers.get('range');let start=0,end=bytes.length-1;
        if(range){const m=range.match(/bytes=(\\d+)-(\\d*)/);if(m){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;}}
        return new Response(bytes.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*',...(range?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})}});
      });
      ipcMain.handle('key',(_e,p)=>{assert.equal(p,${JSON.stringify(asset)});lookups++;return {ok:true,chromaKey:{color:'#00FF00',similarity:0.3,blend:0.12}};});
      const w=new BrowserWindow({show:false,width:820,height:850,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,offscreen:true}});
      const js=code=>w.webContents.executeJavaScript(code);
      const wait=async(code)=>{for(let i=0;i<160;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait timed out: '+code);};
      await w.loadFile(join(__dirname,'index.html'));
      await wait('document.querySelector(".video-effects-keyed-layer")&&document.querySelector(".video-effects-grunge-layer").readyState>=2&&document.getElementById("main").readyState>=2');
      assert.equal(lookups,1,'Old selection metadata must resolve once');
      assert.equal(await js('document.querySelector(".video-effects-grunge-layer").paused'),true,'Overlay must remain paused with the main video');
      await js('document.getElementById("main").currentTime=0.5;document.getElementById("raw").currentTime=0.5');
      await wait('Math.abs(document.querySelector(".video-effects-grunge-layer").currentTime-0.5)<0.04');
      const statsCode='(()=>{const c=document.querySelector(".video-effects-keyed-layer");const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let transparent=0,smoke=0,green=0;for(let p=0;p<d.length;p+=4){if(d[p+3]<8)transparent++;if(d[p+3]>30)smoke++;if(d[p+3]>8&&d[p+1]>Math.max(d[p],d[p+2])+3)green++;}return {transparent,smoke,green,pixels:d.length/4};})()';
      await wait('('+statsCode+').smoke>100');
      const stats=await js(statsCode);
      assert.equal(stats.green,0,'Keyed smoke must not carry green spill');
      assert.ok(stats.smoke>100,'Smoke must survive keying');
      assert.equal(await js('getComputedStyle(document.querySelector(".video-effects-grunge-layer")).opacity'),'0');
      assert.equal(await js('getComputedStyle(document.querySelector(".video-effects-keyed-layer")).opacity'),'0.75');
      writeFileSync(${JSON.stringify(join(evidence, 'preview.png'))},(await w.webContents.capturePage()).toPNG());
      await js('document.getElementById("main").currentTime=0');
      await wait('document.querySelector(".video-effects-grunge-layer").currentTime<0.04');
      await wait('('+statsCode+').transparent>100');
      await js('document.getElementById("main").playbackRate=1.5');
      await wait('document.querySelector(".video-effects-grunge-layer").playbackRate===1.5');
      await js('document.getElementById("weak").click()');
      await wait('getComputedStyle(document.querySelector(".video-effects-keyed-layer")).opacity==="0.25"');
      await js('document.getElementById("main").play()');
      await wait('!document.querySelector(".video-effects-grunge-layer").paused');
      await js('document.getElementById("main").pause()');
      await wait('document.querySelector(".video-effects-grunge-layer").paused');
      writeFileSync(${JSON.stringify(join(evidence, 'preview-proof.json'))},JSON.stringify({asset:${JSON.stringify(asset)},stats,checks:['CORS canvas read','legacy selection lookup','backing alpha','smoke retained','spill suppressed','intensity','pause/play','seek','rate']},null,2));
      console.log('PASS chroma UI: legacy lookup, CORS, transparent backing, smoke, spill, intensity, pause/play, seek and rate',stats);
      w.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});
    setTimeout(()=>{console.error('Chroma UI smoke timeout');app.exit(1)},25000).unref();
  `)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(require('electron'), [join(work, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject); child.once('exit', resolveCode)
  })
  if (code !== 0) throw new Error(`Chroma preview smoke exited ${code}`)
} finally {
  const rel = relative(tmpdir(), resolve(work))
  if (!rel.startsWith('tedia-chroma-ui-') || rel.includes('..')) throw new Error('Unsafe smoke cleanup path')
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
