import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const evidence = dirname(fileURLToPath(import.meta.url)), ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || 'ffmpeg'
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe'), work = await mkdtemp(join(tmpdir(), 'tedia-balanced-benchmark-'))
const root = join(process.env.LOCALAPPDATA, 'CapCut/User Data/Cache/effect/7399469641170554117/53ff3188476c74715a73aa34f08a1edf')
const selected = process.argv[2] || 'motion'
assert.ok(['motion', 'static', 'grain'].includes(selected))
await mkdir(evidence, { recursive: true })
try {
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
   import {spawnSync} from 'node:child_process';import {stat,writeFile,copyFile,readdir} from 'node:fs/promises';import {join} from 'node:path';import assert from 'node:assert/strict';
   import {synthesizeCapCutTextureLayers} from './src/main/capcutTextureLayers';import {planVideoEffectInputs} from './src/main/videoEffects';
   import {probeBurnMedia,taoFilterComplex,burnAutoShort} from './src/main/burn';import {planBalancedVideoExport,balancedVideoEncoderCandidates} from './src/main/videoExportPolicy';
   (async()=>{const ff=${JSON.stringify(ffmpeg)},fp=${JSON.stringify(ffprobe)},work=${JSON.stringify(work)},evidence=${JSON.stringify(evidence)};
    const run=(args,info=false)=>{const r=spawnSync(ff,['-hide_banner','-y','-v',info?'info':'error',...args],{windowsHide:true,timeout:45000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.error?.message||r.stderr.toString());return r;};
    const layers=(await synthesizeCapCutTextureLayers(${JSON.stringify(root)},join(work,'textures'),ff))!;
    const results=[];
    for(const [name,filter,kind] of [
      ['motion','testsrc2=s=720x1280:r=24:d=4','texture'],
      ['static','testsrc=s=720x1280:r=24:d=4','texture'],
      ['grain','testsrc2=s=720x1280:r=24:d=4','grain']].filter(c=>c[0]===${JSON.stringify(selected)})){
      const source=join(work,name+'-source.mp4'),reference=join(work,name+'-reference.mp4');
      run(['-f','lavfi','-i',filter,'-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-crf','28','-preset','fast','-pix_fmt','yuv420p','-c:a','aac',source]);
      const meta=await probeBurnMedia(source,ff);const effects=kind==='texture'?[{kind:'custom_overlay',assetPath:layers[0].assetPath,layers,intensity:50,sourceType:'custom'}]:[{kind:'grain',intensity:35}];
      const inputs=planVideoEffectInputs(effects,1),graph=taoFilterComplex(meta,[],false,false,'',false,false,100,null,false,undefined,undefined,effects,false,false,inputs.mappings);
      const legacyEffects=effects.map(effect=>({...effect,...(effect.layers?{layers:effect.layers.map(({isStatic,...layer})=>layer)}:{})}));
      const legacyInputs=planVideoEffectInputs(legacyEffects,1),legacyGraph=taoFilterComplex(meta,[],false,false,'',false,false,100,null,false,undefined,undefined,legacyEffects,false,false,legacyInputs.mappings);
      run(['-i',source,...inputs.inputArgs,...graph,'-c:v','libx264','-crf','0','-preset','ultrafast','-pix_fmt','yuv420p','-an',reference]);
      const plan=planBalancedVideoExport({width:meta.w,height:meta.h,sourceWidth:meta.w,sourceHeight:meta.h,frameRate:meta.frameRate,averageFrameRate:meta.averageFrameRate,videoBitrate:meta.videoBitrate,videoCodec:meta.videoCodec,effects});
      const oldGpu=['-c:v','h264_nvenc','-pix_fmt','yuv420p','-preset','p4','-cq','23','-g','60','-spatial-aq','1'];
      const oldCpu=['-c:v','libx264','-pix_fmt','yuv420p','-preset','faster','-crf','21'];
      const policies=balancedVideoEncoderCandidates(plan,'win32');const row={name,sourceBytes:(await stat(source)).size,sourceVideoBitrate:meta.videoBitrate,plan,renders:[]};
      for(const [encoder,oldArgs,newArgs] of [['nvenc',oldGpu,policies.find(c=>c.ten==='h264_nvenc').args],['cpu',oldCpu,policies.find(c=>c.ten==='libx264').args]]){
       for(const [version,args] of [['old',oldArgs],['balanced',newArgs]]){
        const timings=[],output=join(work,name+'-'+encoder+'-'+version+'.mp4');
        const activeInputs=version==='old'?legacyInputs:inputs,activeGraph=version==='old'?legacyGraph:graph;
        for(let i=0;i<3;i++){const start=performance.now();run(['-i',source,...activeInputs.inputArgs,...activeGraph,...args,'-c:a','copy','-movflags','+faststart',output]);timings.push(performance.now()-start);}
        const comparison=run(['-i',output,'-i',reference,'-filter_complex','[0:v][1:v]ssim','-an','-f','null','NUL'],true);
        const ssim=Number(comparison.stderr.toString().match(/All:([\\d.]+)/)?.[1]);assert.ok(Number.isFinite(ssim));
        const medianMs=timings.sort((a,b)=>a-b)[1];row.renders.push({encoder,version,medianMs,bytes:(await stat(output)).size,ssim});
        if(name==='motion'&&encoder==='nvenc'&&version==='balanced')await copyFile(output,join(evidence,'balanced-motion.mp4'));
       }
       const old=row.renders.find(r=>r.encoder===encoder&&r.version==='old'),next=row.renders.find(r=>r.encoder===encoder&&r.version==='balanced');
       next.sizeReductionPct=100*(1-next.bytes/old.bytes);next.timeChangePct=100*(next.medianMs/old.medianMs-1);
       assert.ok(next.ssim>=old.ssim-.005,'The balanced policy must preserve baseline quality rather than merely make a smaller file');
      }
      const production=join(work,name+'-production.mp4');const result=await burnAutoShort({video:source,mode:'burn'},
       {videoEffects:effects,ffmpegPath:ff,ffprobePath:fp,finalOutputPath:production,itemWorkDir:work,signal:new AbortController().signal,
        expectedMedia:{durationSeconds:4,frameRate:24,requireAudio:true,durationToleranceFrames:3}},()=>{});assert.equal(result.ok,true,JSON.stringify(result));
      const p=spawnSync(fp,['-v','error','-show_streams','-show_format','-of','json',production],{windowsHide:true,encoding:'utf8'});assert.equal(p.status,0);
      const media=JSON.parse(p.stdout),video=media.streams.find(s=>s.codec_type==='video');assert.equal(Number(video.nb_frames),96);assert.ok(media.streams.some(s=>s.codec_type==='audio'));
      assert.ok(Math.abs(Number(media.format.duration)-4)<.1);run(['-i',production,'-f','null','NUL']);
      row.production={frames:96,durationSeconds:Number(media.format.duration),hasAudio:true,fullyDecoded:true,bytes:(await stat(production)).size};
      results.push(row);console.log(JSON.stringify(row));
      await writeFile(join(evidence,${JSON.stringify(`pipeline-${selected}.json`)}),JSON.stringify(results,null,2));
    }
    assert.ok(!(await readdir(work)).some(name=>name.startsWith('tedia-burn-')));
   })().catch(e=>{console.error(e);process.exitCode=1});`
  }, bundle: true, platform: 'node', format: 'cjs', outfile: join(work, 'benchmark.cjs'), plugins: [{ name: 'electron-fixture', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `module.exports={app:{getPath:()=>${JSON.stringify(join(work, 'profile'))},getAppPath:()=>process.cwd(),getVersion:()=> '0.1.36',isPackaged:false},BrowserWindow:class{}}`, loader: 'js' }))
  } }] })
  const r = spawnSync(process.execPath, [join(work, 'benchmark.cjs')], { windowsHide: true, timeout: 60000, encoding: 'utf8' })
  await writeFile(join(evidence, `pipeline-${selected}.log`), r.stdout + r.stderr)
  assert.equal(r.status, 0, r.error?.message || r.stdout + r.stderr)
  console.log(await readFile(join(evidence, `pipeline-${selected}.json`), 'utf8'))
} finally {
  assert.ok(relative(tmpdir(), work).startsWith('tedia-balanced-benchmark-'))
  await rm(work, { recursive: true, force: true })
}
