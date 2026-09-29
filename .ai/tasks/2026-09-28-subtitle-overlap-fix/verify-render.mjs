import { build } from 'esbuild'
import Module from 'node:module'
import { join } from 'node:path'

// Generate ASS with the real production renderer and render the source excerpt.
// Electron app lookup is the only mock; font measurement and FFmpeg are real.
const result = await build({
  stdin: { contents: String.raw`
    import { taoAss, boCuc } from './src/main/burn';
    import { assertContainedRegularFile, assertContainedParentDirectory } from './src/main/safeContainedPath';
    import { mkdir, readFile, writeFile } from 'node:fs/promises';
    import { spawnSync } from 'node:child_process';
    import assert from 'node:assert/strict';
    async function run() {
      const root=process.cwd();
      const out=root+'/.ai/tasks/2026-09-28-subtitle-overlap-fix';
      await assertContainedParentDirectory(out+'/fixed.ass',root,'Evidence');
      await mkdir(out,{recursive:true});
      const fixturePath=await assertContainedRegularFile(root+'/.ai/tasks/2026-09-28-subtitle-overlap-diagnosis/reproduction.json',root,'Fixture');
      const {input:{cue,words}}=JSON.parse(await readFile(fixturePath,'utf8'));
      const meta={w:540,h:960};
      const bc=boCuc(meta,{x0:43.2,y0:748.8,x1:496.8,y1:864},false,65);
      const ass=taoAss([cue],meta,bc,'Anton',null,null,{
        displayStyle:'single-word',layoutProfile:'social',autoOptimize:true,
        requireWordTimings:true,wordTimings:[{start:cue.start,end:cue.end,words}]
      });
      const events=ass.split('\n').filter(line=>line.startsWith('Dialogue:'));
      assert.equal(events.length,4);
      const expected=[['09.98','10.58','Give'],['10.58','10.68','me'],['10.68','10.88','30'],['10.88','11.18','minutes.']];
      events.forEach((line,i)=>{
        assert.ok(line.includes(',0:00:'+expected[i][0]+',0:00:'+expected[i][1]+','),line);
        assert.ok(line.endsWith('}'+expected[i][2]),line);
      });
      await writeFile(out+'/fixed.ass',ass);
      await writeFile(out+'/events.json',JSON.stringify({events},null,2));
      const source=await assertContainedRegularFile('F:/Son/facebook/New folder/QUIET HOURS/Video [923923593724102].mp4','F:/Son/facebook/New folder/QUIET HOURS','Source');
      const ffmpeg='C:/Users/PC/AppData/Roaming/tedia-pros-dev/bin/ffmpeg.exe';
      const clip=out+'/give-me-30-fixed-sample.mp4';
      await assertContainedParentDirectory(clip,root,'Sample');
      const invoke=(args)=>{
        const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',windowsHide:true});
        if(r.error) throw r.error;
        assert.equal(r.status,0,r.stderr);
      };
      invoke(['-i',source,'-vf','ass=.ai/tasks/2026-09-28-subtitle-overlap-fix/fixed.ass:fontsdir=resources/fonts,scale=1080:1920',
        '-ss','9.5','-t','2','-map','0:v:0','-map','0:a:0?','-c:v','libx264','-preset','fast','-crf','18','-c:a','aac','-movflags','+faststart',clip]);
      for(const [name,index] of [['me-10.583333',26],['30-10.708333',29]]) {
        const image=out+'/'+name+'.png';
        await assertContainedParentDirectory(image,root,'Frame');
        invoke(['-i',clip,'-vf',"select='eq(n,"+index+")',crop=440:180:320:1520",'-frames:v','1',image]);
      }
      console.log(JSON.stringify({status:'PASS',events,clip},null,2));
    }
    run().catch(e=>{console.error(e);process.exitCode=1});
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{name:'electron-diagnostic-mock',setup(b){
    b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`module.exports={app:{getPath:()=>require('node:os').tmpdir(),getAppPath:()=>process.cwd(),isPackaged:false,getVersion:()=> 'diagnostic'},safeStorage:{isEncryptionAvailable:()=>false}}`,loader:'js'}));
  }}]
})
const runner = new Module(join(process.cwd(), '.ai/tasks/2026-09-28-subtitle-overlap-fix/compiled.cjs'))
runner.paths = Module._nodeModulePaths(process.cwd())
runner._compile(result.outputFiles[0].text, runner.id)
