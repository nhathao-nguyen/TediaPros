import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const jsx = `
import React, { useState, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Panel from './src/renderer/src/components/AutoShortCutPanel';
function App() {
  const [open, setOpen] = useState(true);
  const [edit, setEdit] = useState(undefined);
  const [measure, setMeasure] = useState({});
  useLayoutEffect(() => {
    const metrics = {};
    for (const sel of ['.editor-canvas-panel','.editor-stage-head','.autoshort-cut-panel','.editor-stage-shell','.cue-rail']) {
      const el = document.querySelector(sel);
      if (el) { const r = el.getBoundingClientRect(); metrics[sel] = {width:r.width, height:r.height, y:r.y, scrollHeight:el.scrollHeight}; }
    }
    setMeasure(metrics);
  }, [open, edit]);
  return <>
    <div className="video-editor autoshort-page" style={{display:'block',padding:0,width:696,height:596}}>
      <section className={'editor-canvas-panel'+(open?' has-cut-panel':'')} style={{width:'100%',height:'100%'}}>
        <div className="editor-stage-head"><div><span className="editor-eyebrow">BẢN XEM TRƯỚC</span><span className="editor-timecode">0:00 / 0:35</span></div>
          <div className="editor-preview-actions"><button className={'btn sm '+(open?'primary':'ghost')} onClick={()=>setOpen(v=>!v)}>Cắt đoạn</button><button className="btn sm primary">9:16 · Nền mờ</button><button className="btn sm primary">Chỉnh hình ảnh</button><select aria-label="Video mẫu"><option>1. Video tổng hợp.mp4</option></select><button className="btn sm primary">+ Thêm video</button><button className="btn sm ghost">Xóa</button></div>
        </div>
        <div className="editor-stage-shell"><span style={{color:'#fff',fontSize:12}}>Vùng video — đo kích thước layout</span></div>
        <div className="cue-rail" style={{height:48,padding:10}}>Play · 0:00 ────────────────── 0:35</div>
        {open && <Panel durationSeconds={35} currentTimeSeconds={0} edit={edit} onChange={setEdit} onSeek={()=>{}}/>}
      </section>
    </div>
    <pre aria-label="Số đo layout">{JSON.stringify(measure,null,2)}</pre>
    <pre aria-label="Bản cắt đã áp dụng">{JSON.stringify(edit||null,null,2)}</pre>
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);`
const bundle = await build({ stdin: { contents: jsx, loader: 'tsx', resolveDir: root }, bundle: true, platform: 'browser', format: 'iife', jsx:'automatic', write: false })
const css = ['src/renderer/src/styles/base.css','src/renderer/src/styles/editor.css','src/renderer/src/styles/autoshort.css','src/renderer/src/components/PortraitFramePreview.css']
  .map(path => readFileSync(resolve(root, path), 'utf8')).join('\n')
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>AutoShort cut repair harness</title><style>${css}\nbody {overflow:auto;padding:12px;} pre {font-size:12px;user-select:text;}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`
const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents)}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}
  else {res.statusCode=404;res.end()}
})
server.listen(0,'127.0.0.1',()=>console.log('REPAIR_URL=http://127.0.0.1:'+server.address().port))
process.on('SIGINT',()=>server.close(()=>process.exit(0)))
