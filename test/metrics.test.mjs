import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {usageFrom,mergeUsage,mediaFromResponse,mediaFromBuffer,createMetric,summarize,filterMetrics,MetricStore,metricsCSV} from '../metrics.mjs';

test('usage preserves missing versus zero, media headers, partial counts, and runtime timing',()=>{
  assert.equal(usageFrom({usage:{images:1}}).totalTokens,null);
  assert.equal(usageFrom({usage:{prompt_tokens:8}}).totalTokens,null);
  assert.equal(usageFrom({usage:{prompt_tokens:8,completion_tokens:0}}).totalTokens,8);
  assert.equal(usageFrom({usage:{total_tokens:0}}).totalTokens,0);
  const headers=new Headers({'X-Token-Usage':JSON.stringify({input_tokens:8,output_tokens:72,total_tokens:80})});
  assert.deepEqual([usageFrom({},headers).inputTokens,usageFrom({},headers).outputTokens,usageFrom({},headers).totalTokens],[8,72,80]);
  const timed=usageFrom({timings:{prompt_n:20,predicted_n:6,predicted_per_second:24,prompt_per_second:200}});
  assert.equal(timed.totalTokens,26);assert.equal(timed.decodeTps,24);
  const combined=mergeUsage(usageFrom({},headers),usageFrom({usage:{completion_tokens:72}}));
  assert.equal(combined.totalTokens,80);assert.equal(combined.inputTokens,8);
  assert.equal(mediaFromResponse({}).seconds,null);assert.equal(mediaFromResponse({seconds:null}).seconds,null);
  assert.equal(mediaFromResponse({seconds:'0.875',frames:22}).seconds,.875);
});

test('step records keep modality usage, timing boundaries and safe comparison settings',()=>{
  const record=createMetric({job:{id:'run',createdAt:'2026-11-09T15:00:00Z'},step:{task:'video',model:'model/video',params:{steps:4,prompt:'private',lyrics:'private'},file:{data:'private'}},index:0,
    output:{metrics:usageFrom({usage:{input_tokens:50,output_tokens:150,total_tokens:200}}),assets:[{mime:'video/mp4',metadata:{bytes:100}}],media:{frames:22,width:832,height:480,fps:24,seconds:.875}},executionMs:200000,prepareMs:30000});
  assert.equal(record.totalTokens,200);assert.equal(record.framesPerSecond,.11);assert.equal(record.executionMs,200000);assert.equal(record.prepareMs,30000);
  assert.equal(record.videoCount,1);assert.equal(record.media.frames,22);assert.deepEqual(record.profile,{params:{steps:4},hasFile:true});
  assert.equal(createMetric({job:{id:'old'},step:{task:'image',model:'m'},index:0,output:{assets:[{mime:'image/png'}]},executionMs:null,legacy:true}).totalTokens,null);
});

test('MP4 inspection reads video frames, resolution and duration from container metadata',()=>{
  const box=(type,body)=>{const b=Buffer.alloc(8+body.length);b.writeUInt32BE(b.length);b.write(type,4);body.copy(b,8);return b;};
  const tkhd=Buffer.alloc(84);tkhd.writeUInt32BE(832*65536,76);tkhd.writeUInt32BE(480*65536,80);
  const mdhd=Buffer.alloc(24);mdhd.writeUInt32BE(24000,12);mdhd.writeUInt32BE(22000,16);
  const hdlr=Buffer.alloc(20);hdlr.write('vide',8);const stsz=Buffer.alloc(12);stsz.writeUInt32BE(22,8);
  const mp4=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',box('trak',Buffer.concat([box('tkhd',tkhd),box('mdia',Buffer.concat([box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',box('stsz',stsz)))]))])))]);
  const metadata=mediaFromBuffer(mp4,'video/mp4');assert.equal(metadata.width,832);assert.equal(metadata.height,480);assert.equal(metadata.frames,22);assert.equal(metadata.fps,24);assert.equal(metadata.seconds,22/24);
  assert.doesNotThrow(()=>mediaFromBuffer(mp4.subarray(0,70),'video/mp4'));
});

