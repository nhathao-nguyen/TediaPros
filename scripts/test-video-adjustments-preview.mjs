import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

// Exercise the real Auto Short renderer in an isolated Electron profile.
const require = createRequire(import.meta.url)
const root = await mkdtemp(join(tmpdir(), 'tedia-video-adjustments-preview-'))
const evidence = resolve(process.argv[2] || 'docs/reviews/video-adjustments')
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(
  process.env.APPDATA || '',
  'tedia-pros',
  'bin',
  'ffmpeg',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)

try {
  await mkdir(evidence, { recursive: true })
  const source = join(root, 'landscape.mp4')
  const generated = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=20:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source
  ], { windowsHide: true })
  assert.equal(generated.status, 0, generated.stderr?.toString())

  const renderer = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import AutoShort from './src/renderer/src/components/AutoShort';
    import './src/renderer/src/styles.css';
    const source = ${JSON.stringify(source)};
    localStorage.setItem('tblao.autoshort.tasks', JSON.stringify([{id:'fixture',filePath:source,fileName:'landscape.mp4',status:'pending',percent:0}]));
    localStorage.setItem('tblao.outputDir.autoshort', JSON.stringify(${JSON.stringify(root)}));
    window.fixtureErrors = [];
    window.addEventListener('error', event => window.fixtureErrors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.fixtureErrors.push(String(event.reason)));
    const api = {
      listBurnFonts: async () => [],
      downloadsDir: async () => ${JSON.stringify(root)},
      ttsCheckHealth: async () => ({ok:false}),
      ttsGetModels: async () => ({ok:true,models:[]}),
      ttsListClonedVoices: async () => [],
      translateHasKey: async () => false,
      autoShortGetReadiness: async () => ({ok:true,ready:true,dependencies:[],missing:[]}),
      probeVideo: async () => ({ok:true,width:640,height:360,duration:3,hasAudio:false}),
      loadBurnFontData: async () => ({ok:false}),
      autoShortStart: async request => {
        window.startRequest = request;
        return {ok:true,jobId:'fixture-job'};
      }
    };
    window.api = new Proxy(api, {get(target,key) {
      if (key in target) return target[key];
      if (String(key).startsWith('on')) return () => () => {};
      return async () => ({ok:false,error:'Offline fixture'});
    }});
    createRoot(document.getElementById('root')).render(
      <div className="shell journey-render">
        <aside className="sidebar" />
        <main className="content">
          <header className="content-head"><h1 className="content-title">Auto Short</h1></header>
          <div className="content-body"><div className="tab-pane"><AutoShort /></div></div>
        </main>
      </div>
    );
  `
  await build({
    stdin: { contents: renderer, loader: 'tsx', resolveDir: process.cwd() },
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    outfile: join(root, 'renderer.js'),
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }
  })
  await writeFile(join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style><div id="root"></div><script src="renderer.js"></script>')

  const main = `
    const {app,BrowserWindow,protocol} = require('electron');
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
    app.whenReady().then(async () => {
      const media = fs.readFileSync(${JSON.stringify(source)});
      protocol.handle('tblao', request => {
        const range = request.headers.get('range');
        const parts = range ? range.slice(6).split('-') : [];
        const start = parts.length ? Number(parts[0]) : 0;
        const end = parts[1] ? Math.min(Number(parts[1]), media.length - 1) : media.length - 1;
        const headers = {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Content-Length':String(end-start+1)};
        if (range) headers['Content-Range'] = 'bytes '+start+'-'+end+'/'+media.length;
        return new Response(media.subarray(start,end+1), {status:range?206:200,headers});
      });
      const win = new BrowserWindow({show:false,width:1180,height:820,webPreferences:{backgroundThrottling:false}});
      const run = code => win.webContents.executeJavaScript(code,true);
      const until = async code => {
        for (let index=0; index<150; index++) {
          if (await run(code)) return;
          await new Promise(resolve => setTimeout(resolve,50));
        }
        throw Error('Timed out: '+code+' errors='+JSON.stringify(await run('window.fixtureErrors')));
      };
      try {
        await win.loadFile(${JSON.stringify(join(root, 'index.html'))});
        await until('!!document.querySelector("video") && document.querySelector("video").readyState >= 2');
        const controlButton = 'Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Chỉnh hình ảnh"))';
        assert.ok(await run('!!'+controlButton), 'adjustment button is visible');
        await run(controlButton+'.click()');
        await until('!!document.querySelector(".video-adjustments-panel")');
        assert.equal(await run('document.querySelectorAll(".video-adjustments-row").length'), 4);
        const setRange = (label, value) => run('(() => {'+
          'const row=Array.from(document.querySelectorAll(".video-adjustments-row")).find(item => item.querySelector("span").textContent==='+JSON.stringify(label)+');'+
          'const input=row.querySelector("input[type=range]");'+
          'Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(String(value))+');'+
          'input.dispatchEvent(new Event("input",{bubbles:true}));'+
          'input.dispatchEvent(new Event("change",{bubbles:true}));'+
        '})()');
        const numberInput = label => 'Array.from(document.querySelectorAll(".video-adjustments-row")).find(item => item.querySelector("span").textContent==='+JSON.stringify(label)+').querySelector(".video-adjustments-number input")';
        const typeNumber = async (label, value) => {
          const input = numberInput(label);
          await run(input+'.focus();'+input+'.select()');
          for (const character of value) {
            await win.webContents.insertText(character);
            await new Promise(resolve => setTimeout(resolve, 30));
          }
          await run(input+'.blur()');
          await new Promise(resolve => setTimeout(resolve, 30));
          return run(input+'.value');
        };
        assert.equal(await typeNumber('Zoom', '110'), '110', 'typing 110 must not clamp an intermediate digit');
        assert.equal(await typeNumber('Độ sáng', '-5'), '-5', 'typing a negative brightness must retain its sign');
        assert.equal(await typeNumber('Tương phản', '103'), '103', 'typing 103 must not clamp an intermediate digit');
        const typed = await run('JSON.parse(localStorage.getItem("tblao.autoshort.videoAdjustments.v1"))');
        assert.deepEqual(typed, {zoom:110,brightness:-5,saturation:100,contrast:103});
        const zoomInput = numberInput('Zoom');
        await run(zoomInput+'.focus();'+zoomInput+'.select()');
        await win.webContents.insertText('9');
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
        await until('!document.querySelector(".video-adjustments-panel")');
        assert.deepEqual(
          await run('JSON.parse(localStorage.getItem("tblao.autoshort.videoAdjustments.v1"))'),
          typed,
          'Escape must discard an unfinished number without changing the committed value'
        );
        await run(controlButton+'.click()');
        await until('!!document.querySelector(".video-adjustments-panel")');
        assert.equal(await run(numberInput('Zoom')+'.value'), '110');
        await setRange('Zoom', 112);
        await setRange('Độ sáng', 5);
        await setRange('Độ bão hòa', 95);
        await setRange('Tương phản', 103);
        await until('document.querySelector("video").style.transform === "scale(1.12)"');
        assert.equal(await run('document.querySelector("video").style.filter'), 'brightness(1.05) saturate(0.95) contrast(1.03)');
        await run(controlButton+'.click()');
        await until('!document.querySelector(".video-adjustments-panel")');
        const subtitleBefore = await run('document.querySelector(".rbox-sub").getBoundingClientRect().toJSON()');
        const dragX = Math.round(subtitleBefore.left + 24);
        const dragY = Math.round(subtitleBefore.top + subtitleBefore.height / 2);
        win.webContents.sendInputEvent({type:'mouseDown',x:dragX,y:dragY,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseMove',x:dragX,y:dragY-60,button:'left'});
        win.webContents.sendInputEvent({type:'mouseUp',x:dragX,y:dragY-60,button:'left',clickCount:1});
        await new Promise(resolve => setTimeout(resolve, 60));
        const subtitleAfter = await run('document.querySelector(".rbox-sub").getBoundingClientRect().toJSON()');
        const subtitleDragPixels = subtitleAfter.top - subtitleBefore.top;
        assert.ok(
          Math.abs(subtitleDragPixels + 60) < 2,
          'subtitle drag must follow the pointer even when source zoom is active: '+JSON.stringify({subtitleBefore,subtitleAfter})
        );
        await run(controlButton+'.click()');
        await until('!!document.querySelector(".video-adjustments-panel")');
        await until(controlButton+'.textContent.includes("✓") && document.querySelector(".video-adjustments-panel").getBoundingClientRect().height > 100');
        const stored = await run('JSON.parse(localStorage.getItem("tblao.autoshort.videoAdjustments.v1"))');
        assert.deepEqual(stored, {zoom:112,brightness:5,saturation:95,contrast:103});
        win.setSize(1040, 820);
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await new Promise(resolve => setTimeout(resolve,200));
        const panelVisibility = await run('(() => {const panel=document.querySelector(".video-adjustments-panel");const rect=panel.getBoundingClientRect();const hit=document.elementFromPoint(Math.floor(rect.right-3),Math.floor(rect.top+20));return {left:rect.left,right:rect.right,viewport:innerWidth,rightEdgeVisible:panel.contains(hit)}})()');
        assert.ok(
          panelVisibility.left >= 16 && panelVisibility.right <= panelVisibility.viewport - 16 && panelVisibility.rightEdgeVisible,
          'adjustments panel must remain fully visible at the supported minimum window width: '+JSON.stringify(panelVisibility)
        );
        fs.writeFileSync(${JSON.stringify(join(evidence, 'autoshort-adjustments-panel.png'))}, (await win.webContents.capturePage()).toPNG());
        await run('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Bắt đầu chạy Auto Short")).click()');
        await until('!!window.startRequest');
        const submitted = await run('window.startRequest.config.videoAdjustments');
        assert.deepEqual(submitted, stored);
        await until(controlButton+'.disabled === true');
        assert.deepEqual(await run('window.fixtureErrors'), []);
        fs.writeFileSync(${JSON.stringify(join(evidence, 'video-adjustments-results.json'))}, JSON.stringify({
          passed:true,
          typed,
          stored,
          submitted,
          subtitleDragPixels,
          panelVisibility,
          disabledWhileRunning:true
        },null,2));
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  `
  const entry = join(root, 'main.cjs')
  await writeFile(entry, main)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [entry], {
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60000
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  console.log(await readFile(join(evidence, 'video-adjustments-results.json'), 'utf8'))
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'tedia-video-adjustments-preview-')))
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
