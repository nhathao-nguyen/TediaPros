import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const evidence = dirname(fileURLToPath(import.meta.url))
const temp = await mkdtemp(join(tmpdir(), 'tedia-review-portrait-'))
const ff = join(process.env.APPDATA, 'tedia-pros/bin/ffmpeg/ffmpeg.exe')
const fp = join(dirname(ff), 'ffprobe.exe')
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(r.status, 0, r.stderr?.toString())
  return r.stdout
}
try {
  const bundled = join(temp, 'api.cjs')
  await build({
    stdin: {contents: "export {taoFilterComplex} from './src/main/burn'; export {parseCanonicalMediaMetadata} from './src/main/canonicalDisplayGeometry'", resolveDir:process.cwd(),loader:'ts'},
    outfile:bundled,bundle:true,format:'cjs',platform:'node',plugins:[{name:'electron-fixture',setup(b){
      b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'fixture'}))
      b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`module.exports={app:{getPath:()=>require('os').tmpdir(),getAppPath:()=>process.cwd(),getName:()=> 'tedia-pros',getVersion:()=> '0.1.23',isPackaged:false},safeStorage:{isEncryptionAvailable:()=>false}}`,loader:'js'}))
    }}]
  })
  const {taoFilterComplex,parseCanonicalMediaMetadata}=createRequire(import.meta.url)(bundled)
  const outputs=[]
  for(const item of [
    {name:'landscape',size:'640x360'},
    {name:'square',size:'480x480'},
    {name:'portrait',size:'360x640'},
    {name:'narrow',size:'200x800'},
    {name:'anamorphic',size:'720x576',sar:'16/15'},
    {name:'rotation90',size:'640x360',rotation:90}
  ]) {
    const source=join(temp,item.name+'.mp4')
    run(ff,['-v','error','-f','lavfi','-i',`testsrc2=s=${item.size}:r=10:d=0.4${item.sar?',setsar='+item.sar:''}`,
      '-f','lavfi','-i','sine=frequency=440:duration=0.4','-c:v','libx264','-c:a','aac','-shortest',source])
    let input=source
    if(item.rotation) {
      input=join(temp,'rotated.mp4')
      run(ff,['-v','error','-display_rotation:v:0','90','-i',source,'-c','copy',input])
    }
    const probe=JSON.parse(run(fp,['-v','error','-show_streams','-show_format','-of','json',input]))
    const meta=parseCanonicalMediaMetadata(probe)
    if(item.rotation) assert.deepEqual([meta.w,meta.h],[360,640],'rotation fixture must contain real display rotation')
    const filter=taoFilterComplex(meta,[],false,false,'unused.ass',false,false,100,null,true)
    const output=join(temp,item.name+'-out.mp4')
    run(ff,['-v','error','-i',input,...filter,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','copy',output])
    const result=JSON.parse(run(fp,['-v','error','-show_streams','-show_format','-of','json',output]))
    const v=result.streams.find(s=>s.codec_type==='video')
    assert.deepEqual([v.width,v.height,v.sample_aspect_ratio,Number(v.nb_frames)],[1080,1920,'1:1',4])
    assert.ok(!v.side_data_list?.some(s=>s.rotation),'no output display rotation')
    const audioHash=p=>createHash('sha256').update(run(ff,['-v','error','-i',p,'-vn','-f','s16le','-'])).digest('hex')
    const hash=audioHash(input)
    assert.equal(audioHash(output),hash)
    outputs.push({name:item.name,sourceDisplay:[meta.w,meta.h],output:[v.width,v.height],frames:Number(v.nb_frames),duration:v.duration,audioPcmSha256:hash,rotation:v.side_data_list||[]})
  }
  await writeFile(join(evidence,'render-matrix.json'),JSON.stringify(outputs,null,2))
  console.log(JSON.stringify(outputs,null,2))
} finally {
  assert.ok(resolve(temp).startsWith(resolve(tmpdir(),'tedia-review-portrait-')))
  await rm(temp,{recursive:true,force:true})
}
