import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url), ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || 'ffmpeg'
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe')
const work = await mkdtemp(join(tmpdir(), 'tedia-packed-proof-'))
const evidence = join(process.cwd(), '.ai/tasks/2026-10-13-packed-overlay')
const packageRoot = join(process.env.LOCALAPPDATA, 'CapCut/User Data/Cache/effect/7620270556557921589/6cb91fa515cd8b6854c46673ba32e0cc')
const asset = join(packageRoot, 'AmazingFeature/resource/video/overlay.mp4'), source = join(work, 'source.mp4')
const run = args => { const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 }); assert.equal(r.status, 0, r.error?.message || r.stderr.toString()); return r.stdout }
try {
  await mkdir(evidence, { recursive: true })
  run(['-f', 'lavfi', '-i', 'color=0x3864A2:s=320x180:r=12:d=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import {spawnSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';import {join} from 'node:path';import assert from 'node:assert/strict';
    import {readCapCutPackedAlpha} from './src/main/capcutPackedAlpha';import {appendVideoEffects,planVideoEffectInputs} from './src/main/videoEffects';
    import {burnAutoShort} from './src/main/burn';
    (async()=>{const asset=${JSON.stringify(asset)},ff=${JSON.stringify(ffmpeg)},evidence=${JSON.stringify(evidence)},source=${JSON.stringify(source)};
      const composition=await readCapCutPackedAlpha(${JSON.stringify(packageRoot)},asset);assert.deepEqual(composition,{packedAlpha:'left',blendMode:'multiply'});
      for(const [name,extra] of [['before',{}],['after',composition]]){
        const effects=[{kind:'custom_overlay',assetPath:asset,intensity:75,blendMode:'screen',...extra}];
        const inputs=planVideoEffectInputs(effects,1),lines=['[0:v]null[out]'];appendVideoEffects(lines,320,180,effects,inputs.mappings);
        const r=spawnSync(ff,['-v','error','-y','-i',source,...inputs.inputArgs,'-filter_complex',lines.join(';'),'-map','[out]','-ss','1','-frames:v','1',join(evidence,name+'.png')],{windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr.toString());
      }
      const res=await burnAutoShort({video:source,mode:'burn'},{videoEffects:[{kind:'custom_overlay',assetPath:asset,intensity:75,blendMode:'screen',sourceType:'capcut'}],
        ffmpegPath:ff,ffprobePath:${JSON.stringify(ffprobe)},finalOutputPath:join(evidence,'fixed-overlay.mp4'),itemWorkDir:${JSON.stringify(work)},signal:new AbortController().signal,
        expectedMedia:{durationSeconds:2,frameRate:12,requireAudio:true,durationToleranceFrames:3}},()=>{});assert.equal(res.ok,true,JSON.stringify(res));
      await writeFile(join(evidence,'export-proof.json'),JSON.stringify({composition,...res},null,2));
    })().catch(e=>{console.error(e);process.exitCode=1});`
  }, bundle: true, platform: 'node', format: 'cjs', outfile: join(work, 'render.cjs'), plugins: [{ name: 'electron-fixture', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `module.exports={app:{getPath:()=>${JSON.stringify(join(work, 'profile'))},getAppPath:()=>process.cwd(),getVersion:()=> '0.1.36',isPackaged:false},BrowserWindow:class{}}`, loader: 'js' }))
  } }] })
  const rendered = spawnSync(process.execPath, [join(work, 'render.cjs')], { windowsHide: true, timeout: 40000, encoding: 'utf8' })
  assert.equal(rendered.status, 0, rendered.error?.message || rendered.stdout + rendered.stderr)
  run(['-i', join(evidence, 'fixed-overlay.mp4'), '-f', 'null', 'NUL'])
  const metadata = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(evidence, 'fixed-overlay.mp4')], { windowsHide: true, encoding: 'utf8' })
  assert.equal(metadata.status, 0); const streams = JSON.parse(metadata.stdout).streams
  assert.equal(Number(streams.find(s => s.codec_type === 'video').nb_frames), 24); assert.ok(streams.some(s => s.codec_type === 'audio'))
  run(['-i', join(evidence, 'before.png'), '-i', join(evidence, 'after.png'), '-filter_complex', '[0:v][1:v]hstack', '-frames:v', '1', join(evidence, 'comparison.png')])
  const reference = run(['-i', join(evidence, 'after.png'), '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
  const points = [40, 160, 280].map(x => ({ x, y: 90, expected: Array.from(reference.subarray((90 * 320 + x) * 3, (90 * 320 + x) * 3 + 3)) }))
  const selected = { kind: 'custom_overlay', assetPath: asset, intensity: 75, blendMode: 'screen', sourceType: 'capcut' }
  const scanned = { id: 'packed-overlay', name: 'Overlay', videoPath: asset, folderPath: packageRoot, packedAlpha: 'left', blendMode: 'multiply', isPro: false, aspectRatio: 'unknown' }
  await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
    import Preview from './src/renderer/src/components/VideoEffectsPreview';import Control from './src/renderer/src/components/VideoEffectsControl';import {localMediaSource} from './src/renderer/src/lib/localMedia';
    function Fixture(){const ref=useRef(null),[effects,setEffects]=useState([${JSON.stringify(selected)}]);return <>
      <div id="preview" style={{position:'relative',isolation:'isolate',width:320,height:180}}><video id="main" ref={ref} src={localMediaSource(${JSON.stringify(source)})} muted style={{width:320,height:180}}/>
      <Preview effects={effects} videoRef={ref} width={320} height={180}/></div><button id="clear" onClick={()=>setEffects([])}>Clear</button>
      <div id="control"><Control value={effects} onChange={setEffects} disabled={false}/></div><pre id="config">{JSON.stringify(effects)}</pre></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`
  }, bundle: true, jsx: 'automatic', format: 'iife', outfile: join(work, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(work, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="ui.css"></head><body style="margin:0"><div id="root"></div><script src="ui.js"></script></body></html>')
  await writeFile(join(work, 'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('api',{
    resolveOverlayComposition:p=>ipcRenderer.invoke('composition',p),scanCapCutEffects:()=>Promise.resolve([${JSON.stringify(scanned)}]),getSavedOverlayEffects:()=>Promise.resolve([])});`)
  await writeFile(join(work, 'main.cjs'), `
    const {app,BrowserWindow,protocol,ipcMain}=require('electron'),{readFileSync,writeFileSync}=require('fs'),{join}=require('path'),assert=require('assert/strict');
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true,corsEnabled:true}}]);
    app.setPath('userData',join(__dirname,'profile-ui'));app.disableHardwareAcceleration();let lookups=0;
    app.whenReady().then(async()=>{const allowed=new Set(${JSON.stringify([source, asset])});
      protocol.handle('tblao',req=>{const p=Buffer.from(new URL(req.url).pathname.slice(1),'base64url').toString();if(!allowed.has(p))return new Response('',{status:404});
        const bytes=readFileSync(p),range=req.headers.get('range');let start=0,end=bytes.length-1;if(range){const m=range.match(/bytes=(\\d+)-(\\d*)/);if(m){start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;}}
        return new Response(bytes.subarray(start,end+1),{status:range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*',...(range?{'Content-Range':'bytes '+start+'-'+end+'/'+bytes.length}:{})}});});
      ipcMain.handle('composition',(_e,p)=>{assert.equal(p,${JSON.stringify(asset)});lookups++;return {ok:true,composition:{packedAlpha:'left',blendMode:'multiply'}}});
      const w=new BrowserWindow({show:false,width:900,height:720,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,offscreen:true}});
      const js=code=>w.webContents.executeJavaScript(code),wait=async(code)=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,25))}throw Error('Predicate failed: '+code)};
      await w.loadFile(join(__dirname,'index.html'));await wait('document.querySelector("#preview .video-effects-keyed-layer")&&[...document.querySelectorAll("#preview video")].every(v=>v.readyState>=2&&!v.seeking)');
      await js('document.getElementById("main").currentTime=1');await wait('[...document.querySelectorAll("#preview video")].every(v=>Math.abs(v.currentTime-1)<.04&&!v.seeking)');
      await wait('document.querySelector("#preview .video-effects-keyed-layer").getContext("2d").getImageData(80,45,1,1).data[3]>250');
      const screenshot=await w.webContents.capturePage({x:0,y:0,width:320,height:180}),bitmap=screenshot.toBitmap();
      const observations=${JSON.stringify(points)}.map(p=>{const i=(p.y*320+p.x)*4;return {...p,actual:[bitmap[i+2],bitmap[i+1],bitmap[i]]}});
      for(const p of observations)p.actual.forEach((v,c)=>assert.ok(Math.abs(v-p.expected[c])<=7,'Preview/export mismatch '+JSON.stringify(p)));
      writeFileSync(${JSON.stringify(join(evidence, 'preview.png'))},screenshot.toPNG());assert.equal(lookups,1);
      await js('document.getElementById("clear").click()');await wait('document.querySelectorAll("#preview canvas").length===0');
      await js('document.querySelector("#control button").click()');await wait('document.querySelectorAll(".video-effects-tab").length===3');
      await js('document.querySelectorAll(".video-effects-tab")[1].click()');await wait('document.querySelector(".video-effects-capcut-section .video-effect-card")');
      await js('document.querySelector(".video-effects-capcut-section .video-effect-card").click()');
      await wait('JSON.parse(document.getElementById("config").textContent)[0]?.packedAlpha==="left"');
      const config=await js('JSON.parse(document.getElementById("config").textContent)');assert.equal(config[0].blendMode,'multiply');
      await wait('document.querySelector(".video-effect-sample .video-effects-keyed-layer")');
      const proof={observations,legacyLookups:lookups,config,frames:24,hasAudio:true,fullyDecoded:true,checks:['legacy preview recovery','RGB/alpha unpack before geometry','preview matches FFmpeg','CapCut card and selection carry layout','canvas cleanup']};
      writeFileSync(${JSON.stringify(join(evidence, 'preview-proof.json'))},JSON.stringify(proof,null,2));console.log('PASS packed overlay',JSON.stringify(proof));w.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});setTimeout(()=>app.exit(2),30000).unref();`
  )
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => { const child = spawn(require('electron'), [join(work, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' }); child.once('error', reject); child.once('exit', resolve) })
  assert.equal(code, 0)
  console.log('Export proof:', await readFile(join(evidence, 'export-proof.json'), 'utf8'))
} finally {
  assert.ok(relative(tmpdir(), work).startsWith('tedia-packed-proof-'))
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
