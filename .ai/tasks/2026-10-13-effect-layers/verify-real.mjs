import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidence = dirname(fileURLToPath(import.meta.url)), ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || 'ffmpeg'
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe')
const packageRoot = process.env.TEDIAPROS_EFFECT_PACKAGE || join(process.env.LOCALAPPDATA, 'CapCut/User Data/Cache/effect/7399469641170554117/53ff3188476c74715a73aa34f08a1edf')
const work = await mkdtemp(join(tmpdir(), 'tedia-real-layers-'))
try {
  await mkdir(evidence, { recursive: true })
  const source = join(work, 'source.mp4'), output = join(work, 'output.mp4'), proofFile = join(work, 'proof.json')
  const run = args => {
    const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 45000, maxBuffer: 30 * 1024 * 1024 })
    assert.equal(r.status, 0, r.error?.message || r.stderr.toString()); return r.stdout
  }
  run(['-f', 'lavfi', '-i', 'color=0x202020:s=360x640:r=12:d=3,drawbox=x=0:y=180:w=360:h=120:c=0x3864A2:t=fill,drawbox=x=0:y=300:w=360:h=120:c=0xA23864:t=fill,drawbox=x=0:y=420:w=360:h=120:c=white:t=fill',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import {synthesizeCapCutTextureLayers,readCapCutTextureLayout} from './src/main/capcutTextureLayers';
    import {burnAutoShort} from './src/main/burn';import {compositeRgbTextures} from './src/shared/overlayCompositing';
    import {spawnSync} from 'node:child_process';import {writeFile,readdir,stat} from 'node:fs/promises';import assert from 'node:assert/strict';
    (async()=>{const root=${JSON.stringify(packageRoot)},cache=${JSON.stringify(join(work, 'assets'))},ff=${JSON.stringify(ffmpeg)};
      const start=performance.now();const layers=(await synthesizeCapCutTextureLayers(root,cache,ff))!;const coldMs=performance.now()-start;
      const warmStart=performance.now();assert.deepEqual(await synthesizeCapCutTextureLayers(root,cache,'missing-ffmpeg'),layers);const warmMs=performance.now()-warmStart;
      const layout=await readCapCutTextureLayout(root);assert.deepEqual(layers.map(l=>l.blendMode),['screen','multiply']);
      const renderStart=performance.now();const result=await burnAutoShort({video:${JSON.stringify(source)},mode:'burn'},
       {videoEffects:[{kind:'custom_overlay',assetPath:layers[0].assetPath,layers,intensity:75,name:'Nhiễu 2',sourceType:'custom'}],
        ffmpegPath:ff,ffprobePath:${JSON.stringify(ffprobe)},finalOutputPath:${JSON.stringify(output)},itemWorkDir:${JSON.stringify(work)},signal:new AbortController().signal,
        expectedMedia:{durationSeconds:3,frameRate:12,requireAudio:true,durationToleranceFrames:3}},()=>{});
      assert.equal(result.ok,true,JSON.stringify(result));const renderMs=performance.now()-renderStart;
      const decode=(path,scaled=false,all=false)=>{const args=['-v','error','-i',path,...(scaled?['-vf','scale=w=360:h=640:force_original_aspect_ratio=increase,crop=360:640']:[]),...(all?[]:['-frames:v','1']),'-pix_fmt','rgba','-f','rawvideo','pipe:1'];
       const r=spawnSync(ff,args,{windowsHide:true,maxBuffer:40*1024*1024,timeout:15000});assert.equal(r.status,0,r.stderr?.toString());return new Uint8ClampedArray(r.stdout);};
      const original=decode(${JSON.stringify(source)}),expected=new Uint8ClampedArray(original);
      const textures=layers.map(l=>({pixels:decode(l.assetPath,true),blendMode:l.blendMode}));compositeRgbTextures(expected,textures,75);
      const actual=decode(${JSON.stringify(output)},false,true);assert.equal(actual.length,36*360*640*4);const frame=actual.subarray(0,original.length);
      const regionErrors=[];for(const start of [40,220,340,440]){let delta=0,n=0;for(let y=start;y<start+40;y++)for(let x=150;x<210;x++){const p=(y*360+x)*4;for(let c=0;c<3;c++){delta+=Math.abs(frame[p+c]-expected[p+c]);n++;}}regionErrors.push(delta/n);}
      const meanError=Math.max(...regionErrors);assert.ok(meanError<=4,'Production RGB must match full two-pass reference on dark, blue, magenta and white regions');
      assert.notDeepEqual(actual.subarray(0,original.length),actual.subarray(original.length*6,original.length*7),'Dust must remain animated');
      const p=spawnSync(${JSON.stringify(ffprobe)},['-v','error','-show_streams','-show_format','-of','json',${JSON.stringify(output)}],{windowsHide:true,encoding:'utf8'});
      assert.equal(p.status,0);const media=JSON.parse(p.stdout),v=media.streams.find(s=>s.codec_type==='video');assert.equal(Number(v.nb_frames),36);
      assert.equal(v.width,360);assert.equal(v.height,640);assert.ok(media.streams.some(s=>s.codec_type==='audio'));
      assert.ok(!(await readdir(${JSON.stringify(work)})).some(name=>name.startsWith('burn-')||name.startsWith('tedia-burn-')));
      const proof={packageRoot:root,passes:layout?.map(l=>({mode:l.blendMode,frames:l.frames.length})),coldMs,warmMs,renderMs,meanError,regionErrors,
       frames:36,durationSeconds:Number(media.format.duration),hasAudio:true,animated:true,cacheReusedWithoutFfmpeg:true,
       cacheBytes:(await Promise.all(layers.map(l=>stat(l.assetPath)))).reduce((n,s)=>n+s.size,0)};
      await writeFile(${JSON.stringify(proofFile)},JSON.stringify(proof,null,2));
    })().catch(e=>{console.error(e);process.exitCode=1});`
  }, bundle: true, platform: 'node', format: 'cjs', outfile: join(work, 'verify.cjs'), plugins: [{ name: 'electron-fixture', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `module.exports={app:{getPath:()=>${JSON.stringify(join(work, 'profile'))},getAppPath:()=>process.cwd(),getVersion:()=> '0.1.36',isPackaged:false},BrowserWindow:class{}}`, loader: 'js' }))
  } }] })
  const r = spawnSync(process.execPath, [join(work, 'verify.cjs')], { windowsHide: true, encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, r.error?.message || r.stdout + r.stderr)
  run(['-i', output, '-f', 'null', 'NUL'])
  const oldScreen = join(process.cwd(), '.ai/tasks/2026-10-13-overlay-rgb-blend/after.mp4')
  run(['-ss', '0.5', '-i', source, '-ss', '0.5', '-i', oldScreen, '-ss', '0.5', '-i', output, '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3[out]', '-map', '[out]', '-frames:v', '1', join(evidence, 'real-comparison.png')])
  await copyFile(output, join(evidence, 'real-output.mp4'))
  await copyFile(proofFile, join(evidence, 'real-proof.json'))
  console.log(await readFile(proofFile, 'utf8'))
} finally {
  assert.ok(relative(tmpdir(), work).startsWith('tedia-real-layers-'))
  await rm(work, { recursive: true, force: true })
}
