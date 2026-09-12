// Read-only audit of existing WinLocal artifacts. No provider or engine jobs.
const fs = require('node:fs');
const p = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = 'F:/US/MyLau';
const jobId = 'ef37f1f8-9606-4870-9b05-a9b6693aaf87';
const out = __dirname;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const inventory = [], items = [];
const classify = j => j.status !== 'failed' ? j.status :
  /prefix gap-/.test(j.error) ? 'ocr-sttn-gap' :
  /DubbingVideoExtensionLimitError/.test(j.error) ? 'duration-overflow' :
  /tempo đo được/.test(j.error) ? 'measured-tempo' :
  /chatterbox_generation_failed/.test(j.error) ? 'chatterbox' : 'other';
for (const folder of fs.readdirSync(root, {withFileTypes:true}).filter(x => x.isDirectory())) {
  const outputDir = p.join(root, folder.name);
  for (const audit of fs.readdirSync(outputDir).filter(x => x.startsWith('.autoshort-audit-'))) {
    const artifactDir = p.join(outputDir, audit), diag = p.join(artifactDir, 'diagnostics');
    const summaryPath = p.join(diag, 'summary.json');
    if (!fs.existsSync(summaryPath)) continue;
    const j = JSON.parse(fs.readFileSync(summaryPath));
    const snapshotDir = p.join(out, 'evidence', j.jobId, j.itemId);
    fs.mkdirSync(snapshotDir, {recursive:true});
    for (const name of ['summary.json', 'events.jsonl']) {
      const source = p.join(diag, name);
      if (!fs.existsSync(source)) continue;
      const b = fs.readFileSync(source);
      fs.writeFileSync(p.join(snapshotDir, name), b);
      inventory.push({source, snapshot:p.relative(out,p.join(snapshotDir,name)), bytes:b.length, sha256:hash(b)});
    }
    const events = fs.readFileSync(p.join(diag,'events.jsonl'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const manifestPath = p.join(artifactDir,'manifest.json');
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : null;
    const outputs = fs.readdirSync(outputDir).filter(x=>/\.mp4$/i.test(x)).map(x=>p.join(outputDir,x));
    const spans = events.filter(x=>['succeeded','failed','cancelled'].includes(x.phase)).map(e=>{
      const start = events.find(x=>x.stageId===e.stageId && x.phase==='queued');
      return {stage:e.stage, phase:e.phase, start:start?.monotonicElapsedMs, end:e.monotonicElapsedMs,
        requested:e.requestedProvider,effective:e.effectiveProvider,counters:e.counters};
    });
    const translateEnd = spans.find(x=>x.stage==='translate')?.end;
    const ttsStart = spans.find(x=>x.stage==='tts')?.start;
    items.push({folder:folder.name, artifactDir, outputs, ...j, category:classify(j), spans,
      translateToTtsMs: ttsStart !== undefined && translateEnd !== undefined ? ttsStart-translateEnd : null,
      manifest:manifest && {sourceFile:manifest.sourceFile,outputFile:manifest.outputFile,sourceLanguage:manifest.sourceLanguage,
        targetLanguage:manifest.targetLanguage,generatedVoiceCount:manifest.generatedVoiceCount,separation:manifest.separation,sttn:manifest.sttn,ocrBlur:manifest.ocrBlur}});
  }
}
items.sort((a,b)=>a.startedAtUtc.localeCompare(b.startedAtUtc));
const sum = (a,fn)=>a.reduce((s,x)=>s+(fn(x)||0),0);
const jobs = {};
for (const id of [...new Set(items.map(x=>x.jobId))]) {
  const a=items.filter(x=>x.jobId===id), groups={}, stages={};
  for (const x of a) {
    const g=groups[x.category]??={count:0,wallMs:0};g.count++;g.wallMs+=x.totalWallMs;
    for(const [key,s] of Object.entries(x.stages)) {
      const z=stages[key]??={count:0,activeMs:0,waitMs:0,byStatus:{}};
      z.count++;z.activeMs+=s.activeMs;z.waitMs+=s.resourceWaitMs;
      z.byStatus[s.status]=(z.byStatus[s.status]||0)+1;
    }
  }
  jobs[id]={start:a[0].startedAtUtc,end:a.at(-1).completedAtUtc,
    elapsedMs:Date.parse(a.at(-1).completedAtUtc)-Date.parse(a[0].startedAtUtc),
    itemWallMs:sum(a,x=>x.totalWallMs), groups, stages, outputCount:sum(a,x=>x.outputs.length),
    successfulMeanMs:sum(a.filter(x=>x.status==='succeeded'),x=>x.totalWallMs)/a.filter(x=>x.status==='succeeded').length,
    translateToTtsMs:sum(a,x=>x.translateToTtsMs),
    successfulStages:Object.fromEntries(Object.keys(stages).map(k=>[k,{count:a.filter(x=>x.status==='succeeded'&&x.stages[k]).length,
      activeMs:sum(a.filter(x=>x.status==='succeeded'),x=>x.stages[k]?.activeMs)}]))};
}
const main=items.filter(x=>x.jobId===jobId);
const probePath = p.join(process.env.APPDATA,'tedia-pros/bin/ffprobe.exe');
const media=[];
if(fs.existsSync(probePath)) for(const x of items.filter(x=>x.status==='succeeded')) for(const file of x.outputs) {
  const result=cp.spawnSync(probePath,['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,width,height','-of','json',file],{encoding:'utf8',windowsHide:true,timeout:30000});
  media.push({file,jobId:x.jobId,exitCode:result.status,...(result.status===0?{probe:JSON.parse(result.stdout)}:{error:result.stderr})});
}
const report={capturedAtUtc:new Date().toISOString(),root,jobId,jobs,items,media,inventory};
fs.writeFileSync(p.join(out,'metrics.json'),JSON.stringify(report,null,2));
fs.writeFileSync(p.join(out,'FILE_INVENTORY.json'),JSON.stringify(inventory,null,2));
console.log(JSON.stringify({jobs,mediaCount:media.length,probePassed:media.filter(x=>x.exitCode===0).length,
  mainOutputSeconds:sum(media.filter(x=>x.jobId===jobId),x=>Number(x.probe?.format?.duration)),
  providers:[...new Set(main.flatMap(x=>x.spans.map(s=>`${s.stage}:${s.requested||'?'}->${s.effective||'unknown'}`)))],
  checkpointIds:main.filter(x=>x.category==='duration-overflow').map(x=>({itemId:x.itemId,error:x.error})),
  slowest:main.toSorted((a,b)=>b.totalWallMs-a.totalWallMs).slice(0,4).map(x=>({folder:x.folder,status:x.status,minutes:x.totalWallMs/60000,stages:x.stages}))},null,2));
