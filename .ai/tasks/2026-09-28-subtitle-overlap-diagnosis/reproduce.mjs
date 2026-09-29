import { build } from 'esbuild'
import Module from 'node:module'
import { join } from 'node:path'

// Read-only production-code reproduction. Files are written only to this evidence directory.
const result = await build({
  stdin: { contents: String.raw`
    import { taoAss, boCuc } from './src/main/burn';
    import { createTextMeasurer } from './src/main/fontMeasure';
    import { planSubtitleLayout } from './src/shared/subtitleLayout';
    import { assertContainedParentDirectory } from './src/main/safeContainedPath';
    import { writeFile } from 'node:fs/promises';
    import assert from 'node:assert/strict';
    async function run() {
      const cue={id:'give',start:9.98,end:11.18,text:'Give me 30 minutes.'};
      const words=[{text:'Give',start:9.98,end:10.58},{text:'me',start:10.58,end:10.68},{text:'30',start:10.68,end:10.88},{text:'minutes.',start:10.88,end:11.18}];
      const cases=[];
      for (const size of [35,65]) {
        const meta={w:540,h:960};
        const bc=boCuc(meta,{x0:43.2,y0:748.8,x1:496.8,y1:864},false,size);
        const measure=createTextMeasurer(size,'Anton',null);
        const plan=planSubtitleLayout([cue],{profile:'social',autoOptimize:true,videoWidth:540,videoHeight:960,boxWidth:bc.bw,boxHeight:bc.bh,fontSize:size,boxPadding:0},measure);
        const opts={displayStyle:'single-word',layoutProfile:'social',autoOptimize:true,wordTimings:[{start:cue.start,end:cue.end,words}]};
        const ass=taoAss([cue],meta,bc,'Anton',null,null,opts);
        const lines=ass.split('\n').filter(l=>l.startsWith('Dialogue:'));
        cases.push({size,width:measure(cue.text),segments:plan.segments.map(s=>({text:s.text,start:s.start,end:s.end})),lines});
        if(size===65) {
          const me=lines.find(l=>l.endsWith('}me'));
          const thirty=lines.find(l=>l.endsWith('}30'));
          assert.ok(me.includes(',0:00:10.57,0:00:10.62,'));
          assert.ok(thirty.includes(',0:00:10.57,0:00:10.62,'));
          const control=taoAss([cue],meta,bc,'Anton',null,null,{...opts,autoOptimize:false});
          assert.ok(control.includes('0:00:10.58,0:00:10.68'));
          assert.ok(control.includes('0:00:10.68,0:00:10.88'));
          assert.ok(!control.includes('0:00:10.57,0:00:10.62'));
          console.log('CONFIRMED: split layout overlaps me/30 at 10.57-10.62; disabling only layout splitting preserves their distinct timings.');
          const out=process.cwd()+'/.ai/tasks/2026-09-28-subtitle-overlap-diagnosis';
          for(const [name,options] of [['repro',opts],['control-no-layout-split',{...opts,autoOptimize:false}]]) {
            const path=out+'/'+name+'.ass';
            await assertContainedParentDirectory(path,process.cwd(),'Evidence');
            await writeFile(path,taoAss([cue],meta,bc,'Anton',null,null,options));
          }
        }
      }
      const path=process.cwd()+'/.ai/tasks/2026-09-28-subtitle-overlap-diagnosis/reproduction.json';
      await assertContainedParentDirectory(path,process.cwd(),'Evidence');
      await writeFile(path,JSON.stringify({input:{cue,words},cases},null,2));
      console.log(JSON.stringify(cases,null,2));
    }
    run().catch(e=>{console.error(e);process.exitCode=1});
  `, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{name:'electron-diagnostic-mock',setup(b){
    b.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`module.exports={app:{getPath:()=>require('node:os').tmpdir(),getAppPath:()=>process.cwd(),isPackaged:false,getVersion:()=> 'diagnostic'},safeStorage:{isEncryptionAvailable:()=>false}}`,loader:'js'}));
  }}]
})
const runner = new Module(join(process.cwd(), '.ai/tasks/2026-09-28-subtitle-overlap-diagnosis/compiled.cjs'))
runner.paths = Module._nodeModulePaths(process.cwd())
runner._compile(result.outputFiles[0].text, runner.id)
