import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const evidence = dirname(fileURLToPath(import.meta.url)), ff = process.env.TEDIAPROS_TEST_FFMPEG || 'ffmpeg'
const work = await mkdtemp(join(tmpdir(), 'tedia-filter-threads-'))
const selected = Number(process.argv[2] || 4)
assert.ok([0, 1, 2, 4, 8].includes(selected))
try {
  await mkdir(evidence, { recursive: true })
  await build({ stdin: { loader: 'ts', resolveDir: process.cwd(), contents: `
   import {spawnSync} from 'node:child_process';import {writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join} from 'node:path';import assert from 'node:assert/strict';
   import {synthesizeCapCutTextureLayers} from './src/main/capcutTextureLayers';import {planVideoEffectInputs} from './src/main/videoEffects';import {probeBurnMedia,taoFilterComplex} from './src/main/burn';
   import {planBalancedVideoExport,balancedVideoEncoderCandidates} from './src/main/videoExportPolicy';
   (async()=>{const ff=${JSON.stringify(ff)},work=${JSON.stringify(work)};const run=args=>{const r=spawnSync(ff,['-v','error','-y',...args],{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.error?.message||r.stderr.toString());return r.stdout;};
    const source=join(work,'source.mp4');run(['-f','lavfi','-i','testsrc2=s=720x1280:r=24:d=4','-c:v','libx264','-crf','28','-preset','fast','-pix_fmt','yuv420p',source]);
    const root=${JSON.stringify(join(process.env.LOCALAPPDATA, 'CapCut/User Data/Cache/effect/7399469641170554117/53ff3188476c74715a73aa34f08a1edf'))};
    const layers=(await synthesizeCapCutTextureLayers(root,join(work,'textures'),ff))!;const effects=[{kind:'custom_overlay',assetPath:layers[0].assetPath,layers,intensity:50}];
    const meta=await probeBurnMedia(source,ff),inputs=planVideoEffectInputs(effects,1),graph=taoFilterComplex(meta,[],false,false,'',false,false,100,null,false,undefined,undefined,effects,false,false,inputs.mappings);
    const policy=planBalancedVideoExport({width:meta.w,height:meta.h,frameRate:24,videoBitrate:meta.videoBitrate,effects});const encoder=balancedVideoEncoderCandidates(policy,'win32').find(c=>c.ten==='h264_nvenc').args;
    const results=[];let baseline;
    for(const threads of [${selected}]){
     const times=[];for(let i=0;i<3;i++){const start=performance.now();run(['-filter_complex_threads',String(threads),'-i',source,...inputs.inputArgs,...graph,...encoder,'-an','-f','null','NUL']);times.push(performance.now()-start);}
     const pixels=run(['-filter_complex_threads',String(threads),'-i',source,...inputs.inputArgs,...graph,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
     if(!baseline)baseline=pixels;assert.deepEqual(pixels,baseline,'Thread budget must retain first-frame RGB');
     results.push({threads,medianMs:times.sort((a,b)=>a-b)[1],pixelHash:createHash('sha256').update(pixels).digest('hex')});
    }await writeFile(${JSON.stringify(join(evidence, `filter-threads-${selected}.json`))},JSON.stringify(results,null,2));
   })().catch(e=>{console.error(e);process.exitCode=1});`
  }, bundle: true, platform: 'node', format: 'cjs', outfile: join(work, 'probe.cjs'), plugins: [{ name: 'electron-fixture', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `module.exports={app:{getPath:()=>${JSON.stringify(work)},getAppPath:()=>process.cwd(),isPackaged:false,getVersion:()=> '0.1.36'},BrowserWindow:class{}}`, loader: 'js' }))
  } }] })
  const result = spawnSync(process.execPath, [join(work, 'probe.cjs')], { windowsHide: true, timeout: 60000, encoding: 'utf8' })
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
  console.log(await readFile(join(evidence, `filter-threads-${selected}.json`), 'utf8'))
} finally {
  assert.ok(relative(tmpdir(), work).startsWith('tedia-filter-threads-'))
  await rm(work, { recursive: true, force: true })
}
