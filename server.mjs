import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {tasks,list,normalize,csv,parseDataUrl,validatePCM,transcriptionPCM,expandPrompt} from './core.mjs';
import {normalizeConnection,deviceURL,publicConnection} from './connection.mjs';
import {cleanHardware,requestAccess,redactError} from './security.mjs';
import {MetricStore,usageFrom,mergeUsage,mediaFromBuffer,mediaFromResponse,createMetric,summarize,filterMetrics,summarizeResources,metricsCSV} from './metrics.mjs';
import {chatSettings,readChatResponse} from './chat.mjs';
import {searchWeb,searchContext} from './web-search.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)), DATA=process.env.SPINDLE_DATA_DIR || path.join(ROOT,'data');
await fs.mkdir(DATA,{recursive:true,mode:0o700}); await fs.mkdir(path.join(DATA,'assets'),{recursive:true,mode:0o700});
if(process.platform!=='win32'){await fs.chmod(DATA,0o700);await fs.chmod(path.join(DATA,'assets'),0o700);}
const PORT=Number(process.env.SPINDLE_PORT || 8437), HOST='127.0.0.1';
const configPath=process.env.TIINY_CONFIG || path.join(os.homedir(),'.local','tiiny','config.json');
const secret=randomBytes(24).toString('hex');
let cached=null, jobs=[], workflows=[], active=false, saveChain=Promise.resolve(), refreshPromise=null;
const controllers=new Map();
let sessionConnection=null;
let searchKey=''; // Brave credentials are session-only, never part of runs or release data.
const metricStore=await new MetricStore(DATA).load();
let telemetry=[],telemetryPromise=null,ledgerCache=null,ledgerPromise=null;
async function readJSON(file,fallback){try{return JSON.parse(await fs.readFile(path.join(DATA,file),'utf8'));}catch{return fallback;}}
async function writeJSON(file,value){const f=path.join(DATA,file);await fs.writeFile(f+'.tmp',JSON.stringify(value,null,2),{mode:0o600});if(process.platform!=='win32')await fs.chmod(f+'.tmp',0o600);await fs.rename(f+'.tmp',f);}
jobs=await readJSON('runs.json',[]);workflows=await readJSON('workflows.json',[]);
for(const j of jobs)if(['running','queued'].includes(j.status)){j.status='interrupted';j.error='The local server restarted. Rerun explicitly to continue.';}
await writeJSON('runs.json',jobs);
async function configInfo(){
  let c={};try{c=JSON.parse(await fs.readFile(configPath,'utf8'));}catch{}
  if(process.env.TIINY_HOST||process.env.TIINY_KEY)return {connection:normalizeConnection({endpoint:process.env.TIINY_HOST || c.deviceAddress,key:process.env.TIINY_KEY || c.account?.authKey}),source:'Environment',remembered:false};
  if(sessionConnection)return {connection:sessionConnection,source:'Spindle session',remembered:false};
  const saved=await readJSON('connection.json',null);
  if(saved)return {connection:normalizeConnection(saved),source:'Saved in Spindle',remembered:true};
  if(c.deviceAddress&&c.account?.authKey)return {connection:normalizeConnection({endpoint:c.deviceAddress,key:c.account.authKey}),source:'Tiiny CLI',remembered:true};
  return {connection:null,source:'Not connected',remembered:false};
}
async function config(){const info=await configInfo();if(!info.connection)throw new Error('Connect your Tiiny in Connection settings to get started.');return info.connection;}
async function remote(route,{method='GET',body,transport='native',signal,timeout=1800000,connection}={}){
  const c=connection || await config();
  const headers={Authorization:'Bearer '+c.key,...(c.hostRouting?{Host:transport==='openai'?'openai.api.tiiny':transport==='control'?'api.tiiny':'p8800.api.tiiny'}:{})};
  let payload=body;
  if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  const timeoutSignal=AbortSignal.timeout(timeout);
  const r=await fetch(deviceURL(c,route,transport),{method,headers,body:payload,signal:signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal,redirect:'error'});
  if(!r.ok){let msg=await r.text();try{const j=JSON.parse(msg);msg=j.error?.message || (typeof j.error==='string'?j.error:null) || j.message || (typeof j.detail==='string'?j.detail:null) || msg;}catch{}throw new Error('Tiiny '+r.status+': '+redactError(msg,[c.key]).slice(0,1200));}
  return r;
}
async function remoteJSON(route,opts){try{return await(await remote(route,opts)).json();}catch(e){const c=opts?.connection || await config().catch(()=>null);throw new Error(redactError(e,[c?.key]));}}
const cleanNpu=cleanHardware;
async function inventory(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=readInventory();try{return await refreshPromise;}finally{refreshPromise=null;}
}
async function readInventory(){
  const result=await Promise.allSettled([
    remoteJSON('/api/v1/models/online_models',{timeout:15000}),remoteJSON('/api/v1/models/',{timeout:15000}),
    remoteJSON('/v1/models',{transport:'openai',timeout:15000}),remoteJSON('/api/v1/npu/status',{timeout:15000})]);
  if(result[1].status!=='fulfilled'||result[2].status!=='fulfilled')throw new Error(result.filter(x=>x.status==='rejected').map(x=>x.reason.message).join('; '));
  const oldStore=cached?.rawStore || [];
  const store=result[0].status==='fulfilled'?result[0].value:oldStore;
  const models=normalize(store,result[1].value,result[2].value);
  const now=new Date().toISOString();
  const previous=cached?.models || (await readJSON('catalog.json',{})).models || [];
  const before=new Set(previous.map(m=>m.id));const after=new Set(models.map(m=>m.id));
  cached={models,rawStore:store,syncedAt:now,storeSyncedAt:result[0].status==='fulfilled'?now:cached?.storeSyncedAt || null,
    storeError:result[0].status==='rejected'?result[0].reason.message:null,
    changes:{added:models.filter(m=>!before.has(m.id)).map(m=>m.id),removed:previous.filter(m=>!after.has(m.id)).map(m=>m.id)},
    npu:result[3].status==='fulfilled'?cleanNpu(result[3].value):null,npuError:result[3].status==='rejected'?result[3].reason.message:null};
  await writeJSON('catalog.json',publicState());await fs.writeFile(path.join(DATA,'catalog.csv'),csv(models),{mode:0o600});
  return publicState();
}
function publicState(){if(!cached)return null;return {...(process.env.SPINDLE_DEMO==='1'?{demo:true}:{}),models:cached.models,syncedAt:cached.syncedAt,storeSyncedAt:cached.storeSyncedAt,storeError:cached.storeError,changes:cached.changes,npu:cached.npu,npuError:cached.npuError,tasks};}
function textOf(j){return j?.choices?.[0]?.message?.content || j?.text || j?.data?.text || j?.result?.text || (Array.isArray(j?.data)?j.data.map(x=>x.text || '').filter(Boolean).join('\n'):null) || null;}
async function asset(buffer,mime,label='output'){
  if(buffer.subarray(0,4).toString()==='RIFF'&&buffer.subarray(8,12).toString()==='WAVE')mime='audio/wav';
  else if(buffer.subarray(0,4).toString()==='glTF')mime='model/gltf-binary';
  else if(buffer.subarray(4,8).toString()==='ftyp')mime='video/mp4';
  else if(buffer[0]===137&&buffer.subarray(1,4).toString()==='PNG')mime='image/png';
  else if(buffer[0]===255&&buffer[1]===216)mime='image/jpeg';
  else if(buffer.subarray(0,3).toString()==='ID3')mime='audio/mpeg';
  const ext=({'image/png':'png','image/jpeg':'jpg','audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','video/mp4':'mp4','model/gltf-binary':'glb','application/zip':'zip','application/json':'json'})[mime.split(';')[0]] || 'bin';
  const name=randomUUID()+'.'+ext;await fs.writeFile(path.join(DATA,'assets',name),buffer,{mode:0o600});
  return {url:'/assets/'+name,mime,label,metadata:mediaFromBuffer(buffer,mime)};
}
async function consume(r){
  const mime=r.headers.get('content-type') || 'application/octet-stream';
  if(mime.includes('json')){
    const j=await r.json(); const images=Array.isArray(j?.data)?j.data.filter(x=>x.b64_json):[];
    if(j.success===false||j.error)throw new Error(typeof j.error==='string'?j.error:j.error?.message || 'The model returned an unsuccessful response.');
    if(images.length)return {assets:await Promise.all(images.map(image=>asset(Buffer.from(image.b64_json,'base64'),'image/png'))),text:'Image generated.',metrics:usageFrom(j,r.headers),media:mediaFromResponse(j,r.headers)};
    for(const k of ['audio_data','audio_base64','audio','wav']){
      const value=j[k] || j.data?.[k];
      if(typeof value==='string'&&value.length>32){const buffer=Buffer.from(value.replace(/^data:[^,]+,/,''),'base64');if(buffer.subarray(0,4).toString()==='RIFF'||buffer.subarray(0,3).toString()==='ID3')return {assets:[await asset(buffer,'audio/wav')],text:'Audio saved locally.',metrics:usageFrom(j,r.headers),media:mediaFromResponse(j,r.headers)};}
    }
    return {text:textOf(j) || JSON.stringify(j,null,2),json:j,assets:[],metrics:usageFrom(j,r.headers),media:mediaFromResponse(j,r.headers)};
  }
  return {assets:[await asset(Buffer.from(await r.arrayBuffer()),mime)],text:'Output saved locally.',metrics:usageFrom({},r.headers),media:mediaFromResponse({},r.headers)};
}
async function sleep(ms,signal){await new Promise((resolve,reject)=>{signal?.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(new Error('Run stopped.'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});}
async function waitModel(id,expected){
  for(let i=0;i<150;i++){
    const j=await remoteJSON('/api/v1/models/npu/status',{timeout:15000});
    const row=j.models?.find(m=>m.model_id===id);
    if(expected?row?.status==='running':!row){if(expected)await sleep(2000);return;}
    if(row&&['error','failed'].includes(row.status))throw new Error('Model failed to load: '+id);
    await sleep(2000);
  }throw new Error('Model state did not settle: '+id);
}
async function switchTo(id){
  const live=list(await remoteJSON('/v1/models',{transport:'openai',timeout:15000}));
  if(live.length===1&&live[0].id===id)return;
  try{
    const tj=await remoteJSON('/api/v1/tasks',{timeout:15000});
    const running=Array.isArray(tj)?tj:tj.tasks || tj.data?.tasks || [];
    if(running.length)throw new Error('Tiiny has active tasks. Wait for them to finish before switching models.');
  }catch(e){
    if(!e.message.startsWith('Tiiny 404:'))throw e;
    // Older firmware has no tasks route. Fail if telemetry is absent or busy.
    let idle=0;
    for(let attempt=0;attempt<30;attempt++){
      const n=await remoteJSON('/api/v1/npu/status',{timeout:15000});
      const activity=(n.devices || []).map(d=>d.util_percent).filter(v=>typeof v==='number');
      if(!activity.length)throw new Error('NPU activity is unavailable; model switching was stopped.');
      idle=activity.every(v=>v<=5)?idle+1:0;
      if(idle>=2)break;
      await sleep(1000);
    }
    if(idle<2)throw new Error('This firmware has no active-task listing and the NPU stayed busy. Wait for the device to be idle.');
  }
  for(const m of live)if(m.id!==id){await remote('/api/v1/models/'+encodeURIComponent(m.id)+'/stop',{method:'POST',body:{},timeout:300000});await waitModel(m.id,false);}
  if(!live.some(m=>m.id===id)){await remote('/api/v1/models/'+encodeURIComponent(id)+'/start',{method:'POST',body:{},timeout:300000});await waitModel(id,true);}
}
async function execute(step,signal,job){
  const t=tasks[step.task];if(!t)throw new Error('Unknown task.');
  let model=cached?.models.find(m=>m.id===step.model);
  if(!model||!model.tasks.includes(step.task))throw new Error('Choose a model compatible with this task.');
  const live=list(await remoteJSON('/v1/models',{transport:'openai',timeout:15000}));
  if(!live.some(m=>m.id===model.id))throw new Error(model.name+' is not loaded. Load it in Models, then run again. Spindle never evicts other models automatically.');
  const {_spindlePreview,...p}=step.params || {}, prompt=step.prompt || '', file=step.file;
  let webSearch=null;
  let route=t.route,body,transport=t.transport || 'native';
  if(step.task==='chat'){
    const message={role:'user',content:file?[{type:'text',text:prompt},{type:'image_url',image_url:{url:file.data}}]:prompt};
    if(file&&!String(model.input).includes('Image'))throw new Error('This model does not report image input support.');
    if(p._spindleWebSearch?.enabled){
      job.phase='Searching the web';await saveJobs();
      webSearch=await searchWeb({...p._spindleWebSearch,query:p._spindleWebSearch.query || prompt,key:searchKey,signal});
      job.phase='Generating answer with web sources';
      job.partial={task:'chat',model:model.id,text:'',reasoning:'',webSearch};await saveJobs();
    }
    body={...chatSettings(p,model),model:model.id,messages:[...(webSearch?[searchContext(webSearch)]:[]),...(step.messages || []).map(({role,content})=>({role,content})),message]};
  }else if(step.task==='image'){
    if(file)body={model:model.id,prompt,image:file.data,...p};
    else{
      const {width,height,...rest}=p;
      route='/v1/images/generations';transport='openai';
      body={model:model.id,prompt,response_format:'b64_json',...rest,...(width&&height?{size:width+'x'+height}:{})};
    }
  }
  else if(step.task==='speech')body={model:model.id,input:prompt,response_format:'wav',...p};
  else if(step.task==='music'){
    const music={caption:prompt,generation_type:p.lyrics?.trim()?'mixed':'bgm',...p};
    if(!p.generation_type){
      const info=await remoteJSON('/v1/music/info?model='+encodeURIComponent(model.id),{signal});
      const supported=info.model_info?.model?.supported_generation_types || [];
      if(supported.length&&!supported.includes(music.generation_type))music.generation_type=info.default_config?.generation_type || supported[0];
      if(music.generation_type==='mixed'&&!music.lyrics?.trim())music.lyrics='[instrumental]';
    }
    body={model:model.id,config:music};
  }
  else if(step.task==='embed')body={model:model.id,input:prompt,...p};
  else if(step.task==='rerank')body={model:model.id,query:prompt,documents:step.documents || [],...p};
  else if(step.task==='decision')body={model:model.id,state:prompt,questions:p.questions || {route:{type:'choice',instructions:'Classify the request.',criteria:{general:null,technical:null,billing:null}}},...p};
  else if(step.task==='ocr'){
    parseDataUrl(file);route='/v1/ocr'+(model.id.includes('DocLayout')?'/layout':'')+'?model='+encodeURIComponent(model.id);body={input:file.data,response_format:'json',...p};
  }else if(step.task==='asr'){
    const normalized=transcriptionPCM(file);validatePCM(normalized);const f=parseDataUrl(normalized);body=new FormData();body.set('model',model.id);body.set('file',new Blob([f.buffer],{type:f.mime}),f.name);for(const [k,v]of Object.entries(p))body.set(k,String(v));
  }else if(step.task==='mesh'){
    const f=parseDataUrl(file);body=new FormData();body.set('model',model.id);body.set('stage',p.stage || 'shape');body.set('params',JSON.stringify(p.params || {}));body.set('image',new Blob([f.buffer],{type:f.mime}),f.name);
  }else if(step.task==='video'){
    if(_spindlePreview){
      const info=await remoteJSON('/v1/video/info?model='+encodeURIComponent(model.id),{signal});
      const canvas=info.canvases?.slice().sort((a,b)=>a.width*a.height-b.width*b.height)[0];
      if(info.family==='minimax_h3'&&canvas){Object.assign(p,canvas,{frames:17,fps:info.fps || 24,steps:Math.min(...(info.step_options || [info.default_steps || 4]))});delete p.seconds;delete p.size;}
    }
    if(file){const f=parseDataUrl(file);body=new FormData();body.set('model',model.id);body.set('prompt',prompt);body.set('input_reference',new Blob([f.buffer],{type:f.mime}),f.name);for(const [k,v]of Object.entries(p))body.set(k,String(v));}
    else body={model:model.id,prompt,...p};
  }
  // The selected model is always pinned, including advanced settings.
  if(!(body instanceof FormData)&&step.task!=='ocr')body.model=model.id;
  const r=await remote(route,{method:'POST',body,transport,signal});
  if(step.task==='chat'){
    let result;
    try{result=await readChatResponse(r,{signal,onUpdate:partial=>{
        job.partial={task:'chat',model:model.id,...partial,...(webSearch?{webSearch}:{})};
        job.phase=partial.text?'Writing answer':partial.reasoning?'Thinking':'Waiting for response';
      }});
    }catch(e){const c=await config();throw new Error(redactError(e,[c.key,searchKey]));}
    delete job.partial;
    return {...result,responseLimit:body.max_tokens ?? body.max_completion_tokens ?? null,assets:[],metrics:usageFrom(result.json,r.headers),...(webSearch?{webSearch}:{})};
  }
  if(step.task==='video'||step.task==='mesh'){
    let j=await r.json(),jobUsage=usageFrom(j,r.headers);const d=j.data || j,id=d.id || d.task_id;if(!id)throw new Error('Tiiny returned no job ID: '+JSON.stringify(j).slice(0,700));
    const base=step.task==='video'?'/v1/videos/':'/v1/3d/tasks/';
    job.remote={task:step.task,id,model:model.id};await saveJobs();
    for(let n=0;n<2400;n++){
      const v=j.data || j;job.progress=typeof v.progress==='number'&&Number.isFinite(v.progress)?Math.min(100,Math.max(0,v.progress)):null;job.remoteStatus=v.status;await saveJobs();
      if(['failed','error','cancelled','canceled'].includes(v.status))throw new Error(v.error?.message || JSON.stringify(v.error) || 'Device job failed.');
      if(['completed','finished'].includes(v.status)){
        if(step.task==='video'){const out=await consume(await remote(base+encodeURIComponent(id)+'/content',{signal}));out.metrics=mergeUsage(out.metrics,jobUsage);out.media={...out.media,...Object.fromEntries(Object.entries(mediaFromResponse(v)).filter(([,v])=>v!==null))};out.remoteJobId=id;delete job.remote;return out;}
        const aj=await remoteJSON(base+encodeURIComponent(id)+'/artifacts',{signal});
        const aa=Array.isArray(aj)?aj:aj.artifacts || aj.data?.artifacts || (Array.isArray(aj.data)?aj.data:null) || v.result?.output?.artifacts || [];
        const assets=[];for(const a of aa){const aid=a.artifact_id || a.id;if(!aid)continue;const ar=await remote(base+encodeURIComponent(id)+'/artifacts/'+encodeURIComponent(aid),{signal});assets.push(await asset(Buffer.from(await ar.arrayBuffer()),ar.headers.get('content-type') || 'model/gltf-binary',a.filename || a.name || '3D artifact'));}
        if(!assets.length)throw new Error('The 3D task completed without downloadable artifacts.');
        delete job.remote;return {text:'3D artifacts saved locally.',json:j,assets,metrics:jobUsage,remoteJobId:id};
      }
      await sleep(3000,signal);const statusResponse=await remote(base+encodeURIComponent(id),{signal});j=await statusResponse.json();jobUsage=mergeUsage(jobUsage,usageFrom(j,statusResponse.headers));
    }throw new Error('Job polling exceeded two hours.');
  }
  return consume(r);
}
async function saveJobs(){const snapshot=JSON.stringify(jobs,null,2);saveChain=saveChain.catch(()=>{}).then(()=>writeJSON('runs.json',JSON.parse(snapshot)));return saveChain;}
async function startQueue(){
  if(active)return;active=true;
  try{for(let job; (job=jobs.find(j=>j.status==='queued'));){
    const controller=new AbortController();let finalStatus='completed';controllers.set(job.id,controller);job.status='running';job.startedAt=new Date().toISOString();await saveJobs();
    try{if(job.switchModels){job.originalModels=list(await remoteJSON('/v1/models',{transport:'openai'})).map(m=>m.id);await saveJobs();}let previous=null;for(let i=0;i<job.steps.length;i++){
      controller.signal.throwIfAborted();job.currentStep=i;await saveJobs();
      const s=job.steps[i];let file=s.file || (s.fileFrom==='input'?job.file:null);
      if(s.fileFrom==='previous'){
        const a=previous?.assets?.find(a=>tasks[s.task].input==='audio'?a.mime.startsWith('audio/'):a.mime.startsWith('image/'));
        if(!a)throw new Error('Step '+(i+1)+' needs a compatible file from the previous step.');
        const bytes=await fs.readFile(path.join(DATA,'assets',path.basename(a.url)));file={name:path.basename(a.url),data:'data:'+a.mime+';base64,'+bytes.toString('base64')};
      }
      const step={...s,file,prompt:expandPrompt(s.prompt,job.input,previous)};
      const prepStarted=performance.now();
      if(job.switchModels){job.phase='Preparing '+(cached.models.find(m=>m.id===s.model)?.name || s.model);await saveJobs();await switchTo(s.model);}
      const prepareMs=performance.now()-prepStarted,startedAt=new Date().toISOString(),started=performance.now(),samples=[];
      let sampling=false;const sample=async()=>{if(sampling)return;sampling=true;try{samples.push(cleanNpu(await remoteJSON('/api/v1/npu/status',{timeout:4000})));}catch{}finally{sampling=false;}};
      void sample();const sampler=setInterval(()=>void sample(),2000);sampler.unref();
      job.phase='Running '+tasks[s.task].label.toLowerCase();await saveJobs();
      try{
        previous=await execute(step,controller.signal,job);const executionMs=performance.now()-started;
        previous.measurement={startedAt,finishedAt:new Date().toISOString(),executionMs,prepareMs,resources:summarizeResources(samples)};
        const output={task:s.task,model:s.model,...(s.task==='rerank'?{documents:s.documents}:{}),...previous};job.outputs.push(output);
        try{await metricStore.add(createMetric({job,step,index:i,output,...previous.measurement,connectionId:job.connectionId,model:cached.models.find(m=>m.id===s.model)}));}catch(e){job.metricsError=e.message;}
        await saveJobs();
      }catch(e){try{await metricStore.add(createMetric({job:{...job,status:controller.signal.aborted?'cancelled':'failed'},step,index:i,startedAt,finishedAt:new Date().toISOString(),executionMs:performance.now()-started,prepareMs,resources:summarizeResources(samples),connectionId:job.connectionId,model:cached.models.find(m=>m.id===s.model)}));}catch{}throw e;}
      finally{clearInterval(sampler);}
    }}catch(e){finalStatus=controller.signal.aborted?'cancelled':'failed';job.error=e.message;
      const index=job.currentStep || 0;if(job.steps[index]&&!metricStore.ids.has(job.id+':'+index))try{await metricStore.add(createMetric({job:{...job,status:finalStatus},step:job.steps[index],index,startedAt:job.startedAt,finishedAt:new Date().toISOString(),executionMs:null,prepareMs:null,connectionId:job.connectionId}));}catch(e){job.metricsError=e.message;}
    }
    finally{if(job.switchModels&&job.originalModels){try{
      job.phase='Restoring your loaded models';await saveJobs();
      const live=list(await remoteJSON('/v1/models',{transport:'openai'}));
      for(const m of live)if(!job.originalModels.includes(m.id)&&job.steps.some(s=>s.model===m.id)){await remote('/api/v1/models/'+encodeURIComponent(m.id)+'/stop',{method:'POST',body:{},timeout:300000});await waitModel(m.id,false);}
      for(const id of job.originalModels)if(!live.some(m=>m.id===id)){await remote('/api/v1/models/'+encodeURIComponent(id)+'/start',{method:'POST',body:{},timeout:300000});await waitModel(id,true);}
      job.restoredModels=true;
    }catch(e){job.restoreError='Model restoration needs attention: '+e.message;}}}
    job.status=finalStatus;job.finishedAt=new Date().toISOString();delete job.file;for(const s of job.steps){delete s.file;delete s.messages;}controllers.delete(job.id);await saveJobs();
    if(job.checkTask){
      const connection=await config(),report=await readJSON('readiness.json',{checks:[]});
      const checks=report.endpoint===connection.endpoint?report.checks:[];
      checks.push({task:job.checkTask,model:job.steps[0].model,status:finalStatus==='completed'?'passed':'failed',note:job.error || 'Sample completed and output saved locally.',runId:job.id,checkedAt:job.finishedAt});
      await writeJSON('readiness.json',{endpoint:connection.endpoint,checkedAt:job.finishedAt,checks:checks.slice(-100)});
    }
  }}finally{active=false;}
}
function redactJob(j){return {...j,file:undefined,steps:j.steps.map(s=>({...s,file:undefined,messages:undefined}))};}
async function jsonBody(req){let len=0;const parts=[];for await(const p of req){len+=p.length;if(len>90*1024*1024)throw new Error('Request too large.');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString() || '{}');}
function send(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function cancel(job){
  job.status='cancelled';controllers.get(job.id)?.abort();
  if(job.remote){const r=job.remote;await remote(r.task==='video'?'/v1/videos/'+encodeURIComponent(r.id):'/v1/3d/tasks/'+encodeURIComponent(r.id)+'/cancel',{method:r.task==='video'?'DELETE':'POST'});}
  else if(job.startedAt){const model=job.steps[job.currentStep || 0]?.model;if(model)await remote('/api/v1/models/'+encodeURIComponent(model)+'/interrupt',{method:'POST'});}
  await saveJobs();
}
const connectionHash=c=>createHash('sha256').update(c.endpoint).digest('hex').slice(0,20);
async function migrateMetrics(){
  for(const job of jobs){
    for(let i=0;i<job.outputs.length;i++){
      const output=job.outputs[i];
      const existing=metricStore.records.find(r=>r.id===job.id+':'+i);
      if(existing){
        let enriched={...existing};
        if(existing.legacy&&existing.recordVersion!==2)enriched={...enriched,recordVersion:2,prepareMs:null,profile:{...existing.profile,hasFile:job.steps[i].fileFrom&&job.steps[i].fileFrom!=='none'?true:null}};
        if(existing.videoCount&&!existing.media?.frames){for(const a of output.assets || [])if(a.mime.startsWith('video/'))try{
          const metadata=mediaFromBuffer(await fs.readFile(path.join(DATA,'assets',path.basename(a.url))),a.mime);
          if(metadata.frames)enriched={...enriched,media:{...metadata,...existing.media},framesPerSecond:existing.executionMs>0?metadata.frames/(existing.executionMs/1000):null};
        }catch{}}
        if(JSON.stringify(enriched)!==JSON.stringify(existing))await metricStore.update(enriched);
        continue;
      }
      for(const a of output.assets || [])if(!a.metadata&&(a.mime.startsWith('image/')||a.mime.startsWith('audio/')||a.mime.startsWith('video/'))){try{a.metadata=mediaFromBuffer(await fs.readFile(path.join(DATA,'assets',path.basename(a.url))),a.mime);}catch{}}
      const measured=output.measurement,legacyMs=!job.switchModels&&job.steps.length===1&&job.startedAt&&job.finishedAt?Date.parse(job.finishedAt)-Date.parse(job.startedAt):null;
      const record=createMetric({job,step:job.steps[i],index:i,output,...(measured || {executionMs:legacyMs}),connectionId:job.connectionId || null,legacy:!measured});
      record.executionSource=measured?'Spindle step timer':legacyMs!==null?'Legacy single-step run timer':'Not measured';
      await metricStore.add(record);
    }
    if(['failed','cancelled','interrupted'].includes(job.status)&&!metricStore.ids.has(job.id+':'+(job.currentStep || 0))){const index=job.currentStep || 0;if(job.steps[index])await metricStore.add(createMetric({job,step:job.steps[index],index,connectionId:job.connectionId || null,legacy:true}));}
  }
}
await migrateMetrics();
telemetry=await readJSON('telemetry.json',[]);
let lastTelemetryWrite=0,storageCache=null;
async function liveTelemetry(){
  if(telemetryPromise)return telemetryPromise;
  const c=await config(),id=connectionHash(c),last=telemetry.at(-1);
  if(last?.connectionId===id&&Date.now()-Date.parse(last.at)<3500)return {...last,history:telemetry.filter(s=>s.connectionId===id).slice(-240)};
  telemetryPromise=(async()=>{
    const results=await Promise.allSettled([remoteJSON('/api/v1/npu/status',{timeout:5000}),remoteJSON('/api/v1/models/npu/status',{timeout:5000})]);
    if(results[0].status==='rejected')throw results[0].reason;
    if(!storageCache||storageCache.id!==id||Date.now()-storageCache.at>60000){try{const raw=await remoteJSON('/api/v1/sys/storage',{transport:'control',timeout:4000});storageCache={id,at:Date.now(),value:raw};}catch{storageCache={id,at:Date.now(),value:null};}}
    const n=cleanNpu(results[0].value),residency=results[1].status==='fulfilled'?results[1].value:null,devices=n.devices || [],used=devices.reduce((a,d)=>a+(d.mem_used_mb || 0),0),total=devices.reduce((a,d)=>a+(d.mem_total_mb || 0),0);
    const disk=storageCache.value?.disk || storageCache.value?.data || storageCache.value || {};
    const s={at:new Date().toISOString(),connectionId:id,npuActivity:devices.some(d=>typeof d.util_percent==='number')?Math.max(...devices.map(d=>d.util_percent || 0)):null,
      npuUsedMb:devices.length?used:null,npuTotalMb:devices.length?total:null,cpu:n.cpu?.total_percent??null,ram:n.memory?.usage_percent??null,
      npuReserved:residency?.npu_used??null,npuAvailable:residency?.npu_available??null,
      loaded:(residency?.models || []).map(m=>({id:m.model_id,npu:m.npu_usage,status:m.status})),
      diskTotal:disk.total_bytes??disk.total??null,diskUsed:disk.used_bytes??disk.used??null};
    telemetry.push(s);telemetry=telemetry.filter(t=>Date.now()-Date.parse(t.at)<86400000).slice(-3000);
    if(Date.now()-lastTelemetryWrite>60000){lastTelemetryWrite=Date.now();await writeJSON('telemetry.json',telemetry);}
    return {...s,history:telemetry.filter(t=>t.connectionId===id).slice(-240)};
  })();try{return await telemetryPromise;}finally{telemetryPromise=null;}
}
async function deviceLedger(startDate){
  const c=await config(),id=connectionHash(c),key=id+':'+startDate;
  if(ledgerCache?.key===key&&Date.now()-ledgerCache.at<60000)return ledgerCache.value;
  if(ledgerPromise)return ledgerPromise;
  ledgerPromise=(async()=>{
    const result=await Promise.allSettled([remoteJSON('/api/v1/statistics/week_usage?start_date='+startDate,{transport:'control',timeout:7000}),remoteJSON('/api/v1/statistics/app_week_usage?start_date='+startDate,{transport:'control',timeout:7000})]);
    const days=result[0].status==='fulfilled'?result[0].value:null,apps=result[1].status==='fulfilled'?result[1].value:null;
    let total=null;const models=Object.create(null);
    if(days&&typeof days==='object'){total=0;for(const [date,group]of Object.entries(days)){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!group||typeof group!=='object')continue;for(const [model,u]of Object.entries(group)){if(typeof u.total_tokens!=='number')continue;total+=u.total_tokens;const row=models[model] || {model,totalTokens:0,requests:0};row.totalTokens+=u.total_tokens;row.requests+=u.request_count || 0;models[model]=row;}}}
    const value={startDate,totalTokens:total,models:Object.values(models),apps:apps&&typeof apps==='object'?Object.entries(apps).map(([name,u])=>({name,totalTokens:typeof u.total_tokens==='number'?u.total_tokens:null})):[],updatedAt:new Date().toISOString(),error:result[0].status==='rejected'?result[0].reason.message:null};
    ledgerCache={key,at:Date.now(),value};return value;
  })();try{return await ledgerPromise;}finally{ledgerPromise=null;}
}
const server=http.createServer(async(req,res)=>{
  try{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const u=new URL(req.url,'http://127.0.0.1:'+PORT),p=u.pathname;
    const denied=requestAccess(req,{port:PORT,secret,pathname:p});if(denied){send(res,{error:denied.error},denied.status);return;}
    if(p==='/api/session'&&req.method==='GET'){
      res.setHeader('Set-Cookie','spindle='+secret+'; HttpOnly; SameSite=Strict; Path=/');send(res,{ok:true});return;
    }
    if(p==='/api/state'&&req.method==='GET'){
      try{send(res,await inventory());}catch(e){const saved=await readJSON('catalog.json',null);if(!saved)throw e;send(res,{...saved,offline:true,error:e.message});}return;
    }
    if(p==='/api/connection'&&req.method==='GET'){const i=await configInfo();send(res,publicConnection(i.connection,i.source,i.remembered));return;}
    if(['/api/connection','/api/connection/test'].includes(p)&&req.method==='POST'){
      if(active&&p==='/api/connection')throw new Error('Wait for the current run before changing a connection.');
      const b=await jsonBody(req),current=await configInfo();
      const candidate=normalizeConnection({...b,key:b.key || current.connection?.key});
      if(!b.key&&candidate.endpoint!==current.connection?.endpoint)throw new Error('Enter the key for the new endpoint. Existing keys are never forwarded to another endpoint automatically.');
      const live=await remoteJSON('/v1/models',{connection:candidate,transport:'openai',timeout:15000});
      if(!Array.isArray(live.data))throw new Error('The endpoint did not return an OpenAI-compatible model list.');
      if(p.endsWith('/test')){send(res,{ok:true,loadedModels:live.data.length});return;}
      if(process.env.TIINY_HOST||process.env.TIINY_KEY)throw new Error('Environment connection settings take precedence. Remove them before saving another connection.');
      if(b.remember){await writeJSON('connection.json',{endpoint:candidate.endpoint,nativeEndpoint:candidate.nativeBase,managementEndpoint:candidate.managementBase,hostRouting:candidate.hostRouting,key:candidate.key});sessionConnection=null;}
      else{sessionConnection=candidate;await fs.rm(path.join(DATA,'connection.json'),{force:true});}
      cached=null;send(res,{ok:true,...publicConnection(candidate,b.remember?'Saved in Spindle':'Spindle session',!!b.remember)});return;
    }
    if(p==='/api/connection/reset'&&req.method==='POST'){
      if(active)throw new Error('Wait for the current run before resetting the connection.');
      sessionConnection=null;await fs.rm(path.join(DATA,'connection.json'),{force:true});cached=null;send(res,{ok:true});return;
    }
    if(p==='/api/runs'&&req.method==='GET'){send(res,jobs.map(redactJob));return;}
    if(p==='/api/search/settings'&&req.method==='GET'){send(res,{braveKeyPresent:!!searchKey});return;}
    if(p==='/api/search/settings'&&req.method==='POST'){
      const b=await jsonBody(req);if(typeof b.key!=='string'||b.key.length>500)throw new Error('Enter a valid Brave Search key.');
      searchKey=b.key.trim();send(res,{braveKeyPresent:!!searchKey});return;
    }
    if(p==='/api/telemetry'&&req.method==='GET'){send(res,await liveTelemetry());return;}
    if(p==='/api/device-ledger'&&req.method==='GET'){
      const start=u.searchParams.get('start');if(!/^\d{4}-\d{2}-\d{2}$/.test(start || ''))throw new Error('Choose a valid week start.');send(res,await deviceLedger(start));return;
    }
    if((p==='/api/metrics'||p==='/metrics.csv'||p==='/metrics.json')&&req.method==='GET'){
      const c=await config(),id=connectionHash(c),records=metricStore.records.filter(r=>!r.connectionId||r.connectionId===id);
      const days=Number(u.searchParams.get('days') || 7),timeZone=u.searchParams.get('tz') || 'UTC';if(![0,7,30,90].includes(days))throw new Error('Choose a supported time range.');
      const options={days,timeZone,task:u.searchParams.get('task') || 'all',model:u.searchParams.get('model') || 'all',benchmarks:u.searchParams.get('benchmarks')==='true'},filtered=filterMetrics(records,options),result=summarize(records,options);
      if(p==='/metrics.csv'){res.writeHead(200,{'Content-Type':'text/csv','Cache-Control':'no-store','Content-Disposition':'attachment; filename="spindle-metrics.csv"'});res.end(metricsCSV(filtered));return;}
      if(p==='/metrics.json'){send(res,{...result,records:filtered});return;}
      send(res,{...result,legacyCount:records.filter(r=>r.legacy).length});return;
    }
    if(p==='/api/readiness'&&req.method==='GET'){
      const report=await readJSON('readiness.json',{checks:[]}),i=await configInfo();
      send(res,report.endpoint&&report.endpoint!==i.connection?.endpoint?{checks:[],note:'This connection has not been checked yet.'}:report);return;
    }
    if(p==='/api/workflows'&&req.method==='GET'){send(res,workflows);return;}
    if(p==='/api/workflows'&&req.method==='POST'){
      const w=await jsonBody(req);if(!w.name?.trim()||!Array.isArray(w.steps)||!w.steps.length)throw new Error('Give this workflow a name and at least one step.');
      const saved={id:workflows.some(x=>x.id===w.id)?w.id:randomUUID(),name:w.name,steps:w.steps.map(({task,model,prompt,params,fileFrom,documents})=>({task,model,prompt,params,fileFrom,documents})),updatedAt:new Date().toISOString()};
      workflows=workflows.filter(x=>x.id!==saved.id);workflows.push(saved);await writeJSON('workflows.json',workflows);send(res,saved);return;
    }
    if((p==='/api/run'||p==='/api/check'||p==='/api/benchmark')&&req.method==='POST'){
      if(!cached)await inventory();
      const b=await jsonBody(req);
      if(p==='/api/benchmark'){
        const count=Number(b.repeats || 3);if(![1,3,5].includes(count))throw new Error('Choose 1, 3, or 5 samples.');
        const live=list(await remoteJSON('/v1/models',{transport:'openai'}));const m=cached.models.find(m=>m.id===b.model&&m.tasks.includes('chat'));
        if(!m||!live.some(x=>x.id===m.id))throw new Error('Load a text or vision chat model before benchmarking.');
        b.name='Text benchmark · '+m.name;b.steps=Array.from({length:count},()=>({task:'chat',model:m.id,prompt:'Write a clear, factual guide to organizing a small community project. Explain planning, communication, and follow-through in connected prose.',params:{max_tokens:128,temperature:0,seed:42,...(m.thinking?.toggleable?{chat_template_kwargs:{enable_thinking:false}}:{})}}));b.switchModels=false;b.benchmark=true;
      }
      if(p==='/api/check'){
        if(!tasks[b.task])throw new Error('Choose a capability to check.');
        const fixture=async(name,mime)=>({name,data:'data:'+mime+';base64,'+(await fs.readFile(path.join(ROOT,'fixtures',name))).toString('base64')});
        const sample={task:b.task,model:b.model,prompt:'Spindle keeps my ideas on my own device.',params:{}};
        if(b.task==='chat'){if(String(cached.models.find(m=>m.id===b.model)?.input).includes('Image')){sample.prompt='Describe the shape and colors in this image in one sentence.';sample.file=await fixture('star.png','image/png');}sample.params={max_tokens:100,...(cached.models.find(m=>m.id===b.model)?.thinking?.toggleable?{chat_template_kwargs:{enable_thinking:false}}:{})};}
        if(b.task==='image'){sample.prompt='A bright green geometric star on a dark green background, no text';sample.params={width:512,height:512,steps:8};}
        if(b.task==='asr')sample.file=await fixture('speech.wav','audio/wav');
        if(b.task==='ocr')sample.file=await fixture('document.png','image/png');
        if(b.task==='mesh'){sample.file=await fixture('star.png','image/png');sample.params={params:{inference_quality:'fast',output_precision:'draft'}};}
        if(b.task==='video'){sample.prompt='A bright green star gently rotates on a dark background.';sample.params={_spindlePreview:true};}
        if(b.task==='music'){sample.prompt='Gentle instrumental ambient piano';sample.params={seconds_total:10,steps:8};}
        if(b.task==='decision')sample.prompt='I was charged twice for my order.';
        if(b.task==='rerank'){sample.prompt='What is Spindle?';sample.documents=['Spindle is a local AI companion.','The weather is rainy today.'];}
        b.name='Readiness check · '+tasks[b.task].label;b.steps=[sample];b.checkTask=b.task;
      }
      if(!Array.isArray(b.steps)||!b.steps.length||b.steps.length>30)throw new Error('Runs need 1–30 steps.');
      for(const s of b.steps)if(!tasks[s.task]||!s.model)throw new Error('Every step needs a task and exact model ID.');
      for(const s of b.steps){const m=cached.models.find(m=>m.id===s.model);if(!m?.installed||!m.tasks.includes(s.task))throw new Error('Each step requires a downloaded model compatible with its task.');}
      const j={id:randomUUID(),name:b.name || tasks[b.steps[0].task].label,status:'queued',createdAt:new Date().toISOString(),input:b.input || '',file:b.file,steps:b.steps,outputs:[],currentStep:0,switchModels:b.switchModels===true,checkTask:p==='/api/check'?b.checkTask:undefined,benchmark:p==='/api/benchmark',connectionId:connectionHash(await config())};
      jobs.unshift(j); // FIFO is determined by timestamp below, despite newest-first display.
      const pending=jobs.filter(x=>x.status==='queued').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
      jobs=[...jobs.filter(x=>x.status!=='queued'),...pending];await saveJobs();send(res,redactJob(j),202);void startQueue();return;
    }
    if(p.startsWith('/api/cancel/')&&req.method==='POST'){const j=jobs.find(j=>j.id===p.split('/').pop());if(!j)throw new Error('Run not found.');await cancel(j);send(res,{ok:true});return;}
    if(p==='/api/model'&&req.method==='POST'){
      const {id,action}=await jsonBody(req);if(!['start','stop','download'].includes(action)||!cached?.models.some(m=>m.id===id))throw new Error('Unknown model action.');
      if(active&&['start','stop'].includes(action))throw new Error('Wait for the current run before changing loaded models.');
      await remote('/api/v1/models/'+encodeURIComponent(id)+'/'+action,{method:'POST',body:{},timeout:300000});if(action!=='download')await waitModel(id,action==='start');send(res,{ok:true});return;
    }
    if(p==='/api/runtime'){
      const kind=u.searchParams.get('task'),id=u.searchParams.get('model');if(!cached?.models.some(m=>m.id===id))throw new Error('Unknown model.');
      const route={image:'/v1/image/status',music:'/v1/music/info',video:'/v1/video/info',mesh:'/v1/3d/capabilities'}[kind];
      if(!route)throw new Error('No runtime inspection for this task.');send(res,await remoteJSON(route+'?model='+encodeURIComponent(id),{timeout:15000}));return;
    }
    let file,mime;
    if(['/samples/star.png','/samples/document.png','/samples/speech.wav'].includes(p)){file=path.join(ROOT,'fixtures',path.basename(p));mime=p.endsWith('.wav')?'audio/wav':'image/png';}
    else if(p==='/catalog.json'){file=path.join(DATA,'catalog.json');mime='application/json';}
    else if(p==='/catalog.csv'){file=path.join(DATA,'catalog.csv');mime='text/csv';}
    else if(/^\/assets\/[a-f0-9-]+\.[a-z0-9]+$/.test(p)){
      file=path.join(DATA,'assets',path.basename(p));mime=({'png':'image/png','jpg':'image/jpeg','wav':'audio/wav','mp3':'audio/mpeg','mp4':'video/mp4','glb':'model/gltf-binary','json':'application/json'})[p.split('.').pop()] || 'application/octet-stream';
    }else if(['/','/index.html','/app.js','/chat-ui.mjs','/styles.css','/experience.css','/effects.js','/audio.js','/guidance.mjs','/guidance.css','/dashboard.js','/dashboard.css','/favicon.svg'].includes(p)){
      file=path.join(ROOT,'public',p==='/'?'index.html':p.slice(1));mime=p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html';
    }else{send(res,{error:'Not found'},404);return;}
    const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      ...(p==='/'||p==='/index.html'?{'Set-Cookie':'spindle='+secret+'; HttpOnly; SameSite=Strict; Path=/'}:{})});res.end(bytes);
  }catch(e){const info=await configInfo().catch(()=>null);send(res,{error:redactError(e,[info?.connection?.key])},400);}
});
server.listen(PORT,HOST,()=>console.log('Spindle is ready at http://'+HOST+':'+PORT));
