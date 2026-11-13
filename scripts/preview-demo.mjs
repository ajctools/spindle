// Read-only illustration server. All models, usage, timings and telemetry are synthetic.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {tasks} from '../core.mjs';
import {createMetric,usageFrom} from '../metrics.mjs';
import {voiceReferenceSample} from '../public/guidance.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),data=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-demo-'));
await fs.mkdir(path.join(data,'assets'));const imageId=randomUUID()+'.png';await fs.copyFile(path.join(root,'fixtures','star.png'),path.join(data,'assets',imageId));
const names={chat:'Atlas · demo chat',image:'Prism · demo image',asr:'Listen · demo transcription',speech:'Voice · demo speech',music:'Score · demo music',video:'Motion · demo video',ocr:'Read · demo documents',mesh:'Shape · demo 3D',decision:'Route · demo classification',embed:'Index · demo embeddings',rerank:'Rank · demo relevance'};
const models=Object.entries(tasks).map(([key,t])=>({id:'demo/'+key,model_id:'demo/'+key,name:names[key],type:t.types[0],input:key==='chat'?'Text,Image':t.input,output:t.output,params:'Demo',npu_usage:key==='chat'?38:24,total_size:4*1073741824,...(key==='chat'?{context_window:65536}:{}),...(key==='speech'?{supported:['Voice Cloning']}:{}),owned_by:'Synthetic illustration',desc:'Fictional model used only to illustrate the interface. Not an available Tiiny model.'}));
const runs=[],records=[];
for(let day=6;day>=0;day--)for(let index=0;index<(7-day)*2+5;index++){
  const task=Object.keys(tasks)[index%11],started=new Date();started.setDate(started.getDate()-day);started.setHours(9+index%9,index*3%60,0,0);
  if(started>Date.now())started.setTime(Date.now()-1000*(index+1));
  const id=randomUUID(),duration={chat:3200,image:12000,asr:2400,speech:4000,music:18000,video:92000,ocr:1800,mesh:62000,decision:350,embed:220,rerank:180}[task]+index*53;
  const step={task,model:'demo/'+task,prompt:'Synthetic illustration. No real user input.',params:{...(task==='chat'?{max_tokens:128,temperature:0,seed:42}:{}),...(task==='image'?{width:512,height:512,steps:8}:{})}},benchmark=task==='chat'&&index%2===0;
  const job={id,name:benchmark?'Text baseline · synthetic':'Illustrative '+tasks[task].label,status:'completed',createdAt:started.toISOString(),startedAt:started.toISOString(),finishedAt:new Date(+started+duration).toISOString(),input:'Synthetic illustration.',steps:[step],switchModels:false,currentStep:0,benchmark};
  const usage=['chat','embed','decision'].includes(task)?{input_tokens:120+index*12,output_tokens:task==='chat'?128:0}:task==='image'&&index%2?{input_tokens:30,output_tokens:1800}:{};
  const output={task,model:step.model,text:task==='chat'?'A fictional project brief: choose one useful outcome, start small, and review the result.':task==='image'?'Synthetic example image.':'Illustrative record only. No real model ran and no audio or video was generated.',metrics:usageFrom({usage,timings:task==='chat'?{predicted_per_second:31+index*.31,prompt_per_second:165+index*3}:undefined}),assets:task==='image'?[{mime:'image/png',url:'/assets/'+imageId,metadata:{width:512,height:512}}]:[],media:task==='video'?{frames:24,width:640,height:360,fps:24,seconds:1}:['speech','music'].includes(task)?{seconds:10}:undefined};
  job.outputs=[output];runs.push(job);
  const metric=createMetric({job,step,index:0,output,executionMs:duration,prepareMs:0,startedAt:job.startedAt,finishedAt:job.finishedAt,connectionId:null,model:{version:'synthetic'}});
  // Illustration-only media counts: these records intentionally contain no playable media.
  if(task==='video')metric.videoCount=1;if(['speech','music'].includes(task)){metric.audioCount=1;metric.audioRealtimeFactor=10/(duration/1000);}
  records.push(metric);
}
const demoAudio=randomUUID()+'.wav',meetingId=randomUUID(),meetingDate=new Date(Date.now()-60000).toISOString();
await fs.copyFile(path.join(root,'fixtures',voiceReferenceSample.sample),path.join(data,'assets',demoAudio));
runs.unshift({
  id:meetingId,name:'Meeting · Observatory planning (demo)',status:'completed',createdAt:meetingDate,finishedAt:meetingDate,steps:[{task:'asr',model:'demo/asr'}],
  meeting:{recording:{url:'/assets/'+demoAudio,mime:'audio/wav'},duration:5.555,chunkSeconds:30},
  outputs:[{task:'asr',model:'demo/asr',text:voiceReferenceSample.refText,assets:[],json:{segments:[
    {start:0,text:'The observatory opens at dusk.',speaker:1},
    {start:2.2,text:'Bring a notebook and a red flashlight.',speaker:1},
  ]}}],
});
await fs.writeFile(path.join(data,'runs.json'),JSON.stringify(runs));await fs.writeFile(path.join(data,'metrics.ndjson'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
await fs.writeFile(path.join(data,'readiness.json'),JSON.stringify({checks:[]}));
const gateway=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');const route=new URL(req.url,'http://demo').pathname;
  if(req.method!=='GET'){res.writeHead(403);res.end(JSON.stringify({error:'Read-only demo. No real inference is available.'}));return;}
  let value;
  if(route==='/api/v1/models/online_models'||route==='/api/v1/models/')value={data:models};
  else if(route==='/v1/models')value={data:models.filter(m=>m.id==='demo/chat')};
  else if(route==='/api/v1/npu/status')value={devices:[{util_percent:17,mem_used_mb:19000,mem_total_mb:65536}],cpu:{total_percent:22},memory:{usage_percent:30}};
  else if(route==='/api/v1/models/npu/status')value={npu_used:38,npu_available:62,models:[{model_id:'demo/chat',npu_usage:38,status:'running'}]};
  else if(route==='/api/v1/sys/storage')value={total_bytes:1000*1073741824,used_bytes:360*1073741824};
  else if(route==='/api/v1/sys/ac_power/')value={ac_power:false};
  else if(route==='/api/v1/statistics/week_usage'){value={};for(let day=0;day<7;day++){const date=new Date();date.setDate(date.getDate()-day);value[date.toISOString().slice(0,10)]={'demo/chat':{total_tokens:24000-day*1600,request_count:12}};}}
  else if(route==='/api/v1/statistics/app_week_usage')value={'Demo client':{total_tokens:134400}};
  else{res.writeHead(404);value={error:'Read-only illustration route unavailable.'};}
  res.end(JSON.stringify(value));
});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
const env={...process.env,SPINDLE_PORT:process.env.SPINDLE_DEMO_PORT || '8438',SPINDLE_DATA_DIR:data,TIINY_CONFIG:path.join(data,'no-cli-config.json'),TIINY_HOST:'http://127.0.0.1:'+gateway.address().port,TIINY_KEY:'demo-only-not-a-real-device-key',SPINDLE_DEMO:'1'};
const app=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'inherit',windowsHide:true});
console.log('READ-ONLY DEMO: all models, usage and performance are fictional. No Tiiny connection is used.');
let stopping=false;async function stop(){if(stopping)return;stopping=true;app.kill();gateway.close();if(path.dirname(data)===path.resolve(os.tmpdir())&&path.basename(data).startsWith('spindle-demo-'))await fs.rm(data,{recursive:true,force:true});}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());app.on('exit',()=>void stop());
