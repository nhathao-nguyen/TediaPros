import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const out = resolve('.ai/tasks/2026-09-14-gateway-root-cause')
await mkdir(out, { recursive: true })
await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import {readFileSync,writeFileSync} from 'node:fs'
import {createGeminiGatewayTranslationAdapter} from './src/main/geminiGateway'
import {planTranslation} from './src/main/translation/planner'
const cp=JSON.parse(readFileSync(process.argv[2],'utf8'))
const out=process.argv[3]
const adapter=createGeminiGatewayTranslationAdapter()
const input={sourceLanguage:cp.detectedSourceLanguage||'zh',targetLocale:'vi-VN',mode:'dubbing',
 cues:cp.sourceCues.map((c,i)=>({id:c.id,sourceIndex:i,start:c.start,end:c.end,text:c.text,groupId:'cue-'+i})),
 contextBefore:[],contextAfter:[],glossary:[]}
const plan=planTranslation(input,adapter.capability)
globalThis.fetch=async(url,init)=>{
 const request=JSON.parse(init.body)
 writeFileSync(out+'/request.json',JSON.stringify(request,null,2))
 let prompt=request.messages.map(m=>(m.role==='system'?'System':'User')+': '+m.content+'\\n').join('').trim()
 prompt+='\\n\\n[RESPONSE_FORMAT]\\nThe gateway cannot enforce native constrained decoding. Follow this JSON response contract exactly and output no Markdown or prose:\\n'+JSON.stringify(request.response_format)+'\\n[/RESPONSE_FORMAT]'
 prompt='Output token ceiling: about '+request.max_tokens+" tokens. Treat this as a maximum response budget; do not exceed it, but use enough of it to satisfy the user's requested length.\\n\\n"+prompt
 writeFileSync(out+'/prompt.txt',prompt)
 console.log(JSON.stringify({sourceCues:input.cues.length,batches:plan.batches.length,promptBytes:Buffer.byteLength(prompt),maxTokens:request.max_tokens}))
 throw new Error('Offline capture only')
}
adapter.requestOnce(plan.batches[0],new AbortController().signal).catch(()=>{})
` }, bundle:true,platform:'node',format:'cjs',outfile:out+'/capture.cjs',logLevel:'silent', plugins:[{name:'mock-electron',setup(b){b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'mock'})); b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:"module.exports={app:{getPath:()=>require('node:os').tmpdir()}}",loader:'js'}))}}] })
