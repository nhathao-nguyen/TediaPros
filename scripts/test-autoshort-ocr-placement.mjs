import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = await mkdtemp(join(tmpdir(), 'tedia-autoshort-ocr-placement-'))
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(
  process.env.APPDATA || '',
  'tedia-pros',
  'bin',
  'ffmpeg',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)

try {
  const source = join(root, 'portrait.mp4')
  const generated = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=360x640:r=10:d=1',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source
  ], { windowsHide: true })
  assert.equal(generated.status, 0, generated.stderr?.toString())

  const renderer = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import AutoShort from './src/renderer/src/components/AutoShort';
    import './src/renderer/src/styles.css';
    const source = ${JSON.stringify(source)};
    localStorage.setItem('tblao.autoshort.tasks', JSON.stringify([
      {id:'a',filePath:source,fileName:${JSON.stringify(basename(source))},status:'pending',percent:0}
    ]));
    localStorage.setItem('tblao.autoshort.method', JSON.stringify('ocr'));
    localStorage.setItem('tblao.autoshort.blurMode', JSON.stringify('ocr-auto'));
    localStorage.setItem('tblao.autoshort.ttsEnabled', JSON.stringify(false));
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
    createRoot(document.getElementById('root')).render(<AutoShort />);
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
  await writeFile(join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="renderer.js"></script>')

  const main = `
    const {app,BrowserWindow,protocol} = require('electron');
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'tblao',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
    app.whenReady().then(async () => {
      const bytes = fs.readFileSync(${JSON.stringify(source)});
      protocol.handle('tblao', request => {
        const encoded = new URL(request.url).pathname.replace(/^\\//,'');
        const padded = encoded.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-encoded.length%4)%4);
        const path = Buffer.from(padded,'base64').toString('utf8');
        if (path !== ${JSON.stringify(source)}) return new Response('Not found',{status:404});
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
      const findButton = label => 'Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes('+JSON.stringify(label)+'))';
      const placementInput = 'Array.from(document.querySelectorAll(".subtitle-layout-card")).find(card=>card.querySelector("strong")?.textContent.includes("Tự đặt vị trí theo OCR"))?.querySelector("input[type=checkbox]")';
      try {
        await win.loadFile(${JSON.stringify(join(root, 'index.html'))});
        await until('document.querySelector("video")?.videoWidth===360 && !!('+placementInput+')');
        assert.equal(await run('('+placementInput+').disabled'),false);
        await run('('+placementInput+').click()');
        assert.equal(await run('('+placementInput+').checked'),true);
        await run(findButton('Bắt đầu chạy Auto Short')+'.click()');
        await until('window.startRequests.length===1');
        await run(findButton('Làm mờ')+'.click()');
        await until('!!document.querySelector("input[name=autoshort-blur-mode][value=manual]")');
        await run('document.querySelector("input[name=autoshort-blur-mode][value=manual]").click()');
        await run(findButton('Phụ đề')+'.click()');
        await until('!!('+placementInput+') && ('+placementInput+').disabled');
        await run(findButton('Bắt đầu chạy Auto Short')+'.click()');
        await until('window.startRequests.length===2');
        const result = await run('({modes:window.startRequests.map(request=>request.config.subtitlePlacementMode),ocrRegions:window.startRequests.map(request=>request.config.ocrRegion),stored:JSON.parse(localStorage.getItem("tblao.autoshort.subtitlePlacementMode")),errors:window.fixtureErrors})');
        assert.deepEqual(result.modes,['ocr-dominant','manual']);
        assert.deepEqual(result.ocrRegions[0],result.ocrRegions[1]);
        assert.equal(result.stored,'ocr-dominant');
        assert.deepEqual(result.errors,[]);
        console.log(JSON.stringify(result,null,2));
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
  process.stdout.write(result.stdout)
} finally {
  assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'tedia-autoshort-ocr-placement-')))
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
