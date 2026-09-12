// Read LevelDB WAL records without opening or modifying the production DB.
const fs=require('node:fs'),p=require('node:path');
const dir=p.join(process.env.APPDATA,'tedia-pros/Local Storage/leveldb');
const varint=(b,o)=>{let n=0,s=0,v;do{v=b[o++];n+=(v&127)*2**s;s+=7;if(s>49)throw Error('varint')}while(v&128);return[n,o]};
const blobs=[];
for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.log')).sort()){
  const b=fs.readFileSync(p.join(dir,name));let chunks=[];
  for(let base=0;base<b.length;base+=32768)for(let o=base;o+7<=Math.min(base+32768,b.length);){
    const len=b.readUInt16LE(o+4),type=b[o+6];o+=7;if(!len&&!type)break;
    const data=b.subarray(o,o+len);o+=len;
    if(type===1)blobs.push(data);else if(type===2)chunks=[data];else if(type===3)chunks.push(data);
    else if(type===4){chunks.push(data);blobs.push(Buffer.concat(chunks));chunks=[];}
  }
}
let latest=null;
for(const b of blobs){if(b.length<12)continue;let o=12;const count=b.readUInt32LE(8);
  try{for(let i=0;i<count;i++){
    const type=b[o++];let n;[n,o]=varint(b,o);const key=b.subarray(o,o+n);o+=n;
    if(type!==1)continue;[n,o]=varint(b,o);const value=b.subarray(o,o+n);o+=n;
    if(!key.toString('latin1').endsWith('tblao.autoshort.tasks'))continue;
    const text=value[0]===0?value.subarray(1).toString('utf16le'):value.subarray(1).toString('utf8');
    const a=JSON.parse(text);if(Array.isArray(a))latest=a;
  }}catch{}
}
if(!latest)throw Error('No intact persisted task array found in WAL');
const metrics=require('./metrics.json'),main=metrics.items.filter(x=>x.jobId===metrics.jobId),seen=new Set(main.map(x=>x.itemId));
const result={scope:'Last intact persisted task array in LevelDB WAL; UI statuses may be stale after exit',queueCount:latest.length,
  matchedStarted:latest.filter(x=>seen.has(x.id)).length,
  unstarted:latest.filter(x=>!seen.has(x.id)).length,
  statuses:latest.reduce((s,x)=>(s[x.status]=(s[x.status]||0)+1,s),{}),
  items:latest.map(x=>({id:x.id,filePath:x.filePath,status:x.status,startedInLastJob:seen.has(x.id)}))};
fs.writeFileSync(p.join(__dirname,'queue-snapshot.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,items:undefined},null,2));
