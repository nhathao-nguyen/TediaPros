import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = await mkdtemp(join(tmpdir(), 'tedia-autoshort-region-resolution-'))
const evidence = resolve(process.argv[2] || 'docs/reviews/2026-09-11-region-resolution')
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(
  process.env.APPDATA || '',
  'tedia-pros',
  'bin',
  'ffmpeg',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)
const ffprobe = process.env.TEDIAPROS_TEST_FFPROBE || ffmpeg.replace(/ffmpeg(?:\.exe)?$/iu, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const suppliedSources = process.argv.slice(3, 5)

try {
  await mkdir(evidence, { recursive: true })
  const sourceA = suppliedSources[0] || join(root, 'portrait-360x640.mp4')
  const sourceB = suppliedSources[1] || join(root, 'portrait-720x1280.mp4')
  if (suppliedSources.length === 0) {
    for (const [output, size, color] of [[sourceA, '360x640', 'blue'], [sourceB, '720x1280', 'green']]) {
      const generated = spawnSync(ffmpeg, [
        '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:r=10:d=1`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', output
      ], { windowsHide: true })
      assert.equal(generated.status, 0, generated.stderr?.toString())
    }
  }
  assert.ok(sourceA && sourceB && sourceA !== sourceB, 'Provide either zero or two distinct video sources.')
  const probeDimensions = (source) => {
    const probed = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', source], { windowsHide: true, encoding: 'utf8' })
    assert.equal(probed.status, 0, probed.stderr)
    const stream = JSON.parse(probed.stdout).streams?.[0]
    assert.ok(stream?.width > 0 && stream?.height > 0, `Missing dimensions for ${source}`)
    return { width: stream.width, height: stream.height }
  }
  const dimensionsA = probeDimensions(sourceA)
  const dimensionsB = probeDimensions(sourceB)

  const renderer = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import AutoShort from './src/renderer/src/components/AutoShort';
    import './src/renderer/src/styles.css';
    const sourceA = ${JSON.stringify(sourceA)};
    const sourceB = ${JSON.stringify(sourceB)};
    localStorage.setItem('tblao.autoshort.tasks', JSON.stringify([
      {id:'a',filePath:sourceA,fileName:${JSON.stringify(basename(sourceA))},status:'pending',percent:0},
      {id:'b',filePath:sourceB,fileName:${JSON.stringify(basename(sourceB))},status:'pending',percent:0}
    ]));
    localStorage.setItem('tblao.autoshort.method', JSON.stringify('ocr'));
    localStorage.setItem('tblao.autoshort.fontSize', JSON.stringify(32));
    localStorage.setItem('tblao.autoshort.outlinePx', JSON.stringify(4));
    localStorage.setItem('tblao.outputDir.autoshort', JSON.stringify(${JSON.stringify(root)}));
    window.fixtureErrors = [];
    window.startRequests = [];
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
      loadBurnFontData: async () => ({ok:false}),
      autoShortStart: async request => {
        window.startRequests.push(request);
        return {ok:false,error:'Fixture captured request'};
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
      const media = new Map([
        [${JSON.stringify(sourceA)}, fs.readFileSync(${JSON.stringify(sourceA)})],
        [${JSON.stringify(sourceB)}, fs.readFileSync(${JSON.stringify(sourceB)})]
      ]);
      protocol.handle('tblao', request => {
        const encoded = new URL(request.url).pathname.replace(/^\\//,'');
        const padded = encoded.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-encoded.length%4)%4);
        const path = Buffer.from(padded,'base64').toString('utf8');
        const bytes = media.get(path);
        if (!bytes) return new Response('Not found',{status:404});
        const range = request.headers.get('range');
        const parts = range ? range.slice(6).split('-') : [];
        const start = parts.length ? Number(parts[0]) : 0;
        const end = parts[1] ? Math.min(Number(parts[1]),bytes.length-1) : bytes.length-1;
        const headers = {'Content-Type':'video/mp4','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*','Content-Length':String(end-start+1)};
        if(range) headers['Content-Range']='bytes '+start+'-'+end+'/'+bytes.length;
        return new Response(bytes.subarray(start,end+1),{status:range?206:200,headers});
      });
      const win = new BrowserWindow({show:false,width:1304,height:806,webPreferences:{backgroundThrottling:false}});
      const run = code => win.webContents.executeJavaScript(code,true);
      const until = async code => {
        for(let index=0;index<180;index++) {
          if(await run(code)) return;
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        throw Error('Timed out: '+code+' errors='+JSON.stringify(await run('window.fixtureErrors')));
      };
      const selectVideo = async (id,width,height) => {
        await run('(() => {const select=document.querySelector(".editor-preview-actions select");'+
          'Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(select,'+JSON.stringify(id)+');'+
          'select.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await until('document.querySelector("video").videoWidth==='+width+' && document.querySelector("video").videoHeight==='+height+' && !!document.querySelector(".rbox-sub")');
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      };
      const readLayout = () => run('(() => {'+
        'const layer=document.querySelector(".rbox-lop").getBoundingClientRect();'+
        'const ratio=element=>{const r=element.getBoundingClientRect();return {x:(r.left-layer.left)/layer.width,y:(r.top-layer.top)/layer.height,w:r.width/layer.width,h:r.height/layer.height}};'+
        'const blur=Array.from(document.querySelectorAll(".rbox")).find(element=>!element.classList.contains("rbox-sub")&&!element.classList.contains("rbox-ocr"));'+
        'const text=document.querySelector(".sub-sample-text");'+
        'return {sub:ratio(document.querySelector(".rbox-sub")),ocr:ratio(document.querySelector(".rbox-ocr")),blur:ratio(blur),font:parseFloat(getComputedStyle(text).fontSize),outline:getComputedStyle(text).textShadow};'+
      '})()');
      const closeEnough = (left,right,label) => {
        for(const key of ['x','y','w','h']) assert.ok(Math.abs(left[key]-right[key])<0.003,label+'.'+key+': '+JSON.stringify({left,right}));
      };
      try {
        await win.loadFile(${JSON.stringify(join(root, 'index.html'))});
        await until('document.querySelector("video")?.videoWidth===${dimensionsA.width} && document.querySelector("video")?.videoHeight===${dimensionsA.height} && !!document.querySelector(".rbox-ocr")');
        await until('JSON.parse(localStorage.getItem("tblao.autoshort.subtitleStyleScaleVersion"))===2');
        const migration = await run('({version:JSON.parse(localStorage.getItem("tblao.autoshort.subtitleStyleScaleVersion")),fontSize:JSON.parse(localStorage.getItem("tblao.autoshort.fontSize")),outlinePx:JSON.parse(localStorage.getItem("tblao.autoshort.outlinePx"))})');
        assert.equal(migration.version,2);
        assert.ok(Math.abs(migration.fontSize/1920-32/${dimensionsA.height})<0.0003,JSON.stringify(migration));
        assert.ok(Math.abs(migration.outlinePx/1920-4/${dimensionsA.height})<0.0003,JSON.stringify(migration));
        await run('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==="Làm mờ").click()');
        await until('!!Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("Thêm vùng làm mờ"))');
        await run('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("Thêm vùng làm mờ")).click()');
        await until('!!Array.from(document.querySelectorAll(".rbox")).find(element=>!element.classList.contains("rbox-sub")&&!element.classList.contains("rbox-ocr"))');
        const layoutA1 = await readLayout();
        await selectVideo('b',${dimensionsB.width},${dimensionsB.height});
        const layoutB = await readLayout();
        await selectVideo('a',${dimensionsA.width},${dimensionsA.height});
        const layoutA2 = await readLayout();
        for(const name of ['sub','ocr','blur']) {
          closeEnough(layoutA1[name],layoutB[name],name+' A-B');
          closeEnough(layoutA1[name],layoutA2[name],name+' A-B-A');
        }
        assert.ok(Math.abs(layoutA1.font-layoutB.font)<0.1,JSON.stringify({layoutA1,layoutB}));
        assert.equal(layoutA1.outline,layoutB.outline);
        const startButton = 'Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("Bắt đầu chạy Auto Short"))';
        await run(startButton+'.click()');
        await until('window.startRequests.length===1');
        await selectVideo('b',${dimensionsB.width},${dimensionsB.height});
        await run(startButton+'.click()');
        await until('window.startRequests.length===2');
        const payloads = await run('window.startRequests.map(request=>({subRegion:request.config.subRegion,ocrRegion:request.config.ocrRegion,blurRegions:request.config.blurRegions,subtitleFontScale:request.config.subtitleFontScale,outlineScale:request.config.outlineScale}))');
        assert.deepEqual(payloads[0],payloads[1]);
        assert.deepEqual(await run('window.fixtureErrors'),[]);
        fs.writeFileSync(${JSON.stringify(join(evidence, 'region-resolution.png'))},(await win.webContents.capturePage()).toPNG());
        const summarize = layout => ({...layout,outlineCount:layout.outline.split(',').length,outline:undefined});
        fs.writeFileSync(${JSON.stringify(join(evidence, 'region-resolution-results.json'))},JSON.stringify({passed:true,migration,layoutA1:summarize(layoutA1),layoutB:summarize(layoutB),layoutA2:summarize(layoutA2),payloads},null,2));
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
  console.log(await readFile(join(evidence, 'region-resolution-results.json'), 'utf8'))
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'tedia-autoshort-region-resolution-')))
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
