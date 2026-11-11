import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {tasks} from '../core.mjs';

test('all multimodal adapters preserve their request and output contracts',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),data=await fs.mkdtemp(path.join(root,'test','.runtime-'));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=','base64');
  const wav=Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
  const models=Object.entries(tasks).map(([k,v])=>({id:'fixture/'+k,model_id:'fixture/'+k,name:k,type:v.types[0],input:k==='chat'?'Text,Image':'Text',output:v.output,npu_usage:0}));
  const seen=new Set();
  let asrLoaded=true,previewRequests=0;
  const device=http.createServer(async(req,res)=>{
    const parts=[];for await(const p of req)parts.push(p);const raw=Buffer.concat(parts),url=new URL(req.url,'http://fixture'),p=url.pathname;
    const json=j=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(j));};
    const binary=(b,m)=>{res.setHeader('content-type',m);res.end(b);};
    assert.equal(req.headers.authorization,'Bearer adapter-key');
    if(p==='/api/v1/models/online_models')return json(models);
    if(p==='/api/v1/models/')return json({data:models});
    if(p==='/v1/models')return json({data:models.filter(model=>asrLoaded||model.id!=='fixture/asr')});
    if(p==='/api/v1/npu/status')return json({devices:[]});
    if(p==='/v1/music/info')return json({model_info:{model:{supported_generation_types:['mixed']}},default_config:{generation_type:'mixed'}});
    if(p==='/v1/chat/completions'){seen.add('chat');assert.equal(JSON.parse(raw).model,'fixture/chat');return json({choices:[{message:{content:'Hello from the device.'}}]});}
    if(p==='/v1/images/generations'){seen.add('image');assert.equal(JSON.parse(raw).size,'512x512');return json({data:[{b64_json:png.toString('base64')}],usage:{input_tokens:10,output_tokens:90,total_tokens:100}});}
    if(p==='/v1/image/generate'){seen.add('edit');assert.match(JSON.parse(raw).image,/^data:image/);res.setHeader('X-Token-Usage',JSON.stringify({input_tokens:5,output_tokens:45,total_tokens:50}));return binary(png,'image/png');}
    if(p==='/v1/audio/transcriptions'){seen.add('asr');if(raw.includes(Buffer.from('preview.wav')))previewRequests++;assert.match(req.headers['content-type'],/multipart/);assert.ok(raw.includes(Buffer.from('RIFF')));return json({text:'A transcribed sentence.'});}
    if(p==='/v1/audio/speech'){seen.add('speech');return json({success:true,audio_data:wav.toString('base64')});}
    if(p==='/v1/music/generate/wav'){seen.add('music');const b=JSON.parse(raw);assert.equal(b.config.generation_type,'mixed');assert.equal(b.config.lyric_text,'[instrumental]');return binary(wav,'audio/wav');}
    if(p==='/v1/ocr'){seen.add('ocr');assert.equal(url.searchParams.get('model'),'fixture/ocr');assert.equal(JSON.parse(raw).model,undefined);return json({data:[{text:'Invoice 1042'}]});}
    if(p==='/v1/embeddings'){seen.add('embed');return json({data:[{embedding:[.1,.2,.3]}]});}
    if(p==='/v1/rerank'){seen.add('rerank');assert.equal(JSON.parse(raw).documents.length,2);return json({results:[{index:0,relevance_score:.99}]});}
    if(p==='/v1/systemone'){seen.add('decision');return json({answers:{route:{choice:'billing'}}});}
    if(p==='/v1/videos'&&req.method==='POST'){seen.add('video');return json({id:'video_fixture',status:'completed',progress:100,frames:22,width:832,height:480,fps:24,seconds:'0.875',usage:{input_tokens:20,output_tokens:180,total_tokens:200}});}
    if(p==='/v1/videos/video_fixture/content'){const b=Buffer.alloc(16);b.write('ftyp',4);return binary(b,'video/mp4');}
    if(p==='/v1/3d/tasks'&&req.method==='POST'){seen.add('mesh');return json({data:{task_id:'mesh_fixture',status:'completed'}});}
    if(p==='/v1/3d/tasks/mesh_fixture/artifacts')return json({data:{artifacts:[{artifact_id:'shape',filename:'shape.glb'}]}});
    if(p==='/v1/3d/tasks/mesh_fixture/artifacts/shape'){const b=Buffer.alloc(16);b.write('glTF');return binary(b,'application/octet-stream');}
    res.statusCode=404;json({error:'Unknown fixture route '+p});
  });await new Promise(r=>device.listen(0,'127.0.0.1',r));
  const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,SPINDLE_PORT:'18439',SPINDLE_DATA_DIR:data,TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'adapter-key'},stdio:'ignore'}),base='http://127.0.0.1:18439';
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await pause(100);}
    const home=await fetch(base),cookie=home.headers.get('set-cookie').split(';')[0];
    const get=route=>fetch(base+route,{headers:{cookie}});await get('/api/state');
    const image={name:'fixture.png',data:'data:image/png;base64,'+png.toString('base64')},audio={name:'fixture.wav',data:'data:audio/wav;base64,'+wav.toString('base64')};
    const preview=()=>fetch(base+'/api/meeting/preview',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({model:'fixture/asr',file:{...audio,name:'preview.wav'}})});
    asrLoaded=false;
    assert.deepEqual(await (await preview()).json(),{status:'unloaded'});
    assert.equal(previewRequests,0);
    asrLoaded=true;
    const previewResult=await preview();
    assert.equal(previewResult.status,200);
    assert.deepEqual(await previewResult.json(),{status:'ready',text:'A transcribed sentence.'});
    assert.equal(previewRequests,1);
    assert.deepEqual(await (await get('/api/runs')).json(),[]);
    assert.deepEqual(await fs.readdir(path.join(data,'assets')),[]);
    const steps=Object.keys(tasks).map(task=>({task,model:'fixture/'+task,prompt:'Test input',params:task==='image'?{width:512,height:512}:{},documents:task==='rerank'?['Relevant','Unrelated']:undefined,file:['ocr','mesh'].includes(task)?image:task==='asr'?audio:undefined}));
    steps.push({task:'image',model:'fixture/image',prompt:'Edit this image',file:image,params:{}});
    const created=await(await fetch(base+'/api/run',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({steps})})).json();
    let job;for(let i=0;i<200;i++){job=(await(await get('/api/runs')).json()).find(j=>j.id===created.id);if(['completed','failed'].includes(job.status))break;await pause(40);}
    assert.equal(job.status,'completed',job.error);assert.equal(job.outputs.length,12);assert.equal(seen.size,12);
    assert.equal(job.outputs.find(o=>o.task==='ocr').text,'Invoice 1042');
    assert.equal(job.outputs.find(o=>o.task==='mesh').assets[0].mime,'model/gltf-binary');
    assert.equal(job.outputs.find(o=>o.task==='speech').assets[0].mime,'audio/wav');
    const history=await(await get('/api/metrics?days=0')).json();
    assert.equal(history.totals.totalTokens,350);assert.equal(history.totals.tokenReported,3);assert.equal(history.totals.tokenMissing,9);
    const video=history.recent.find(r=>r.task==='video');assert.equal(video.totalTokens,200);assert.equal(video.media.frames,22);assert.equal(video.media.width,832);
    assert.equal(history.recent.find(r=>r.task==='image'&&r.totalTokens===100).media.width,1);
    assert.ok(history.recent.every(r=>r.executionMs>=0));
    const imageExport=await(await get('/metrics.json?days=0&task=image')).json();assert.equal(imageExport.records.length,2);assert.equal(imageExport.totals.totalTokens,150);
    const csv=await(await get('/metrics.csv?days=0&task=video')).text();assert.ok(csv.includes('200'));assert.ok(!csv.includes('fixture/image'));
    const benchmark=await(await fetch(base+'/api/benchmark',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({model:'fixture/chat',repeats:1})})).json();
    assert.equal(benchmark.benchmark,true);assert.equal(benchmark.steps[0].params.max_tokens,128);assert.equal(benchmark.switchModels,false);
    for(let i=0;i<100;i++){const stats=await(await get('/api/metrics?days=0&benchmarks=true')).json();if(stats.benchmarkCount){assert.equal(stats.benchmarkCount,1);assert.equal(stats.recent[0].suite,'spindle-text-v1');break;}if(i===99)assert.fail('Benchmark measurement missing');await pause(40);}
    const checked=await(await fetch(base+'/api/check',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({task:'embed',model:'fixture/embed',switchModels:false})})).json();
    let readiness;for(let i=0;i<100;i++){readiness=await(await get('/api/readiness')).json();if(readiness.checks.some(c=>c.runId===checked.id))break;await pause(40);}
    assert.equal(readiness.checks.find(c=>c.runId===checked.id).status,'passed');
  }finally{proc.kill();await new Promise(r=>proc.once('exit',r));await new Promise(r=>device.close(r));assert.ok(data.startsWith(path.join(root,'test')+path.sep));await fs.rm(data,{recursive:true,force:true});}
});
