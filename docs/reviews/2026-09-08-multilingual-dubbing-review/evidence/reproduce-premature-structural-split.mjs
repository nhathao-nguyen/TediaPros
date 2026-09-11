import { createRequire } from 'node:module';
import Module from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(process.cwd() + '/package.json');
const { build } = require('esbuild');
const entry = `
export { synthesizeDubbingPlan } from './src/main/dubbing/synthesis';
export { buildDubbingPlan, groupDubbingPlanForSpeech, validateDubbingPlan } from './src/main/dubbing/plan';
export { applyDubbingTranslations } from './src/main/dubbing/translation';
`;
async function loadVersion(base) {
 const result = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,plugins:base?[{name:'base-synthesis',setup(b){b.onLoad({filter:/[\\/]dubbing[\\/]synthesis\.ts$/},()=>({contents:execFileSync('git',['show','481ae06:src/main/dubbing/synthesis.ts'],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
 const m=new Module(process.cwd()+'/review-memory.cjs');m.filename=process.cwd()+'/review-memory.cjs';m.paths=Module._nodeModulePaths(process.cwd());m._compile(result.outputFiles[0].text,m.filename);return m.exports;
}
const results=[];
for(const base of [true,false]){
 const {synthesizeDubbingPlan,buildDubbingPlan,groupDubbingPlanForSpeech,applyDubbingTranslations,validateDubbingPlan}=await loadVersion(base);
 const original=buildDubbingPlan({videoDuration:3.5,paceMode:'fixed',cues:[{id:'a',start:0,end:1.4,text:'Opening sentence.'},{id:'b1',start:2,end:2.3,text:'source fragment one'},{id:'b2',start:2.4,end:2.8,text:'source fragment two'}]});
 const plan=groupDubbingPlanForSpeech(applyDubbingTranslations(original,[{id:'a',text:'Opening sentence.'},{id:'b1',text:'First translated part.'},{id:'b2',text:'Second translated part.'}]),'en');
 assert.deepEqual(plan.cues.map(c=>c.sourceCueIds),[['a'],['b1','b2']]);
 const trace=[];
 const input={plan,language:'en',model:'fixture',fixedTempo:1,localTempoDelta:.15,maxEarlyStartSeconds:.35,predictor:{profile:{samples:1},estimate:()=>({seconds:1,uncertaintySeconds:0,confidence:1}),addSample:()=>{}},tts:{synthesize:async r=>{trace.push('tts:'+r.text);return {path:r.text}}},audio:{trim:async p=>({path:p,duration:p==='Opening sentence.'?3:p==='Short opener.'?.5:p.includes('First translated part.')&&p.includes('Second translated part.')?1.8:.7}),applyTempo:async(p,h,d)=>({path:p,duration:d})},rephrase:async r=>{trace.push('llm:'+r.cueId);return r.cueId==='a'?['Short opener.']:[]},onStructuralSplit:e=>trace.push('split:'+e.cueId)};
 if (!base) {
   input.rephraseBatch = async requests => {
     trace.push('llm:batch');
     return new Map(requests.map(r => [r.cueId, r.cueId === 'a' ? ['Short opener.'] : []]));
   };
   delete input.rephrase;
 }
 try {const r=await synthesizeDubbingPlan(input);results.push({version:base?'BASE 481ae06':'HEAD',outcome:'PASS',initialGroups:plan.cues.map(c=>c.sourceCueIds),validation:validateDubbingPlan(r.plan),final:r.plan.cues.map(c=>({id:c.id,sourceCueIds:c.sourceCueIds,start:c.start,end:c.voiceEnd,tempo:c.tempo})),trace});}
 catch(e){results.push({version:base?'BASE 481ae06':'HEAD',outcome:'FAIL',initialGroups:plan.cues.map(c=>c.sourceCueIds),error:e.message,trace});}
}
assert.equal(results[0].outcome,'PASS');
assert.equal(results[0].validation.ok,true);
assert.equal(results[1].outcome,'FAIL');
assert.equal(results[1].error,'Cue b1 có audio không hợp lệ.');
assert.ok(results[1].trace.includes('split:b1'));
assert.ok(!results[1].trace.some(t=>t.startsWith('llm:')));
console.log(JSON.stringify({assertion:'REPRODUCED: baseline valid, HEAD rejects before LLM',results},null,2));
