import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const bundled = await build({ stdin: { contents: `
const fs = require('node:fs');
const { buildDubbingPlan, groupDubbingPlanForSpeech, validateDubbingPlan } = require('./src/main/dubbing/plan');
const { applyDubbingTranslations, dubbingSpeakingDurations } = require('./src/main/dubbing/translation');
const ids = ['11ed92e2-66c3-4ad8-99fb-b879a14639b1','bf03032d-1fc8-4051-8fe9-149fdd31cc7f','899932d5-067b-4acd-8a8d-89d0bc8fdcf2','cecd1b20-843e-4225-ad0b-f152f6dafb99'];
module.exports = ids.map(id => {
 const data = JSON.parse(fs.readFileSync('C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/'+id+'/checkpoint.json','utf8'));
 const plan = groupDubbingPlanForSpeech(applyDubbingTranslations(buildDubbingPlan({ videoDuration: data.sourceCues.at(-1).end+0.5, cues:data.sourceCues }), data.translatedCues),'en');
 const windows = dubbingSpeakingDurations(plan.cues.map(c=>({id:c.id,start:c.sourceStart,end:c.sourceEnd,text:c.sourceText})),plan.videoDuration);
 const validation=validateDubbingPlan(plan);
 return {id,sourceCount:data.sourceCues.length,unitCount:plan.cues.length,validation, minWindow:Math.min(...windows),units:plan.cues.map((c,i)=>({id:c.id,ids:c.sourceCueIds,start:c.sourceStart,end:c.sourceEnd,window:windows[i],text:c.translatedText}))};
});`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false })
const require = createRequire(import.meta.url)
const m = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, m, m.exports)
await writeFile('.ai/tasks/2026-09-08-dubbing-group-audit.json', JSON.stringify(m.exports, null, 2))
for (const row of m.exports) console.log(JSON.stringify({id:row.id,sources:row.sourceCount,units:row.unitCount,valid:row.validation.ok,minWindow:row.minWindow,short:row.units.filter(u=>u.window<1.1)}))
