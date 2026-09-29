import { build } from 'esbuild'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const repo = process.cwd()
const work = await mkdtemp(join(tmpdir(), 'tedia-effects-ui-'))
const evidence = join(repo, '.ai/tasks/2026-09-28-video-effects')
await mkdir(evidence, { recursive: true })
try {
  await build({ stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import Control from './src/renderer/src/components/VideoEffectsControl';
    import Preview from './src/renderer/src/components/VideoEffectsPreview';
    import './src/renderer/src/styles.css';
    function Fixture() {
      const [value, setValue] = useState([]);
      const [disabled, setDisabled] = useState(false);
      return <main style={{padding:24}}><h2>AutoShort · Hiệu ứng video</h2>
        <Control value={value} onChange={setValue} disabled={disabled} />
        <button id="running" onClick={() => setDisabled(!disabled)}>Toggle running</button>
        <div style={{position:'relative',marginTop:24,width:440,height:650,overflow:'hidden',borderRadius:12,background:'linear-gradient(#285567,#a5b49d 65%,#315060)'}}>
          <div style={{position:'absolute',inset:'40% -10% -10%',background:'#345b67',clipPath:'polygon(0 70%,35% 5%,60% 50%,80% 20%,100% 80%,100% 100%,0 100%)'}} />
          <Preview effects={value} width={440} height={650} />
          <p style={{position:'absolute',bottom:28,left:24,fontSize:20,color:'white'}}>Khung minh họa hiệu ứng</p>
        </div>
        <output id="state" hidden>{JSON.stringify(value)}</output>
      </main>
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `, resolveDir: repo, loader: 'tsx' }, bundle: true, jsx: 'automatic', format: 'iife', outfile: join(work, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } })
  const appHtml = await readFile(join(repo, 'src/renderer/index.html'), 'utf8')
  const csp = appHtml.match(/content="(default-src[^"]+)"/)[1]
  await writeFile(join(work, 'index.html'), `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>`)
  await writeFile(join(work, 'main.cjs'), `
    const {app,BrowserWindow}=require('electron');
    const {writeFileSync}=require('fs');const {join}=require('path');const assert=require('assert/strict');
    app.setPath('userData',join(__dirname,'profile'));app.disableHardwareAcceleration();
    app.whenReady().then(async()=>{
      const w=new BrowserWindow({show:false,width:1050,height:1000,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false}});
      const js=code=>w.webContents.executeJavaScript(code);
      const wait=async(code)=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('UI wait timed out: '+code)};
      const click=async(text)=>js('Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()==='+JSON.stringify(text)+').click()');
      await w.loadFile(join(__dirname,'index.html'));
      await wait('!!document.querySelector(".video-effects-control button")');
      await click('Hiệu ứng');
      for(const label of ['Nhiễu hạt','Bụi phim','Nhiễu analog']) await click(label);
      await wait('document.querySelectorAll(".video-effect-layer").length===3');
      let state=JSON.parse(await js('document.getElementById("state").textContent'));
      assert.deepEqual(state.map(x=>x.kind),['grain','dust','analog']);
      await js('(()=>{const e=document.querySelector("input[type=range]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"72");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await wait('JSON.parse(document.getElementById("state").textContent)[0].intensity===72');
      await js('document.querySelectorAll(".video-effect-layer")[2].querySelector("button").click()');
      await wait('JSON.parse(document.getElementById("state").textContent)[1].kind==="analog"');
      assert.ok(await js('Array.from(document.querySelectorAll("canvas")).some(c=>Array.from(c.getContext("2d").getImageData(0,0,c.width,c.height).data).some((v,i)=>i%4===3&&v>0))'));
      const panel=await js('(()=>{const r=document.querySelector(".video-effects-panel").getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
      assert.ok(panel.x>=0&&panel.right<=panel.width&&panel.bottom<=panel.height);
      writeFileSync(${JSON.stringify(join(evidence, 'effects-ui.png'))},(await w.webContents.capturePage()).toPNG());
      await click('Bỏ lớp');
      await wait('document.querySelectorAll(".video-effect-layer").length===2');
      await click('Tắt toàn bộ hiệu ứng');
      await wait('JSON.parse(document.getElementById("state").textContent).length===0');
      await click('Nhiễu hạt');
      await js('document.getElementById("running").click()');
      await wait('document.querySelector(".video-effects-control button").disabled&&!document.querySelector(".video-effects-panel")');
      console.log('PASS effects UI: select/stack, intensity, reorder, visible preview, panel containment, remove/reset, running lock');
      w.destroy();app.exit(0);
    }).catch(e=>{console.error(e);app.exit(1)});
    setTimeout(()=>{console.error('UI smoke timeout');app.exit(1)},20000).unref();
  `)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [join(work, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' })
    child.on('error', reject); child.on('exit', resolve)
  })
  if (code !== 0) throw new Error(`Effects UI smoke exited ${code}`)
} finally {
  const rel = relative(tmpdir(), resolve(work))
  if (!rel.startsWith('tedia-effects-ui-') || rel.includes('..')) throw new Error('Unsafe smoke cleanup path')
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
