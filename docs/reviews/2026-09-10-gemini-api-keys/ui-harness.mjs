// Offline UI smoke harness: actual React component and CSS, fake in-memory IPC only.
// Run from the repository root: node docs/reviews/2026-09-10-gemini-api-keys/ui-harness.mjs
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const result = await build({
  stdin: { contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import GeminiKeys from './src/renderer/src/components/GeminiKeys';
    let keys = [], unreadable = new URLSearchParams(location.search).has('broken');
    const list = () => unreadable ? {ok:false,error:'Không thể đọc danh sách khóa Gemini.',code:'storage-unreadable'}
      : {ok:true,keys:keys.map((key,i)=>({id:key,masked:'Khóa '+(i+1)+' · ••••'+key.slice(-4)}))};
    window.api = {
      geminiListKeys: async()=>list(),
      geminiAddKeys: async(value)=>{ keys=[...new Set([...keys,...value.split('\\n').filter(Boolean)])]; return list(); },
      geminiRemoveKey: async(id)=>{ keys=keys.filter(key=>key!==id); return list(); },
      geminiReplaceKeys: async(value)=>{unreadable=false; keys=value.split('\\n').filter(Boolean); return list();},
      geminiCheckKey: async()=>({ok:true,message:'Kết nối giả lập thành công.'})
    };
    function Panel({title}) {const [has,setHas]=useState(false); return <section className="card" style={{padding:20,margin:16,width:420}}>
      <h2>{title}</h2><p>Trạng thái: {has?'Có khóa':'Chưa có khóa'}</p><GeminiKeys onChanged={setHas}/></section>}
    createRoot(document.getElementById('root')).render(<main style={{display:'flex',flexWrap:'wrap'}}>
      <Panel title="Dịch phụ đề"/><Panel title="Tạo tiêu đề"/></main>);
  `, resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, platform: 'browser', jsx: 'automatic'
})
const script = result.outputFiles[0].text
const base = (await Promise.all(['base', 'audiotext'].map(name => readFile(resolve(`src/renderer/src/styles/${name}.css`), 'utf8')))).join('\n')
const server = createServer((req, res) => {
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(script); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>Gemini keys — offline smoke</title><style>'+base+'body{overflow:auto}</style><div id="root"></div><script src="/app.js"></script></html>')
})
server.listen(0, '127.0.0.1', () => console.log('UI_SMOKE_URL=http://127.0.0.1:'+server.address().port))
