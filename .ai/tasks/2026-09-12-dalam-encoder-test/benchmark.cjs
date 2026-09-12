const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, spawnSync} = require('node:child_process');
const dir = __dirname;
const sourceDir = 'F:\\Son\\doyuin\\LauHaiSan\\dalam';
const root = path.join(process.env.APPDATA, 'tedia-pros', 'bin');
const binaries = {active: path.join(root,'ffmpeg','ffmpeg.exe'), compatible: path.join(root,'ffmpeg.exe')};
const probe = path.join(root,'ffprobe.exe');
const sources = fs.readdirSync(sourceDir).filter(n => n.endsWith('.mp4')).sort();
const report = {startedAt:new Date().toISOString(), durationSeconds:10, logicalCpus:os.cpus().length,
  scope:'First 10 seconds of both supplied sources. Controlled synthetic OCR mask and test ASS subtitle; current observed zoom/color settings. Not a full AutoShort rerun. Other application render may compete for resources.', binaries, results:[]};
fs.writeFileSync(path.join(dir,'test.ass'), `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,4,0,2,40,40,260,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,ENCODER TEST - CPU / NVIDIA\n`);
const graph = '[0:v]null,format=gbrp[display];[display]split=2[base][blur_source];[blur_source]gblur=sigma=64:steps=6[blurred];[1:v]format=gray,settb=AVTB,setpts=PTS-STARTPTS[mask];[base][blurred][mask]maskedmerge,trim=duration=10[masked];[masked]crop=982:1744:49:88,scale=1080:1920:flags=lanczos,setsar=1,eq=brightness=0.11:saturation=1.6:contrast=1,ass=test.ass,scale=1080:1920:flags=lanczos,setsar=1[out]';
async function run(source, index, binary, encoder, filtered) {
  const label = `${index+1}-${binary}-${encoder}-${filtered?'filtered':'plain'}`;
  const output = path.join(dir,`${label}.mp4`);
  if(fs.existsSync(output)) throw new Error(`Refusing overwrite: ${output}`);
  const args = ['-hide_banner','-nostdin','-n','-benchmark','-i',path.join(sourceDir,source)];
  if(filtered) args.push('-f','lavfi','-i','color=c=black:s=1080x1920:r=30:d=10,drawbox=x=80:y=1400:w=920:h=180:color=white:t=fill','-filter_complex',graph,'-map','[out]','-map','0:a?');
  else args.push('-map','0:v:0','-map','0:a?');
  args.push('-t','10','-c:v',encoder,'-pix_fmt','yuv420p');
  args.push(...(encoder==='h264_nvenc'?['-preset','p4','-cq','23']:['-preset','medium','-crf','20']));
  args.push('-c:a','copy',output);
  const start=performance.now();
  const logFile = fs.createWriteStream(path.join(dir,`${label}.log`));
  let stderr='';
  const child=spawn(binaries[binary],args,{cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe']});
  const timer=setTimeout(()=>child.kill(),240000);
  child.stderr.on('data',chunk=>{stderr+=chunk;logFile.write(chunk);});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  clearTimeout(timer);logFile.end();
  const wallSeconds=(performance.now()-start)/1000;
  const timing=stderr.match(/utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/);
  const result={label,source,binary,encoder,filtered,code,wallSeconds:Number(wallSeconds.toFixed(3)),speedX:code===0?Number((10/wallSeconds).toFixed(3)):null,args};
  if(timing){result.processCpuSeconds=+timing[1]+ +timing[2];result.averageMachineCpuPercent=Number((100*result.processCpuSeconds/wallSeconds/os.cpus().length).toFixed(1));}
  if(code===0){const p=spawnSync(probe,['-v','error','-show_entries','stream=codec_name,width,height,pix_fmt:stream_tags=encoder:format=duration,size','-of','json',output],{encoding:'utf8',windowsHide:true});result.probeExit=p.status;result.probe=JSON.parse(p.stdout);}
  else result.error=stderr.split('\n').filter(s=>/nvenc|required|Found:|minimum|Error|Nothing was/i.test(s)).join('\n');
  report.results.push(result);fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({label,code,wallSeconds:result.wallSeconds,speedX:result.speedX,cpu:result.averageMachineCpuPercent,error:result.error}));
}
(async()=>{
  for(const [index,source] of sources.entries()){
    await run(source,index,'active','h264_nvenc',false);
    await run(source,index,'compatible','h264_nvenc',false);
    await run(source,index,'compatible','h264_nvenc',true);
    await run(source,index,'active','libx264',true);
  }
  report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
