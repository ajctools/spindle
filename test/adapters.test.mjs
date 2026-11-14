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
  const quietWav=Buffer.from(wav);
  wav.writeInt16LE(1234,44);
  const models=Object.entries(tasks).map(([k,v])=>({id:'fixture/'+k,model_id:'fixture/'+k,name:k,type:v.types[0],input:k==='chat'?'Text,Image':'Text',output:v.output,npu_usage:0}));
  const seen=new Set();
  const meetingLoaded=new Set(['fixture/asr']);
  let meetingMode=false;
  let asrLoaded=true,previewRequests=0,asrRequests=0,previewReply='A transcribed sentence.',holdPreview,startedPreview,summaryMessages,musicAttempts=0,emptyMeeting=false;
  const meshStages=[];
  const shapeBytes=Buffer.from('saved shape archive fixture');
  const device=http.createServer(async(req,res)=>{
    const parts=[];for await(const p of req)parts.push(p);const raw=Buffer.concat(parts),url=new URL(req.url,'http://fixture'),p=url.pathname;
    const json=j=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(j));};
    const binary=(b,m)=>{res.setHeader('content-type',m);res.end(b);};
    assert.equal(req.headers.authorization,'Bearer adapter-key');
    if(p==='/api/v1/models/online_models')return json(models);
    if(p==='/api/v1/models/')return json({data:models});
    if(p==='/v1/models')return json({data:models.filter(model=>meetingMode?meetingLoaded.has(model.id):asrLoaded||model.id!=='fixture/asr')});
    if(p==='/api/v1/tasks')return json({tasks:[]});
    if(p==='/api/v1/models/npu/status')return json({models:[...meetingLoaded].map(model_id=>({model_id,status:'running'}))});
    if(meetingMode&&/\/(start|stop)$/.test(p)){
      const id=decodeURIComponent(p.split('/').at(-2));
      if(p.endsWith('/start'))meetingLoaded.add(id);else meetingLoaded.delete(id);
      return json({ok:true});
    }
    if(p==='/api/v1/npu/status')return json({devices:[]});
    if(p==='/v1/music/info')return json({model_info:{model:{supported_generation_types:['mixed']}},default_config:{generation_type:'mixed',lyrics:''}});
    if(p==='/v1/chat/completions'){
      seen.add('chat');const body=JSON.parse(raw);assert.equal(body.model,'fixture/chat');
      const content=body.messages.at(-1).content;
      const prompt=Array.isArray(content)?content.find(item=>item.type==='text')?.text||'':content;
      if(prompt.startsWith('Summarize the meeting transcript'))summaryMessages=body.messages;
      if(prompt.startsWith('Describe the shape and colors')){
        assert.equal(body.max_tokens,8192);
        return json({choices:[{message:{content:'',reasoning_content:'Still thinking.'},finish_reason:'length'}]});
      }
      return json({choices:[{message:{content:'Hello from the device.'}}]});
    }
    if(p==='/v1/images/generations'){seen.add('image');assert.equal(JSON.parse(raw).size,'512x512');return json({data:[{b64_json:png.toString('base64')}],usage:{input_tokens:10,output_tokens:90,total_tokens:100}});}
    if(p==='/v1/image/generate'){seen.add('edit');assert.match(JSON.parse(raw).image,/^data:image/);res.setHeader('X-Token-Usage',JSON.stringify({input_tokens:5,output_tokens:45,total_tokens:50}));return binary(png,'image/png');}
    if(p==='/v1/audio/transcriptions'){
      seen.add('asr');asrRequests++;assert.match(req.headers['content-type'],/multipart/);assert.ok(raw.includes(Buffer.from('RIFF')));
      if(raw.includes(Buffer.from('preview.wav'))){
        previewRequests++;
        startedPreview?.();
        if(holdPreview)await holdPreview;
        return json({text:previewReply});
      }
      return json(emptyMeeting?{text:'',segments:[]}:{text:'A transcribed sentence.',segments:[{start:0,text:'A transcribed sentence.',speaker:'fixture voice'}]});
    }
    if(p==='/v1/audio/speech'){seen.add('speech');return json({success:true,audio_data:wav.toString('base64')});}
    if(p==='/v1/music/generate/wav'){
      seen.add('music');const b=JSON.parse(raw);
      if(b.config.caption==='Fixture lost response'){req.socket.destroy();return;}
      if(++musicAttempts===1){
        assert.equal(b.config.generation_type,'mixed');assert.equal(b.config.lyric_text,'[instrumental]');res.statusCode=400;
        return json({error:{message:'Extra inputs are not permitted in config: lyric_text'}});
      }
      assert.equal(musicAttempts,2);assert.equal(b.config.generation_type,'mixed');assert.equal(b.config.lyrics,'[instrumental]');assert.equal(b.config.lyric_text,undefined);
      return binary(wav,'audio/wav');
    }
    if(p==='/v1/ocr'){seen.add('ocr');assert.equal(url.searchParams.get('model'),'fixture/ocr');assert.equal(JSON.parse(raw).model,undefined);return json({data:[{text:'Invoice 1042'}]});}
    if(p==='/v1/embeddings'){seen.add('embed');return json({data:[{embedding:[.1,.2,.3]}]});}
    if(p==='/v1/rerank'){seen.add('rerank');assert.equal(JSON.parse(raw).documents.length,2);return json({results:[{index:0,relevance_score:.99}]});}
    if(p==='/v1/systemone'){seen.add('decision');return json({answers:{route:{choice:'billing'}}});}
    if(p==='/v1/videos'&&req.method==='POST'){seen.add('video');return json({id:'video_fixture',status:'completed',progress:100,frames:22,width:832,height:480,fps:24,seconds:'0.875',usage:{input_tokens:20,output_tokens:180,total_tokens:200}});}
    if(p==='/v1/videos/video_fixture/content'){const b=Buffer.alloc(16);b.write('ftyp',4);return binary(b,'video/mp4');}
    if(p.startsWith('/v1/3d/'))assert.equal(url.searchParams.get('model'),'fixture/mesh');
    if(p==='/v1/3d/capabilities')return json({data:{stages:['shape','texture','export'],input_refs:true,stage_specs:{
      texture:{required_inputs:['shape_artifact']},export:{required_inputs:['shape_artifact','material_artifact'],optional_inputs:['mesh_glb']}
    }}});
    if(p==='/v1/3d/tasks'&&req.method==='POST'){
      seen.add('mesh');
      const stage=raw.toString().match(/name="stage"\r\n\r\n(\w+)/)?.[1];
      meshStages.push(stage);
      if(stage==='shape')assert.ok(raw.includes('name="image"'));
      else{
        assert.ok(raw.includes('name="shape_artifact"'));
        assert.ok(raw.includes(shapeBytes));
        assert.ok(!raw.includes('name="image"'));
        if(stage==='export'){
          const refs=raw.toString().match(/name="input_refs"\r\n\r\n([^\r]+)/);
          assert.deepEqual(JSON.parse(refs[1]),{material_artifact:{task_id:'mesh_texture',artifact_id:'material'}});
        }
      }
      return json({data:{task_id:'mesh_'+stage,status:'completed'}});
    }
    if(p==='/v1/3d/tasks/mesh_shape/artifacts')return json({data:{artifacts:[
      {artifact_id:'preview',artifact_type:'shape_preview',filename:'shape.glb'},
      {artifact_id:'shape',artifact_type:'shape',filename:'shape.zip'}
    ]}});
    if(p==='/v1/3d/tasks/mesh_texture/artifacts')return json({artifacts:[{artifact_id:'material',artifact_type:'material',filename:'material.zip'}]});
    if(p==='/v1/3d/tasks/mesh_export/artifacts')return json({artifacts:[{artifact_id:'export',artifact_type:'mesh_glb',filename:'textured.glb'}]});
    if(p==='/v1/3d/tasks/mesh_shape/artifacts/shape')return binary(shapeBytes,'application/zip');
    if(p==='/v1/3d/tasks/mesh_texture/artifacts/material')return binary(Buffer.from('material archive fixture'),'application/zip');
    if(['/v1/3d/tasks/mesh_shape/artifacts/preview','/v1/3d/tasks/mesh_export/artifacts/export'].includes(p)){
      const b=Buffer.alloc(16);b.write('glTF');return binary(b,'application/octet-stream');
    }
    res.statusCode=404;json({error:'Unknown fixture route '+p});
  });await new Promise(r=>device.listen(0,'127.0.0.1',r));
  const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,SPINDLE_PORT:'18439',SPINDLE_DATA_DIR:data,TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'adapter-key'},stdio:'ignore'}),base='http://127.0.0.1:18439';
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await pause(100);}
    const home=await fetch(base),cookie=home.headers.get('set-cookie').split(';')[0];
    const get=route=>fetch(base+route,{headers:{cookie}});await get('/api/state');
    const image={name:'fixture.png',data:'data:image/png;base64,'+png.toString('base64')},audio={name:'fixture.wav',data:'data:audio/wav;base64,'+wav.toString('base64')};
    const preview=(model='fixture/asr',headers={cookie})=>fetch(base+'/api/meeting/preview',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({model,file:{...audio,name:'preview.wav'}})});
    assert.equal((await preview('fixture/asr',{})).status,403);
    assert.equal((await preview('fixture/asr',{cookie,origin:'https://fixture.invalid'})).status,403);
    assert.equal((await preview('fixture/chat')).status,400);
    asrLoaded=false;
    assert.deepEqual(await (await preview()).json(),{status:'unloaded'});
    assert.equal(previewRequests,0);
    asrLoaded=true;
    const previewResult=await preview();
    assert.equal(previewResult.status,200);
    assert.deepEqual(await previewResult.json(),{status:'ready',text:'A transcribed sentence.'});
    assert.equal(previewRequests,1);
    let release;
    holdPreview=new Promise(resolve=>{release=resolve;});
    const started=new Promise(resolve=>{startedPreview=resolve;});
    previewReply='the top of '.repeat(30);
    const processing=preview();
    try{
      await Promise.race([started,processing.then(()=>assert.fail('Preview never reached ASR'))]);
      assert.deepEqual(await (await preview()).json(),{status:'busy'});
      assert.equal(previewRequests,2);
    }finally{release();holdPreview=null;startedPreview=null;}
    assert.deepEqual(await (await processing).json(),{status:'unreliable'});
    previewReply='X'.repeat(300000);
    const limited=await preview();
    assert.equal(limited.status,400);
    assert.match((await limited.json()).error,/local size limit/);
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
    assert.equal(musicAttempts,2);
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
    const post=(route,body)=>fetch(base+route,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
    const waitForRun=async id=>{
      for(let i=0;i<200;i++){
        const run=(await (await get('/api/runs')).json()).find(item=>item.id===id);
        if(['completed','failed'].includes(run?.status))return run;
        await pause(40);
      }
      assert.fail('Run did not finish.');
    };
    const meshIndex=job.outputs.findIndex(o=>o.task==='mesh'),shape=job.outputs[meshIndex];
    assert.equal(shape.canApplyTexture,true);
    assert.deepEqual(meshStages,['shape']);
    assert.equal((await post('/api/mesh/texture',{id:job.id,step:0})).status,400);
    const texture=await post('/api/mesh/texture',{id:job.id,step:meshIndex});
    assert.equal(texture.status,202);
    const textured=await waitForRun((await texture.json()).id);
    assert.equal(textured.status,'completed',textured.error);
    assert.deepEqual(meshStages,['shape','texture','export']);
    assert.equal(textured.outputs[1].assets[0].mime,'model/gltf-binary');
    assert.equal(textured.outputs[1].canApplyTexture,false);
    assert.ok((await get(shape.assets[0].url)).ok);
    assert.ok((await get(textured.outputs[1].assets[0].url)).ok);
    const brokenMusic=await post('/api/run',{steps:[{task:'music',model:'fixture/music',prompt:'Fixture lost response'}]});
    assert.equal(brokenMusic.status,202);
    const musicFailure=await waitForRun((await brokenMusic.json()).id);
    assert.equal(musicFailure.status,'failed');
    assert.equal(musicFailure.audioFailure,'music-generation');
    assert.equal(musicAttempts,2);
    meetingMode=true;
    const asrBeforeQuiet=asrRequests;
    const quiet=await post('/api/meeting/transcribe',{model:'fixture/asr',file:{...audio,data:'data:audio/wav;base64,'+quietWav.toString('base64')}});
    assert.equal(quiet.status,202);
    const quietMeeting=await waitForRun((await quiet.json()).id);
    assert.equal(quietMeeting.status,'completed');
    assert.equal(quietMeeting.outputs[0].quiet,true);
    assert.equal(asrRequests,asrBeforeQuiet);
    emptyMeeting=true;
    const empty=await post('/api/meeting/transcribe',{model:'fixture/asr',file:audio});
    assert.equal(empty.status,202);
    const emptyRun=await waitForRun((await empty.json()).id);
    assert.equal(emptyRun.status,'completed');
    assert.equal(emptyRun.outputs[0].text,'');
    emptyMeeting=false;
    const recording=await post('/api/meeting/transcribe',{title:'Fixture meeting',model:'fixture/asr',file:audio});
    assert.equal(recording.status,202);
    const meeting=await waitForRun((await recording.json()).id);
    assert.equal(meeting.status,'completed',meeting.error);
    const recordingPath=meeting.meeting.recording.url;
    assert.equal((await get(recordingPath)).headers.get('content-type'),'audio/wav');
    const range=range=>fetch(base+recordingPath,{headers:{cookie,range}});
    const header=await range('bytes=0-3');
    assert.equal(header.status,206);assert.equal(header.headers.get('content-range'),'bytes 0-3/46');assert.equal(await header.text(),'RIFF');
    const tail=await range('bytes=-2');
    assert.equal(tail.headers.get('content-range'),'bytes 44-45/46');assert.equal((await tail.arrayBuffer()).byteLength,2);
    const invalid=await range('bytes=46-');
    assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */46');
    assert.equal((await fetch(base+recordingPath,{headers:{range:'bytes=0-3'}})).status,403);
    const request=await post('/api/meeting/summary',{id:meeting.id,model:'fixture/chat'});
    assert.equal(request.status,202);
    const summary=await waitForRun((await request.json()).id);
    assert.equal(summary.status,'completed',summary.error);
    assert.equal(summary.meetingSummaryOf,meeting.id);
    assert.equal(summary.outputs[0].webSearch,undefined);
    assert.equal(summaryMessages.length,1);
    assert.match(summaryMessages[0].content,/"voice":"Voice 1","text":"A transcribed sentence."/);
    assert.doesNotMatch(summaryMessages[0].content,/fixture voice|data:audio/);
    assert.deepEqual([...meetingLoaded],['fixture/asr']);
    assert.equal((await post('/api/cancel/'+summary.id,{})).status,400);
    assert.equal((await waitForRun(summary.id)).status,'completed');
    const chatCheck=await (await post('/api/check',{task:'chat',model:'fixture/chat',switchModels:true})).json();
    let chatReadiness;
    for(let i=0;i<200;i++){
      chatReadiness=(await (await get('/api/readiness')).json()).checks.find(item=>item.runId===chatCheck.id);
      if(chatReadiness)break;
      await pause(40);
    }
    assert.equal(chatReadiness?.status,'failed');
    assert.match(chatReadiness.note,/no final answer/i);
  }finally{proc.kill();await new Promise(r=>proc.once('exit',r));await new Promise(r=>device.close(r));assert.ok(data.startsWith(path.join(root,'test')+path.sep));await fs.rm(data,{recursive:true,force:true});}
});
