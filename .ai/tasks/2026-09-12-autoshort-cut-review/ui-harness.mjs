import { build } from 'esbuild'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const snapshot = path => {
  const r = spawnSync('git', ['show', `0d7fa21:${path}`], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 5e6 })
  if (r.status) throw new Error(r.stderr)
  return r.stdout
}
const jsx = `
import React, { useState, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Panel from './src/renderer/src/components/AutoShortCutPanel';
function App() {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(undefined);
  const [width, setWidth] = useState(696);
  const [measure, setMeasure] = useState({});
  useLayoutEffect(() => {
    const metrics = {};
    for (const sel of ['.editor-canvas-panel','.editor-stage-head','.autoshort-cut-panel','.editor-stage-shell','.editor-transport']) {
      const el = document.querySelector(sel);
      if (el) { const r = el.getBoundingClientRect(); metrics[sel] = {width:r.width, height:r.height, y:r.y, scrollHeight:el.scrollHeight}; }
    }
    setMeasure(metrics);
  }, [open, edit, width]);
  return <>
    <p>Audit harness · commit 0d7fa21 · component/CSS thật, shell cố định để đo layout · không phải app Electron đang chạy</p>
    <label>Chiều rộng panel <select value={width} onChange={e=>setWidth(Number(e.target.value))}><option value={696}>696 px</option><option value={1040}>1040 px</option><option value={440}>440 px</option></select></label>
    <div className="video-editor autoshort-page" style={{display:'block',padding:0,marginTop:12,width,height:596}}>
      <section className="editor-canvas-panel" style={{width:'100%',height:'100%'}}>
        <div className="editor-stage-head"><div><span className="editor-eyebrow">BẢN XEM TRƯỚC</span><span className="editor-timecode">0:00 / 0:35</span></div>
          <div className="editor-preview-actions"><button className={'btn sm '+(open?'primary':'ghost')} onClick={()=>setOpen(v=>!v)}>Cắt đoạn</button><button className="btn sm primary">9:16 · Nền mờ</button><button className="btn sm primary">Chỉnh hình ảnh</button><select aria-label="Video mẫu"><option>1. Video tổng hợp.mp4</option></select><button className="btn sm primary">+ Thêm video</button><button className="btn sm ghost">Xóa</button></div>
        </div>
        {open && <Panel durationSeconds={35} currentTimeSeconds={0} edit={edit} onChange={setEdit} onSeek={()=>{}}/>}
        <div className="editor-stage-shell"><span style={{color:'#fff',fontSize:12}}>Vùng video — đo kích thước layout</span></div>
        <div className="editor-transport" style={{height:48,padding:10}}>Play · 0:00 ────────────────── 0:35</div>
      </section>
    </div>
    <pre aria-label="Số đo layout">{JSON.stringify(measure,null,2)}</pre>
    <pre aria-label="Bản cắt đã áp dụng">{JSON.stringify(edit||null,null,2)}</pre>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = await build({ stdin: { contents: jsx, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx:'automatic', write: false, plugins:[{name:'commit-snapshot',setup(b){b.onLoad({filter:/\.(ts|tsx)$/},args=>{
  const path = relative(root,args.path).replaceAll('\\','/');
  if (!path.startsWith('src/')) return;
  return {contents:snapshot(path),loader:path.endsWith('tsx')?'tsx':'ts'};
})}}] });
const css = ['src/renderer/src/styles/base.css','src/renderer/src/styles/editor.css','src/renderer/src/styles/autoshort.css','src/renderer/src/components/PortraitFramePreview.css'].map(snapshot).join('\n');
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>AutoShort cut review harness</title><style>${css}\nbody {overflow:auto;padding:12px;} p,pre {font-size:12px;} pre {user-select:text;}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;
const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
  else {res.statusCode=404;res.end();}
});
server.listen(0,'127.0.0.1',()=>console.log('REVIEW_URL=http://127.0.0.1:'+server.address().port));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
