// Exercise unchanged main-process functions with a synthetic engine boundary.
import { build } from 'esbuild'
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const fixture = await mkdtemp(resolve('docs/reviews/2026-09-07-system-review/evidence/standalone-fixture-'))
globalThis.__reviewFixture = fixture
const mocks = {
  electron: 'export const app = { getPath: () => globalThis.__reviewFixture, isPackaged: false };',
  './runtimeResolver': 'export const resolveRuntimeExecutable = async () => "fixture-engine"; export const runtimeKindDir = () => globalThis.__reviewFixture;',
  './runtimeProbes': 'export const probeRuntimeExecutable = async () => ({healthy:true,features:[]});',
  './deps': 'export const resolveFfmpeg = async () => "fixture-ffmpeg";',
  './logger': 'export const debugRaw=()=>{}; export const logInfo=()=>{}; export const logError=()=>{}; export const logWarn=()=>{}; export const errLabel=e=>String(e);',
  './processTree': 'export const trackChildProcess=p=>p; export const terminateProcessTree=()=>{};',
  './douyinCookies': 'export const readDyCookies=async()=>({});',
  './runtimeInstaller': 'export const downloadRuntimeEngineFromManifest=async()=>false;',
  'node:child_process': `
    import { EventEmitter } from 'node:events';
    import { PassThrough } from 'node:stream';
    export function spawn() {
      const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
      const scenario = globalThis.__reviewScenario;
      setImmediate(() => {
        if (scenario.stdout) p.stdout.write(scenario.stdout);
        if (scenario.stderr) p.stderr.write(scenario.stderr);
        p.stdout.end(); p.stderr.end(); p.emit('close', 0);
      });
      return p;
    }`
}
async function currentModule(entry) {
  const result = await build({entryPoints:[resolve(entry)],bundle:true,platform:'node',format:'esm',write:false,
    plugins:[{name:'engine-boundary-fixture',setup(b){
      b.onResolve({filter:/.*/}, a => Object.hasOwn(mocks,a.path) ? {path:a.path,namespace:'review-mock'} : undefined);
      b.onLoad({filter:/.*/,namespace:'review-mock'}, a=>({contents:mocks[a.path],loader:'js'}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const ocr = await currentModule('src/main/ocr.ts');
for (const type of ['missing','empty']) {
  const output = join(fixture,`${type}.srt`);
  if(type==='empty') await writeFile(output,'');
  globalThis.__reviewScenario={stdout:JSON.stringify({type:'done',output,count:1})+'\n'};
  const result=await ocr.ocrVideo(join(fixture,'input.mp4'),fixture,0,100,0,100,['.srt'],()=>{});
  assert.equal(result.ok,true);
  console.log(JSON.stringify({finding:'standalone-ocr-invalid-output',fixture:type,ok:result.ok,exists:await access(output).then(()=>true,()=>false)}));
}
const dy=await currentModule('src/main/douyin.ts');
const summary='Total │ 3\nSuccess │ 1\nFailed │ 1\nSkipped │ 1\n';
const req={url:'https://www.douyin.com/video/fixture',outputDir:fixture,isChannel:false,mode:'all',music:false,cover:false,avatar:false,metaJson:false,folderstyle:true};
globalThis.__reviewScenario={stdout:summary};
const fromOut=await dy.downloadDouyin('stdout',req,()=>{});
globalThis.__reviewScenario={stderr:summary};
const fromErr=await dy.downloadDouyin('stderr',req,()=>{});
assert.equal(fromOut.total,0); assert.equal(fromOut.failed,0); assert.equal(fromErr.total,3); assert.equal(fromErr.failed,1);
console.log(JSON.stringify({finding:'douyin-stdout-dropped',stdout:{total:fromOut.total,failed:fromOut.failed,ok:fromOut.ok},stderrControl:{total:fromErr.total,failed:fromErr.failed}}));