test('history filters and percentiles include media tokens once and retain coverage',()=>{
  const base={status:'completed',startedAt:'2026-11-09T15:00:00Z',inputTokens:null,outputTokens:null,decodeTps:null,benchmark:false,model:'m'};
  const records=[{...base,id:'a',task:'chat',totalTokens:10,executionMs:1000,decodeTps:20},{...base,id:'b',task:'image',totalTokens:100,executionMs:9000,imageCount:1},{...base,id:'c',task:'video',totalTokens:null,executionMs:200000,videoCount:1},{...base,id:'d',task:'image',totalTokens:0,executionMs:3000,imageCount:1,benchmark:true}];
  const options={now:Date.parse('2026-11-09T19:00:00Z'),timeZone:'America/New_York'};
  const s=summarize(records,options);assert.equal(s.totals.totalTokens,110);assert.equal(s.totals.tokenReported,3);assert.equal(s.totals.tokenMissing,1);
  assert.equal(s.totals.images,2);assert.equal(s.totals.videos,1);assert.equal(s.totals.decodeTps,20);assert.equal(s.taskStats.image.medianMs,6000);assert.equal(s.taskStats.image.p95Ms,8700);
  assert.equal(filterMetrics(records,{...options,benchmarks:true}).length,1);
  assert.equal(summarize(records,{...options,task:'video'}).totals.totalTokens,null);
  assert.equal(summarize(records,{...options,timeZone:'invalid'}).timeZone,'UTC');
  assert.equal(filterMetrics(records,{...options,model:'other'}).length,0);
  assert.match(metricsCSV(records),/"c"[^\n]*"video"/);assert.ok(!metricsCSV(records).includes('null'));
  const nearMidnight={...base,task:'chat',totalTokens:1,startedAt:'2026-11-10T02:00:00Z'};
  assert.equal(filterMetrics([nearMidnight],{...options,now:Date.parse('2026-11-10T03:00:00Z')}).length,1);
});

test('daily cloud usage reconciles with the selected period as it rolls over at local midnight',()=>{
  const chat={status:'completed',task:'chat',model:'m',benchmark:true,profile:{hasFile:false}};
  const records=[
    {...chat,startedAt:'2026-11-04T14:00:00Z',inputTokens:100,outputTokens:200},
    {...chat,startedAt:'2026-11-07T14:00:00Z',inputTokens:10,outputTokens:null},
    {...chat,startedAt:'2026-11-11T04:59:00Z',inputTokens:30,outputTokens:40},
    {...chat,startedAt:'2026-11-11T04:59:00Z',inputTokens:50,outputTokens:60,benchmark:false},
    {...chat,startedAt:'2026-11-11T05:00:00Z',inputTokens:0,outputTokens:0},
  ];
  const options={days:7,timeZone:'America/New_York',benchmarks:true};
  const before=summarize(records,{...options,now:Date.parse('2026-11-11T04:59:00Z')});
  assert.deepEqual(before.period,{startDate:'2026-11-04',endDate:'2026-11-10'});
  assert.deepEqual(before.cloudUsage,{inputTokens:130,outputTokens:240,covered:2,completed:3,excluded:1});

  const now=Date.parse('2026-11-11T05:00:00Z');
  const after=summarize(records,{...options,now});
  assert.deepEqual(after.period,{startDate:'2026-11-05',endDate:'2026-11-11'});
  assert.deepEqual(after.cloudUsage,{inputTokens:30,outputTokens:40,covered:2,completed:3,excluded:1});
  assert.deepEqual(after.dailyCloudUsage,[
    {date:'2026-11-07',inputTokens:0,outputTokens:0,covered:0,completed:1,excluded:1},
    {date:'2026-11-10',inputTokens:30,outputTokens:40,covered:1,completed:1,excluded:0},
    {date:'2026-11-11',inputTokens:0,outputTokens:0,covered:1,completed:1,excluded:0},
  ]);
  const allTime=summarize(records,{...options,days:0,now});
  assert.deepEqual(allTime.period,{startDate:null,endDate:'2026-11-11'});
  assert.equal(allTime.cloudUsage.inputTokens,130);
});

test('measurement journal survives restart, duplicate writes and an interrupted final line',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-metrics-'));
  try{
    const store=await new MetricStore(directory).load();await Promise.all([store.add({id:'a',totalTokens:5}),store.add({id:'a',totalTokens:5})]);
    assert.equal(store.records.length,1);await fs.appendFile(store.file,'{"id":"partial');
    const reopened=await new MetricStore(directory).load();assert.equal(reopened.records.length,1);await reopened.add({id:'b',totalTokens:null});
    const again=await new MetricStore(directory).load();assert.deepEqual(again.records.map(r=>r.id),['a','b']);
    await again.update({id:'a',totalTokens:5,media:{frames:22}});const enriched=await new MetricStore(directory).load();assert.equal(enriched.records.length,2);assert.equal(enriched.records[0].media.frames,22);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
