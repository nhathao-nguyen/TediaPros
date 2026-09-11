import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

// Actual renderer screens, isolated IPC fixture and media. Never load a user profile.
const require = createRequire(import.meta.url)
const root = await mkdtemp(join(tmpdir(), 'tedia-portrait-preview-'))
const evidence = resolve(process.argv[2] || 'docs/reviews/2026-09-10-portrait-blur')
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros', 'bin', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
try {
  await mkdir(evidence, { recursive: true })
  const source = join(root, 'landscape.mp4')
  const gen = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=20:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
  assert.equal(gen.status, 0, gen.stderr?.toString())
  const renderer = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import AutoShort from './src/renderer/src/components/AutoShort';
    import VideoEditor from './src/renderer/src/components/VideoEditor';
    import './src/renderer/src/styles.css';
    const source = ${JSON.stringify(source)};
    localStorage.setItem('tblao.autoshort.tasks', JSON.stringify([{id:'fixture',filePath:source,fileName:'landscape.mp4',status:'pending',percent:0}]));
    localStorage.setItem('tblao.autoshort.fontSize', '20');
    localStorage.setItem('tblao.outputDir.editor', JSON.stringify(${JSON.stringify(root)}));
    localStorage.setItem('tblao.outputDir.autoshort', JSON.stringify(${JSON.stringify(root)}));
    window.fixtureErrors = [];
    window.addEventListener('error', e => window.fixtureErrors.push(e.message));
    window.addEventListener('unhandledrejection', e => window.fixtureErrors.push(String(e.reason)));
    const api = {
      listBurnFonts: async () => [], downloadsDir: async () => ${JSON.stringify(root)},
      ttsCheckHealth: async () => ({ok:false}), ttsGetModels: async () => ({ok:true,models:[]}),
      ttsListClonedVoices: async () => [], translateHasKey: async () => false,
      autoShortGetReadiness: async () => ({ok:true,ready:true,dependencies:[],missing:[]}),
      probeVideo: async () => ({ok:true,width:640,height:360,duration:3,hasAudio:false}),
      loadBurnFontData: async () => ({ok:false}),
      burnStart: async req => { window.burnRequest = req; return {ok:false,error:'Fixture captured request'}; },
      chooseFiles: async () => [source]
    };
    window.api = new Proxy(api, {get(target,key) {
      if (key in target) return target[key];
      if (String(key).startsWith('on')) return () => () => {};
      return async () => ({ok:false,error:'Offline fixture'});
    }});
    const mode = new URLSearchParams(location.search).get('mode');
    createRoot(document.getElementById('root')).render(mode === 'editor'
      ? <VideoEditor draft={{requestId:'fixture',video:source,srt:null,outputDir:${JSON.stringify(root)}}}/>
      : <AutoShort/>);
  `
  await build({ stdin: { contents: renderer, loader: 'tsx', resolveDir: process.cwd() }, bundle: true, format: 'iife', jsx: 'automatic', outfile: join(root, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' } })
  await writeFile(join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="renderer.js"></script>')
  const main = `
    const {app,BrowserWindow,protocol} = require('electron');
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
    app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
    app.whenReady().then(async () => {
      const media = fs.readFileSync(${JSON.stringify(source)});
      protocol.handle('tblao', req => {
        const range = req.headers.get('range');
        const parts = range ? range.slice(6).split('-') : [];
        const start = parts.length ? Number(parts[0]) : 0;
        const end = parts[1] ? Math.min(Number(parts[1]),media.length-1) : media.length-1;
        const headers = {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Content-Length':String(end-start+1)};
        if(range) headers['Content-Range']='bytes '+start+'-'+end+'/'+media.length;
        return new Response(media.subarray(start,end+1),{status:range?206:200,headers});
      });
      const win = new BrowserWindow({show:false,width:1180,height:820,webPreferences:{backgroundThrottling:false}});
      const run = js => win.webContents.executeJavaScript(js,true);
      const until = async js => {
        for(let i=0;i<150;i++) { if(await run(js)) return; await new Promise(r=>setTimeout(r,50)); }
        throw Error('Timed out: '+js+' errors='+JSON.stringify(await run('window.fixtureErrors')));
      };
      const results = [];
      try {
        for(const mode of ['editor','autoshort']) {
          await win.loadFile(${JSON.stringify(join(root, 'index.html'))},{query:{mode}});
          await until('!!document.querySelector("video") && document.querySelector("video").readyState >= 2 && document.querySelector("video").getBoundingClientRect().width > 20');
          await new Promise(r=>setTimeout(r,200));
          assert.equal(await run('document.querySelector(".portrait-blur-toggle").getAttribute("aria-pressed")'),'false');
          await run('document.querySelector("video").currentTime=0.6');
          await until('!document.querySelector("video").seeking');
          await run('window.originalVideo=document.querySelector("video"); document.querySelector(".portrait-blur-toggle").click()');
          await until('document.querySelector(".portrait-frame-preview").dataset.portraitBlur === "true" && !!document.querySelector("canvas")');
          await until('(() => {const r=document.querySelector(".portrait-frame-preview").getBoundingClientRect();return Math.abs(r.width/r.height-9/16)<0.003})()');
          const shape = await run('(() => {const a=document.querySelector(".portrait-frame-preview").getBoundingClientRect();const b=document.querySelector("video").getBoundingClientRect();return {ratio:a.width/a.height,source:b.width/b.height,top:b.top-a.top,left:b.left-a.left,same:originalVideo===document.querySelector("video"),time:document.querySelector("video").currentTime}})()');
          assert.ok(Math.abs(shape.ratio - 9/16) < 0.003, JSON.stringify(shape));
          assert.ok(Math.abs(shape.source - 1080/606) < 0.004, JSON.stringify(shape));
          assert.ok(shape.top > 20 && shape.left < 1, JSON.stringify(shape));
          assert.ok(shape.same && Math.abs(shape.time - 0.6)<0.05,'toggle preserves media element and seek: '+JSON.stringify(shape));
          if(mode==='editor') {
            assert.ok(await run('!!document.querySelector(".rbox-lop")'),'editor region overlay is ready before same-file selection');
            await run('document.querySelector(".editor-source").click()');
            await new Promise(r=>setTimeout(r,150));
            assert.ok(await run('!!document.querySelector(".rbox-lop")'),'selecting the current video preserves metadata and editor overlays');
          }
          if(mode==='autoshort') {
            const font = await run('({actual:parseFloat(getComputedStyle(document.querySelector(".sub-sample-text")).fontSize),expected:20*document.querySelector("video").getBoundingClientRect().height/360})');
            assert.ok(Math.abs(font.actual-font.expected)<0.1,'subtitle scales with fitted foreground: '+JSON.stringify(font));
          }
          await until('(() => {const c=document.querySelector("canvas");return c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((x,i)=>i%4!==3 && x>20)})()');
          const checksum = '(() => {const c=document.querySelector("canvas");return Array.from(c.getContext("2d").getImageData(0,0,c.width,c.height).data).reduce((a,b)=>a+b,0)})()';
          const before = await run(checksum);
          await run('document.querySelector("video").currentTime=1.8');
          await until('!document.querySelector("video").seeking');
          await until(checksum + ' !== ' + before);
          await run('document.querySelector("video").playbackRate=1.5;document.querySelector("video").play()');
          await until('document.querySelector("video").currentTime>2.0');
          await run('document.querySelector("video").pause()');
          const paused = await run(checksum);
          await new Promise(r=>setTimeout(r,150));
          assert.equal(await run(checksum), paused, 'background stops with source');
          await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          await new Promise(r=>setTimeout(r,300));
          const caption = await run('(() => {const s=document.querySelector(".sub-preview-line");const r=s?.getBoundingClientRect();return s?{font:parseFloat(getComputedStyle(s).fontSize),width:r.width,height:r.height}:null})()');
          if(mode==='autoshort') {
            const expected = await run('20*document.querySelector("video").getBoundingClientRect().height/360');
            assert.ok(Math.abs(caption.font-expected)<0.1,'painted subtitle line inherits proportional font: '+JSON.stringify(caption));
          }
          fs.writeFileSync(${JSON.stringify(evidence)}+'/'+mode+'-portrait.png',(await win.webContents.capturePage()).toPNG());
          win.setSize(800,720);
          await new Promise(r=>setTimeout(r,150));
          assert.ok(await run('(() => {const a=document.querySelector(".portrait-frame-preview").getBoundingClientRect();const s=document.querySelector(".editor-stage-shell").getBoundingClientRect();return a.width>0 && a.height>0 && a.left>=s.left && a.right<=s.right+1 && a.bottom<=s.bottom+1})()'),'preview fits resized pane');
          if(mode==='editor') {
            await run('document.querySelector(".editor-export-top").click()');
            await until('!!window.burnRequest');
            assert.equal(await run('window.burnRequest.portraitBlur'),true,'actual editor export carries setting');
          }
          await run('document.querySelector(".portrait-blur-toggle").click()');
          await until('document.querySelector(".portrait-frame-preview").dataset.portraitBlur === "false"');
          assert.equal(await run('document.querySelectorAll("video").length'),1);
          assert.equal(await run('document.querySelectorAll(".portrait-frame-background").length'),0);
          assert.deepEqual(await run('window.fixtureErrors'),[]);
          results.push({mode,passed:true,shape,caption,seek:true,playPause:true,resize:true,sameFileReselection:mode==='editor'?true:null});
          win.setSize(1180,820);
        }
        fs.writeFileSync(${JSON.stringify(join(evidence, 'preview-results.json'))},JSON.stringify(results,null,2));
        app.exit(0);
      } catch(error) { console.error(error); app.exit(1); }
    });
  `
  const entry = join(root, 'main.cjs')
  await writeFile(entry, main)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [entry], { env, windowsHide: true, encoding: 'utf8', timeout: 60000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  console.log(await readFile(join(evidence, 'preview-results.json'), 'utf8'))
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'tedia-portrait-preview-')))
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
