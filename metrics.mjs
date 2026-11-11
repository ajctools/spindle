import fs from 'node:fs/promises';
import path from 'node:path';
import {csvCell} from './security.mjs';
import {cloudUsage} from './public/cloud-cost.mjs';
export const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const first=(...values)=>values.find(v=>number(v)!==null)??null;
export function usageFrom(body={},headers){
  let usage=body?.usage || body?.data?.usage || body?.result?.usage;
  let source=usage&&typeof usage==='object'?'response body':null;
  if(headers){for(const name of ['x-token-usage','x-usage']){const raw=headers.get(name);if(raw){try{const value=JSON.parse(raw);if(value&&typeof value==='object'){usage={...value,...(typeof usage==='object'?usage:{})};source=source?source+' + '+name:name;}}catch{}}}}
  const u=usage&&typeof usage==='object'?usage:{};
  const input=first(u.prompt_tokens,u.input_tokens,u.promptTokens,u.inputTokens,headerNumber(headers,'x-prompt-tokens'),headerNumber(headers,'x-input-tokens'));
  const output=first(u.completion_tokens,u.output_tokens,u.completionTokens,u.outputTokens,headerNumber(headers,'x-completion-tokens'),headerNumber(headers,'x-output-tokens'));
  let total=first(u.total_tokens,u.totalTokens,headerNumber(headers,'x-total-tokens'));
  if(total===null&&input!==null&&output!==null)total=input+output;
  const timings=body?.timings || body?.data?.timings || {};
  const prompt=first(input,timings.prompt_n),completion=first(output,timings.predicted_n);
  if(total===null&&prompt!==null&&completion!==null)total=prompt+completion;
  const reported=total!==null||prompt!==null||completion!==null;
  return {inputTokens:prompt,outputTokens:completion,totalTokens:total,cachedTokens:first(u.prompt_tokens_details?.cached_tokens,u.input_tokens_details?.cached_tokens,timings.cache_n),
    reasoningTokens:first(u.completion_tokens_details?.reasoning_tokens,u.output_tokens_details?.reasoning_tokens),
    source:reported?(source || (Object.keys(timings).length?'runtime timings':'response headers')):null,
    decodeTps:first(timings.predicted_per_second,timings.decode_tokens_per_second),prefillTps:first(timings.prompt_per_second),
    prefillMs:first(timings.prompt_ms),decodeMs:first(timings.predicted_ms),rawUsage:typeof usage==='object'?usage:null,rawTimings:Object.keys(timings).length?timings:null};
}
export function mergeUsage(...sources){
  const result={};for(const source of sources)for(const [key,value]of Object.entries(source || {}))if(value!==null&&value!==undefined)result[key]=value;
  if(!number(result.totalTokens)&&result.totalTokens!==0&&number(result.inputTokens)!==null&&number(result.outputTokens)!==null)result.totalTokens=result.inputTokens+result.outputTokens;
  return result;
}
function headerNumber(h,key){const v=h?.get(key);return v!==undefined&&v!==null&&v!==''?number(Number(v)):null;}
export function mediaFromBuffer(buffer,mime){
  const out={bytes:buffer.length};
  if(buffer.length>=24&&buffer[0]===137&&buffer.subarray(1,4).toString()==='PNG'){out.width=buffer.readUInt32BE(16);out.height=buffer.readUInt32BE(20);}
  if(buffer.length>=44&&buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WAVE'){
    let rate,channels,bits;for(let i=12;i+8<=buffer.length;){const n=buffer.readUInt32LE(i+4),type=buffer.subarray(i,i+4).toString();if(type==='fmt '&&n>=16&&i+24<=buffer.length){channels=buffer.readUInt16LE(i+10);rate=buffer.readUInt32LE(i+12);bits=buffer.readUInt16LE(i+22);}if(type==='data'&&rate&&channels&&bits){out.seconds=Math.min(n,buffer.length-i-8)/(rate*channels*bits/8);out.sampleRate=rate;out.channels=channels;}i+=8+n+(n%2);}
  }
  if(buffer.length>=16&&buffer.subarray(4,8).toString()==='ftyp'){
    // Read only standard MP4 metadata boxes, never decode frames or execute a media tool.
    const boxes=(start,end)=>{const rows=[];for(let p=start;p+8<=end;){let size=buffer.readUInt32BE(p),header=8;if(size===1){if(p+16>end)break;size=Number(buffer.readBigUInt64BE(p+8));header=16;}if(size===0)size=end-p;if(!Number.isSafeInteger(size)||size<header||p+size>end)break;rows.push({type:buffer.subarray(p+4,p+8).toString(),start:p+header,end:p+size});p+=size;}return rows;};
    const child=(box,type)=>box?boxes(box.start,box.end).find(b=>b.type===type):null;
    try{const moov=boxes(0,buffer.length).find(b=>b.type==='moov');for(const track of moov?boxes(moov.start,moov.end).filter(b=>b.type==='trak'):[]){
      const mdia=child(track,'mdia'),handler=child(mdia,'hdlr');if(!handler||handler.start+12>handler.end||buffer.subarray(handler.start+8,handler.start+12).toString()!=='vide')continue;
      const tkhd=child(track,'tkhd'),mdhd=child(mdia,'mdhd'),stsz=child(child(child(mdia,'minf'),'stbl'),'stsz');
      if(tkhd&&tkhd.end-tkhd.start>=8){out.width=buffer.readUInt32BE(tkhd.end-8)/65536;out.height=buffer.readUInt32BE(tkhd.end-4)/65536;}
      let timescale=null;const trackVersion=tkhd?buffer[tkhd.start]:0,trackId=tkhd?buffer.readUInt32BE(tkhd.start+(trackVersion===1?20:12)):null;
      if(mdhd){const version=buffer[mdhd.start],offset=mdhd.start+(version===1?20:12);if(offset+(version===1?12:8)<=mdhd.end){timescale=buffer.readUInt32BE(offset);const ticks=version===1?Number(buffer.readBigUInt64BE(offset+4)):buffer.readUInt32BE(offset+4);if(timescale&&ticks){out.seconds=ticks/timescale;out.containerSeconds=out.seconds;}}}
      if(stsz&&stsz.start+12<=stsz.end)out.frames=buffer.readUInt32BE(stsz.start+8);
      if(!out.frames){let count=0,ticks=0;for(const fragment of boxes(0,buffer.length).filter(b=>b.type==='moof'))for(const traf of boxes(fragment.start,fragment.end).filter(b=>b.type==='traf')){
        const tfhd=child(traf,'tfhd');if(!tfhd||tfhd.start+8>tfhd.end||buffer.readUInt32BE(tfhd.start+4)!==trackId)continue;
        const flags=buffer.readUInt32BE(tfhd.start)&0xffffff;let offset=tfhd.start+8+(flags&1?8:0)+(flags&2?4:0),defaultDuration=flags&8&&offset+4<=tfhd.end?buffer.readUInt32BE(offset):0;
        for(const trun of boxes(traf.start,traf.end).filter(b=>b.type==='trun')){if(trun.start+8>trun.end)continue;const f=buffer.readUInt32BE(trun.start)&0xffffff,samples=buffer.readUInt32BE(trun.start+4);count+=samples;let p=trun.start+8+(f&1?4:0)+(f&4?4:0),stride=(f&0x100?4:0)+(f&0x200?4:0)+(f&0x400?4:0)+(f&0x800?4:0);if(f&0x100){if(stride&&p+samples*stride<=trun.end)for(let i=0;i<samples;i++)ticks+=buffer.readUInt32BE(p+i*stride);}else ticks+=defaultDuration*samples;}
      }if(count)out.frames=count;if(ticks&&timescale&&!out.seconds){out.seconds=ticks/timescale;out.containerSeconds=out.seconds;}}
      if(out.frames&&out.seconds){out.fps=out.frames/out.seconds;out.fpsSource='container average';}break;
    }}catch{/* A partial or unusual container still retains its file size. */}
  }
  return out;
}
export function mediaFromResponse(body={},headers){
  const b=body.data || body, size=typeof b.size==='string'?b.size.match(/^(\d+)x(\d+)$/):null;
  return {frames:first(b.frames,headerNumber(headers,'x-frames')),width:first(b.width,size?Number(size[1]):null,headerNumber(headers,'x-width')),height:first(b.height,size?Number(size[2]):null,headerNumber(headers,'x-height')),fps:first(b.fps,headerNumber(headers,'x-fps')),seconds:first(b.seconds!==null&&b.seconds!==undefined&&b.seconds!==''?number(Number(b.seconds)):null,number(b.duration),headerNumber(headers,'x-duration'))};
}
export function summarizeResources(samples){
  const npus=samples.flatMap(s=>(s.devices||[]).map(d=>d.util_percent)).filter(v=>number(v)!==null),mem=samples.flatMap(s=>(s.devices||[]).map(d=>d.mem_used_mb)).filter(v=>number(v)!==null);
  return {sampleCount:samples.length,npuPeak:npus.length?Math.max(...npus):null,npuMedian:percentile(npus,.5),npuMemoryPeakMb:mem.length?Math.max(...mem):null};
}
export function createMetric({job,step,index,output,startedAt,finishedAt,executionMs,prepareMs,resources,connectionId,model,legacy=false}){
  const usage=output?.metrics || usageFrom(output?.json),assets=output?.assets || [];
  const media={...assets.reduce((m,a)=>({...m,...Object.fromEntries(Object.entries(a.metadata||{}).filter(([,v])=>v!==null&&v!==undefined))}),{}),...Object.fromEntries(Object.entries(output?.media || {}).filter(([,v])=>v!==null&&v!==undefined))};
  return {recordVersion:2,id:job.id+':'+index,runId:job.id,step:index,connectionId,task:step.task,model:step.model,modelVersion:model?.version || null,status:output?'completed':job.status,
    startedAt:startedAt || job.startedAt || job.createdAt,finishedAt:finishedAt || job.finishedAt || null,executionMs:number(executionMs),prepareMs:number(prepareMs),
    inputTokens:usage.inputTokens??null,outputTokens:usage.outputTokens??null,totalTokens:usage.totalTokens??null,cachedTokens:usage.cachedTokens??null,reasoningTokens:usage.reasoningTokens??null,
    usageSource:usage.source || null,decodeTps:usage.decodeTps??null,prefillTps:usage.prefillTps??null,prefillMs:usage.prefillMs??null,decodeMs:usage.decodeMs??null,
    effectiveOutputTps:usage.outputTokens!==null&&usage.outputTokens!==undefined&&executionMs>0?usage.outputTokens/(executionMs/1000):null,
    assetCount:assets.length,imageCount:assets.filter(a=>a.mime.startsWith('image/')).length,videoCount:assets.filter(a=>a.mime.startsWith('video/')).length,audioCount:assets.filter(a=>a.mime.startsWith('audio/')).length,
    media,framesPerSecond:media.frames&&executionMs>0?media.frames/(executionMs/1000):null,audioRealtimeFactor:media.seconds&&assets.some(a=>a.mime.startsWith('audio/'))&&executionMs>0?media.seconds/(executionMs/1000):null,
    resources:resources || null,executionSource:legacy?'Legacy run timer':'Spindle step timer',profile:{params:Object.fromEntries(Object.entries(step.params || {}).filter(([k,v])=>['max_tokens','temperature','seed','steps','width','height','size','seconds','seconds_total','num_frames','frames','fps','thinking_enabled','_spindlePreview'].includes(k)&&['number','boolean','string'].includes(typeof v))),hasFile:step.file||step.fileFrom&&step.fileFrom!=='none'?true:legacy?null:false,
      ...(step.task==='chat'?{chat:{thinkingMode:step.params?._spindleThinking || 'auto',thinkingEnabled:step.params?.chat_template_kwargs?.enable_thinking ?? null,reasoningEffort:step.params?._spindleEffort || step.params?.reasoning_effort || 'auto',stream:output?.streamed ?? null,webSearch:step.params?._spindleWebSearch?.enabled===true}}:{})},
    benchmark:!!job.benchmark,suite:job.benchmark?'spindle-text-v1':null,legacy,rawUsage:usage.rawUsage || null,rawTimings:usage.rawTimings || null};
}
export function percentile(values,q){const a=values.filter(v=>number(v)!==null).sort((a,b)=>a-b);if(!a.length)return null;const p=(a.length-1)*q,l=Math.floor(p);return a[l]+(a[Math.ceil(p)]-a[l])*(p-l);}
function metricPeriod({days=7,timeZone='UTC',now=Date.now()}={}){
  try{new Intl.DateTimeFormat('en-CA',{timeZone});}catch{timeZone='UTC';}
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}),date=t=>formatter.format(new Date(t));
  const endDate=date(now),firstDate=new Date(endDate+'T12:00:00Z');
  firstDate.setUTCDate(firstDate.getUTCDate()-(days-1));
  return {timeZone,date,startDate:days===0?null:firstDate.toISOString().slice(0,10),endDate};
}
function selectMetrics(records,{date,startDate,endDate},{task='all',model='all',benchmarks=false}){
  return records.filter(r=>{if(!Number.isFinite(Date.parse(r.startedAt)))return false;const day=date(r.startedAt);return (!startDate||day>=startDate)&&day<=endDate&&(task==='all'||r.task===task)&&(model==='all'||r.model===model)&&(!benchmarks||r.benchmark);});
}
export function filterMetrics(records,options={}){
  return selectMetrics(records,metricPeriod(options),options);
}
export function summarize(records,options={}){
  const {days=7}=options,period=metricPeriod(options),{timeZone,date,startDate,endDate}=period;
  const rows=selectMetrics(records,period,options);
  const complete=rows.filter(r=>r.status==='completed'),durations=complete.map(r=>r.executionMs),known=complete.filter(r=>number(r.totalTokens)!==null),sum=(a,key)=>a.reduce((n,r)=>n+(number(r[key])??0),0);
  const perDay=new Map(),groups=new Map(),chatByDay=new Map();
  for(const r of rows){const key=date(r.startedAt),d=perDay.get(key)||{date:key,totalTokens:0,inputTokens:0,outputTokens:0,requests:0,completed:0,executionMs:0,reported:0};d.requests++;if(r.status==='completed'){d.completed++;d.totalTokens+=r.totalTokens || 0;d.inputTokens+=r.inputTokens || 0;d.outputTokens+=r.outputTokens || 0;d.executionMs+=r.executionMs || 0;if(r.totalTokens!==null)d.reported++;}perDay.set(key,d);
    if(r.task==='chat'){const chat=chatByDay.get(key)||[];chat.push(r);chatByDay.set(key,chat);}
    const id=r.task+'|'+r.model,group=groups.get(id)||{task:r.task,model:r.model,records:[]};group.records.push(r);groups.set(id,group);}
  const activity=[...perDay.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const dailyCloudUsage=activity.map(({date})=>({date,...cloudUsage(chatByDay.get(date)||[])})).filter(day=>day.completed);
  return {timeZone,days,period:{startDate,endDate},cloudUsage:cloudUsage(rows),dailyCloudUsage,totals:{requests:rows.length,completed:complete.length,failed:rows.filter(r=>r.status==='failed').length,totalTokens:known.length?sum(known,'totalTokens'):null,inputTokens:complete.some(r=>r.inputTokens!==null)?sum(complete,'inputTokens'):null,outputTokens:complete.some(r=>r.outputTokens!==null)?sum(complete,'outputTokens'):null,tokenReported:known.length,tokenMissing:complete.length-known.length,
      medianMs:percentile(durations,.5),p95Ms:percentile(durations,.95),executionMs:sum(complete,'executionMs'),decodeTps:percentile(complete.filter(r=>r.task==='chat').map(r=>r.decodeTps),.5),prefillTps:percentile(complete.filter(r=>r.task==='chat').map(r=>r.prefillTps),.5),images:sum(complete,'imageCount'),videos:sum(complete,'videoCount'),audioFiles:sum(complete,'audioCount')},activity,
    groups:[...groups.values()].map(g=>{const ok=g.records.filter(r=>r.status==='completed'),reported=ok.filter(r=>r.totalTokens!==null);return {task:g.task,model:g.model,count:g.records.length,completed:ok.length,tokenReported:reported.length,totalTokens:reported.length?sum(reported,'totalTokens'):null,medianMs:percentile(ok.map(r=>r.executionMs),.5),p95Ms:percentile(ok.map(r=>r.executionMs),.95),decodeTps:g.task==='chat'?percentile(ok.map(r=>r.decodeTps),.5):null,framesPerSecond:percentile(ok.map(r=>r.framesPerSecond),.5),audioRealtimeFactor:percentile(ok.map(r=>r.audioRealtimeFactor),.5),lastAt:g.records.at(-1)?.startedAt};}).sort((a,b)=>b.count-a.count),
    taskStats:Object.fromEntries([...new Set(rows.map(r=>r.task))].map(task=>{const r=complete.filter(r=>r.task===task);return [task,{medianMs:percentile(r.map(r=>r.executionMs),.5),p95Ms:percentile(r.map(r=>r.executionMs),.95),decodeTps:percentile(r.map(r=>r.decodeTps),.5),framesPerSecond:percentile(r.map(r=>r.framesPerSecond),.5),audioRealtimeFactor:percentile(r.map(r=>r.audioRealtimeFactor),.5)}];})),
    recent:[...rows].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,50),benchmarkCount:rows.filter(r=>r.benchmark).length,benchmarkRecords:complete.filter(r=>r.benchmark).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)).slice(-100),
    models:[...new Set(records.map(r=>r.model))].sort()};
}
export function metricsCSV(records){const keys=['id','startedAt','task','model','status','inputTokens','outputTokens','totalTokens','usageSource','executionMs','prepareMs','decodeTps','prefillTps','framesPerSecond','audioRealtimeFactor','benchmark','suite','legacy'];return [keys,...records.map(r=>keys.map(k=>r[k]??''))].map(row=>row.map(csvCell).join(',')).join('\r\n');}
export class MetricStore{
  constructor(directory){this.file=path.join(directory,'metrics.ndjson');this.records=[];this.ids=new Set();this.chain=Promise.resolve();}
  async load(){let text='';try{text=await fs.readFile(this.file,'utf8');if(process.platform!=='win32')await fs.chmod(this.file,0o600);}catch{}for(const line of text.split('\n')){try{const r=JSON.parse(line);if(r.id){if(this.ids.has(r.id))this.records[this.records.findIndex(row=>row.id===r.id)]=r;else{this.records.push(r);this.ids.add(r.id);}}}catch{}}if(text&&!text.endsWith('\n'))await fs.appendFile(this.file,'\n',{mode:0o600});return this;}
  async add(record){this.chain=this.chain.catch(()=>{}).then(async()=>{if(this.ids.has(record.id))return;await fs.appendFile(this.file,JSON.stringify(record)+'\n',{mode:0o600});this.records.push(record);this.ids.add(record.id);});return this.chain;}
  async update(record){this.chain=this.chain.catch(()=>{}).then(async()=>{const index=this.records.findIndex(r=>r.id===record.id);if(index<0)throw new Error('Measurement not found.');await fs.appendFile(this.file,JSON.stringify(record)+'\n',{mode:0o600});this.records[index]=record;});return this.chain;}
}
