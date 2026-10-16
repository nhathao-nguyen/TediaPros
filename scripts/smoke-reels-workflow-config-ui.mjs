import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url), repo = process.cwd()
const work = await mkdtemp(join(tmpdir(), 'tedia-workflow-ui-'))
const evidence = join(repo, '.ai/tasks/2026-10-13-daily-workflow-proof')
await mkdir(evidence, { recursive: true })
try {
  await build({ stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import AutoShort from './src/renderer/src/components/AutoShort';
    import './src/renderer/src/styles.css';
    window.proof = { snapshots: [], starts: 0, errors: [] };
    window.addEventListener('error', e => window.proof.errors.push(e.message));
    window.addEventListener('unhandledrejection', e => window.proof.errors.push(String(e.reason)));
    window.api = new Proxy({}, { get(_object, key) {
      if (key === 'autoShortSaveWorkflowConfig') return async (config, error) => { window.proof.snapshots.push({ config, error }); return { ok: true } };
      if (key === 'autoShortStart') return async () => { window.proof.starts++; return { ok: false } };
      if (key === 'listBurnFonts') return async () => [];
      if (key === 'downloadsDir') return async () => 'C:\\\\media\\\\output';
      if (key === 'translateHasKey') return async () => false;
      if (String(key).startsWith('on')) return () => () => {};
      return async () => ({ ok: false, message: 'UI fixture', models: [], voices: [], tracks: [], dependencies: [] });
    }});
    localStorage.setItem('tblao.autoshort.transLang', JSON.stringify('vi'));
    function Fixture() {
      const [visible, setVisible] = useState(true);
      return <><button id="mount" onClick={() => setVisible(v => !v)}>Toggle tab</button>{visible && <AutoShort />}</>;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  `, resolveDir: repo, loader: 'tsx' }, bundle: true, jsx: 'automatic', format: 'iife', outfile: join(work, 'ui.js'), define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(work, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>')
  await writeFile(join(work, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const { writeFileSync } = require('fs'); const { join } = require('path'); const assert = require('assert/strict');
    app.setPath('userData', join(__dirname, 'profile')); app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
      const w = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } });
      w.webContents.on('console-message', (_event, level, text) => { if (level >= 2) console.error('renderer: ' + text); });
      const js = code => w.webContents.executeJavaScript(code);
      const wait = async code => { for (let i=0; i<150; i++) { if (await js(code)) return; await new Promise(r => setTimeout(r, 30)); } throw Error('UI wait timed out: ' + code + '\\n' + JSON.stringify(await js('window.proof'))); };
      const clickTab = text => js('Array.from(document.querySelectorAll("button[role=tab]")).find(e=>e.textContent.trim()===' + JSON.stringify(text) + ').click()');
      await w.loadFile(join(__dirname, 'index.html'));
      await wait('window.proof.snapshots.length>0');
      await clickTab('Làm mờ');
      await js('document.querySelector(".editor-section-head .editor-switch input").click()');
      await wait('window.proof.snapshots.at(-1).config.lamMo===false');
      await clickTab('Lồng tiếng');
      await js('document.querySelector(".editor-section-head .editor-switch input").click()');
      await wait('window.proof.snapshots.at(-1).config.ttsEnabled===false');
      await clickTab('Phụ đề');
      await js('(()=>{const e=Array.from(document.querySelectorAll("select")).find(e=>Array.from(e.options).some(o=>o.value==="none")&&e.value==="vi");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"none");e.dispatchEvent(new Event("change",{bubbles:true}));})()');
      await wait('window.proof.snapshots.at(-1).config.translateTarget==="none"');
      await js('document.getElementById("mount").click()'); await wait('!document.querySelector(".autoshort-page")');
      await js('document.getElementById("mount").click()'); await wait('!!document.querySelector(".autoshort-page")');
      await wait('window.proof.snapshots.at(-1).config.ttsEnabled===false&&window.proof.snapshots.at(-1).config.lamMo===false&&window.proof.snapshots.at(-1).config.translateTarget==="none"');
      const proof = await js('window.proof'); assert.equal(proof.starts, 0); assert.deepEqual(proof.errors, []);
      writeFileSync(${JSON.stringify(join(evidence, 'config-ui-proof.json'))}, JSON.stringify({ starts: proof.starts, snapshotCount: proof.snapshots.length, final: { lamMo: proof.snapshots.at(-1).config.lamMo, ttsEnabled: proof.snapshots.at(-1).config.ttsEnabled, translateTarget: proof.snapshots.at(-1).config.translateTarget }, errors: proof.errors }, null, 2));
      writeFileSync(${JSON.stringify(join(evidence, 'config-ui.png'))}, (await w.webContents.capturePage()).toPNG());
      console.log('PASS workflow config UI: toggles sync without starting a job; off values survive tab remount');
      w.destroy(); app.exit(0);
    }).catch(error => { console.error(error); app.exit(1); });
    setTimeout(() => { console.error('UI timeout'); app.exit(1); }, 25000).unref();
  `)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const code = await new Promise((resolveCode, reject) => {
    const child = spawn(require('electron'), [join(work, 'main.cjs')], { env, windowsHide: true, stdio: 'inherit' })
    child.once('error', reject); child.once('exit', resolveCode)
  })
  if (code !== 0) throw Error(`Workflow UI smoke exited ${code}`)
} finally {
  const rel = relative(tmpdir(), resolve(work))
  if (!rel.startsWith('tedia-workflow-ui-') || rel.includes('..')) throw Error('Unsafe cleanup path')
  await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}
