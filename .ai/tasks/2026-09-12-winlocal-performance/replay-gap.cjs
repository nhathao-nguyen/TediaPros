const fs=require('node:fs'), p=require('node:path'), vm=require('node:vm'), assert=require('node:assert/strict');
const ts=require('typescript'), asar=require('@electron/asar'), esbuild=require('esbuild');
const app=p.join(process.env.LOCALAPPDATA,'Programs/TediaPros/resources/app.asar');
const installed=asar.extractFile(app,'out\\main\\index.js').toString('utf8');
const ast=ts.createSourceFile('installed.js',installed,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const names=['validateOcrVisualTimeline','stabilizeSingleSampleGaps','normalizeText','computeIoU'];
const functions=ast.statements.filter(x=>ts.isFunctionDeclaration(x)&&names.includes(x.name?.text));
assert.equal(functions.length,4);
const constants=['OCR_VISUAL_MAX_SEGMENTS','OCR_VISUAL_MAX_BOXES_PER_SEGMENT','OCR_VISUAL_MAX_TEXT_CODE_POINTS'];
const declarations=[];
for(const st of ast.statements) if(ts.isVariableStatement(st)) for(const d of st.declarationList.declarations)
  if(constants.includes(d.name.getText(ast))) declarations.push(`const ${d.getText(ast)};`);
assert.equal(declarations.length,3);
const context={};vm.createContext(context);
vm.runInContext([...declarations,...functions.map(x=>x.getText(ast))].join('\n'),context);
const moduleContext={exports:{}};
vm.runInNewContext(esbuild.transformSync(fs.readFileSync('src/shared/ocrVisualTimeline.ts','utf8'),{loader:'ts',format:'cjs'}).code,{module:moduleContext,exports:moduleContext.exports});
const source=moduleContext.exports;
const metrics=require('./metrics.json');
const errors=metrics.items.filter(x=>x.jobId===metrics.jobId&&x.category==='ocr-sttn-gap');
const cache=p.join(process.env.APPDATA,'tedia-pros/autoshort-artifact-cache-v1/visual-ocr');
const results=[];
for(const d of fs.readdirSync(cache)) {
  const file=p.join(cache,d,'artifact.bin');if(!fs.existsSync(file))continue;
  const raw=JSON.parse(fs.readFileSync(file)), timeline=raw.timeline;
  if(!timeline?.segments)continue;
  const hit=errors.find(e=>timeline.segments.some(s=>e.error.includes(s.id)&&s.id.startsWith('gap-')));
  if(!hit)continue;
  const expected={...timeline.video,scanRegion:timeline.scanRegion};
  const withoutSynthetic={...timeline,segments:timeline.segments.filter(s=>!s.id.startsWith('gap-'))};
  const perVersion={};
  for(const [name,api]of Object.entries({installed:context,source})) {
    const validated=api.validateOcrVisualTimeline(withoutSynthetic,expected);
    const stabilized=api.stabilizeSingleSampleGaps(validated);
    const ids=stabilized.segments.filter(s=>s.id.startsWith('gap-')).map(s=>s.id);
    let error;try{api.validateOcrVisualTimeline(stabilized,expected)}catch(e){error=e.message}
    assert.ok(error&&hit.error.includes(error));
    perVersion[name]={rawValidated:true,syntheticCount:ids.length,rejected:error};
  }
  results.push({itemId:hit.itemId,cacheFile:file,profile:timeline.profile,transport:timeline.transport,ocrProvider:timeline.ocrProvider,...perVersion});
}
assert.equal(new Set(results.map(x=>x.itemId)).size,13,'All 13 observed gap failures reproduced from actual cached evidence');
fs.writeFileSync(p.join(__dirname,'gap-replay.json'),JSON.stringify({result:'PASS: reproduced defect (not fixed)',results},null,2));
console.log(JSON.stringify({result:'PASS: reproduced all 13 failures in installed and source functions',cases:results.length,providers:[...new Set(results.map(x=>JSON.stringify(x.ocrProvider)))],transports:[...new Set(results.map(x=>x.transport))]},null,2));
