import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const require = createRequire(import.meta.url)
const work = await mkdtemp(join(tmpdir(), 'tedia-layer-ui-'))
const evidence = join(process.cwd(), '.ai/tasks/2026-10-13-effect-layers')
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || 'ffmpeg'
try {
  await mkdir(evidence, { recursive: true })
  const source = join(work, 'source.mp4'), texture = join(work, 'screen.mp4'), multiplier = join(work, 'multiply.mp4'), matte = join(work, 'matte.mp4')
  const generate = (filter, path) => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', filter, '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p', path], { windowsHide: true, timeout: 10000 })
    assert.equal(r.status, 0, r.stderr.toString())
  }
  generate('color=0x3864A2:s=320x180:r=12:d=3', source)
  generate('color=0x202020:s=320x180:r=24:d=1', texture)
  generate('color=0xD0D0D0:s=320x180:r=24:d=1', multiplier)
  generate('color=black:s=320x180:r=24:d=1,drawbox=x=0:y=0:w=160:h=180:c=white:t=fill', matte)
  const rgb = path => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-i', path, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true })
    assert.equal(r.status, 0); return Array.from(r.stdout.subarray((50 * 320 + 50) * 3, (50 * 320 + 50) * 3 + 3))
  }
  const base = rgb(source), a = rgb(texture), b = rgb(multiplier)
  const layers = [{ assetPath: texture, blendMode: 'screen' }, { assetPath: multiplier, blendMode: 'multiply' }]
  await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    import Preview from './src/renderer/src/components/VideoEffectsPreview';import {localMediaSource} from './src/renderer/src/lib/localMedia';
    import './src/renderer/src/components/VideoEffectsControl.css';
    function Fixture(){const ref=useRef(null),[strength,setStrength]=useState(75),[mode,setMode]=useState('legacy');
      const first={kind:'custom_overlay',intensity:strength,assetPath:${JSON.stringify(texture)},blendMode:'screen'};
      const effects=mode==='none'?[]:mode==='matte'?[{...first,mattePath:${JSON.stringify(matte)},blendMode:'alphamerge'}]:mode==='stack'?[
        {...first,intensity:100},{kind:'custom_overlay',intensity:100,assetPath:${JSON.stringify(multiplier)},blendMode:'multiply'}]:[
        mode==='legacy'?{...first,sourceType:'capcut'}:{...first,layers:${JSON.stringify(layers)}}];
      return <><div id="preview" style={{position:'relative',isolation:'isolate',width:320,height:180,overflow:'hidden'}}>
       <video id="main" ref={ref} src={localMediaSource(${JSON.stringify(source)})} muted style={{width:320,height:180}} />
       <Preview effects={effects} videoRef={ref} width={320} height={180}/></div>
       {[25,75,100].map(n=><button id={'strength'+n} key={n} onClick={()=>setStrength(n)}>{n}</button>)}
       {['group','stack','matte','none'].map(n=><button id={n} key={n} onClick={()=>setMode(n)}>{n}</button>)}</>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);`
  }, bundle: true, jsx: 'automatic', format: 'iife', outfile: join(work, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(work, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="ui.css"></head><body style="margin:0"><div id="root"></div><script src="ui.js"></script></body></html>')
  await writeFile(join(work, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('api',{resolveOverlayComposition:p=>ipcRenderer.invoke('composition',p)});`)
  await writeFile(join(work, 'main.cjs'), `
    const {app,BrowserWindow,protocol,ipcMain}=require('electron');const {readFileSync,writeFileSync}=require('fs');const {join}=require('path');const assert=require('assert/strict');
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
    app.setPath('userData',join(__dirname,'profile'));app.disableHardwareAcceleration();let lookups=0;
    app.whenReady().then(async()=>{
      const allowed=new Set(${JSON.stringify([source, texture, multiplier, matte])});
      protocol.handle('tblao',req=>{const p=Buffer.from(new URL(req.url).pathname.slice(1),'base64url').toString();if(!allowed.has(p))return new Response('Not found',{status:404});
        const bytes=readFileSync(p),range=req.headers.get('range');let start=0,end=bytes.length-1;if(range){const m=range.match(/bytes=(\\d+)-(\\d*)/);if(m){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;}}
        return new Response(bytes.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*',...(range?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})}});
      });
      ipcMain.handle('composition',(_e,p)=>{assert.equal(p,${JSON.stringify(texture)});lookups++;return {ok:true,composition:{layers:${JSON.stringify(layers)}}};});
      const w=new BrowserWindow({show:false,width:340,height:260,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,offscreen:true}});
      const js=code=>w.webContents.executeJavaScript(code);const wait=async(code)=>{for(let i=0;i<180;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI predicate failed: '+code);};
      const ready='(()=>{const vs=[...document.querySelectorAll("#preview video")];return vs.length===3&&vs.every(v=>v.readyState>=2&&!v.seeking)&&document.querySelector(".video-effects-texture-screen")})()';
      await w.loadFile(join(__dirname,'index.html'));await wait(ready);await wait('document.querySelector(".video-effects-texture-screen").getContext("2d").getImageData(50,50,1,1).data[3]===255');assert.equal(lookups,1);
      const sample=async(x=50)=>{const im=await w.webContents.capturePage({x:0,y:0,width:320,height:180}),sz=im.getSize();assert.equal(sz.width,320);const d=im.toBitmap(),p=(50*320+x)*4;return [d[p+2],d[p+1],d[p]];};
      const base=${JSON.stringify(base)},a=${JSON.stringify(a)},b=${JSON.stringify(b)},observations=[];
      const expected=s=>base.map((v,c)=>v*(1-s)+((255-(255-v)*(255-a[c])/255)*b[c]/255)*s);
      const check=async(s)=>{let actual;for(let i=0;i<60;i++){actual=await sample();if(actual.every((v,c)=>Math.abs(v-expected(s)[c])<=5))break;await new Promise(r=>setTimeout(r,25));}
        actual.forEach((v,c)=>assert.ok(Math.abs(v-expected(s)[c])<=5,'Preview RGB mismatch: '+actual+' vs '+expected(s)));observations.push({strength:s,actual,expected:expected(s)});};
      writeFileSync(${JSON.stringify(join(evidence, 'preview.png'))},(await w.webContents.capturePage({x:0,y:0,width:320,height:180})).toPNG());await check(.75);
      await js('document.getElementById("strength25").click()');await wait('document.querySelector(".video-effects-texture-screen").getContext("2d").getImageData(50,50,1,1).data[0]<10');await check(.25);
      await js('document.getElementById("main").currentTime=.5');await wait('[...document.querySelectorAll("#preview video")].every(v=>Math.abs(v.currentTime-.5)<.04&&!v.seeking)');
      await js('document.getElementById("main").playbackRate=1.5');await wait('[...document.querySelectorAll("#preview video")].every(v=>v.playbackRate===1.5)');
      await js('document.getElementById("main").play()');await wait('[...document.querySelectorAll("#preview video")].every(v=>!v.paused)');
      await js('document.getElementById("main").pause()');await wait('[...document.querySelectorAll("#preview video")].every(v=>v.paused)');
      await js('document.getElementById("stack").click()');await wait('document.querySelectorAll(".video-effects-grunge-layer").length===2&&[...document.querySelectorAll("#preview video")].every(v=>v.readyState>=2&&!v.seeking)');
      await check(1);
      await js('document.getElementById("matte").click()');await wait('document.querySelector(".video-effects-keyed-layer")&&[...document.querySelectorAll("#preview video")].every(v=>v.readyState>=2&&!v.seeking)');
      await wait('document.querySelector(".video-effects-keyed-layer").getContext("2d").getImageData(50,50,1,1).data[3]>250');
      const left=await sample(),right=await sample(250);right.forEach((v,c)=>assert.ok(Math.abs(v-base[c])<=4,'Black matte must keep the source visible'));
      left.forEach((v,c)=>assert.ok(Math.abs(v-(base[c]*.75+a[c]*.25))<=5,'Matte intensity must agree with export'));
      await js('document.getElementById("none").click()');await wait('document.querySelectorAll("#preview canvas").length===0&&document.querySelectorAll("#preview video").length===1');
      const proof={observations,legacyLookups:lookups,checks:['ordered internal passes','whole-group intensity','all configured video effects','matte alpha/intensity','seek','rate','play/pause','unmount cleanup']};
      writeFileSync(${JSON.stringify(join(evidence, 'preview-proof.json'))},JSON.stringify(proof,null,2));console.log('PASS layered preview',JSON.stringify(proof));w.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});setTimeout(()=>app.exit(2),30000).unref();
  `)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [join(work, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject); child.once('exit', resolve)
  })
  assert.equal(code, 0)
} finally {
  assert.ok(relative(tmpdir(), work).startsWith('tedia-layer-ui-'))
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
