import { createRequire } from 'node:module';
import Module from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json');
const {build}=require('esbuild');
const entry=`export { rephraseDubbingCues, rephraseDubbingCue } from './src/main/autoshort'; export { getGlobalResourceManager } from './src/main/autoShortResourceManager';`;
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'electron-mock',setup(b){b.onResolve({filter:/^electron$/},a=>({path:a.path,namespace:'electron-mock'}));b.onLoad({filter:/.*/,namespace:'electron-mock'},()=>({contents:`const os=require('node:os');module.exports={app:{getPath:()=>os.tmpdir(),getAppPath:()=>process.cwd(),isPackaged:false,getName:()=> 'tedia-pros',getVersion:()=> '0.1.22'},safeStorage:{isEncryptionAvailable:()=>false,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},dialog:{},BrowserWindow:class{},ipcMain:{handle:()=>{},on:()=>{}},shell:{},protocol:{handle:()=>{}}};`,loader:'js'}));}}]});
const m=new Module(process.cwd()+'/review-memory.cjs');m.filename=process.cwd()+'/review-memory.cjs';m.paths=Module._nodeModulePaths(process.cwd());m._compile(result.outputFiles[0].text,m.filename);
const {rephraseDubbingCue,rephraseDubbingCues,getGlobalResourceManager}=m.exports;
const results=[];
for(const mode of ['previous-active-single','new-active-batch']){
 const manager=getGlobalResourceManager();let jsonStarted,releaseBody; const started=new Promise(r=>jsonStarted=r);const trace=[];
 globalThis.fetch=async()=>{
  const stream=new ReadableStream({start(controller){releaseBody=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({choices:[{message:{content:'[c1:1] Short line.'},finish_reason:'stop'}]})));controller.close();};}});
  const response=new Response(stream,{status:200,headers:{'Content-Type':'application/json'}});
  const readJson=response.json.bind(response);
  response.json=async()=>{trace.push('llm-body-start');jsonStarted();const data=await readJson();trace.push('llm-body-complete');return data;};
  return response;
 };
 const config={translateProvider:'local',translateServerUrl:'http://fixture.invalid'};
 const work=mode==='previous-active-single'?rephraseDubbingCue(config,'c1','A long sentence.',1,'en'):rephraseDubbingCues(config,[{cueId:'c1',currentText:'A long sentence.',targetDuration:1,measuredDuration:3,maxDuration:1.45}],'en');
 await started;
 const tts=manager.withLease(['server-inference'],undefined,async()=>{trace.push('competing-tts-enters')});
 await new Promise(r=>setImmediate(r));
 const whileLlmBodyPending=[...trace];
 releaseBody();await Promise.all([work,tts]);results.push({mode,whileLlmBodyPending,completedTrace:[...trace]});
}
assert.deepEqual(results[0].whileLlmBodyPending,['llm-body-start']);
assert.deepEqual(results[1].whileLlmBodyPending,['llm-body-start','competing-tts-enters']);
console.log(JSON.stringify({assertion:'REPRODUCED: active batch releases server-inference before complete response body',scope:'Real adapter/resource manager and Node Response, mocked fetch, no live server claim',results},null,2));
