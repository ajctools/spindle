import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {creativeModels,imageRecipe,enhancedPrompt,filmDuration} from '../creative.mjs';
import {planFilm,filmSegmentParams,filmTools,mediaCommand,normalizeClip,lastFrame,stitchFilm,probeVideo} from '../film.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const info={family:'minimax_h3',fps:24,frame_options:[17,39,73,124],step_options:[4,8],default_steps:4,canvases:[{width:64,height:48},{width:48,height:64}]};
const available=await filmTools();
const ffmpeg=process.env.SPINDLE_FFMPEG || 'ffmpeg';
async function temp(){return fs.mkdtemp(path.join(root,'test','.runtime-'));}
async function clean(directory){assert.ok(path.resolve(directory).startsWith(path.join(root,'test')+path.sep));await fs.rm(directory,{recursive:true,force:true});}
async function clip(directory,name,frames=124,audio=false){
  const args=['-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=64x48:rate=24'];
  if(audio)args.push('-f','lavfi','-i','sine=frequency=440:sample_rate=48000');
  args.push('-frames:v',String(frames),'-c:v','libx264','-pix_fmt','yuv420p');
  if(audio)args.push('-c:a','aac','-shortest');
  args.push(path.join(directory,name));await mediaCommand(ffmpeg,args);
}
test('creative paths enhance either a phrase or an image edit without external search',()=>{
  const text=imageRecipe({prompt:'A lighthouse',hasImage:false,enhancer:creativeModels.text,image:creativeModels.image});
  assert.equal(text[0].fileFrom,'none');assert.equal(text[0].params._spindleEnhancer,'text');assert.equal(text[0].params._spindleWebSearch.enabled,false);
  const edit=imageRecipe({prompt:'Make it night',hasImage:true,enhancer:creativeModels.edit,image:creativeModels.image});
  assert.equal(edit[0].fileFrom,'input');assert.equal(edit[1].fileFrom,'input');assert.equal(edit[0].params._spindleEnhancer,'edit');
  assert.deepEqual(enhancedPrompt('```json\n{"rewritten_prompt":"A lighthouse at night","wh_ratio":"16:9"}\n```'),{text:'A lighthouse at night',enhancement:{whRatio:'16:9',ratioFollow:''}});
  assert.throws(()=>enhancedPrompt('{"other":"wrong"}'),/no rewritten_prompt/);assert.throws(()=>enhancedPrompt('partial JSON'),/valid JSON/);
  assert.throws(()=>filmDuration(61,true),/1 to 60/);assert.throws(()=>filmDuration(0),/1 to 60/);assert.throws(()=>filmDuration(1.5),/whole-number/);
  assert.equal(filmDuration(30),30);assert.throws(()=>filmDuration(31),/long time/);assert.equal(filmDuration(60,true),60);
});
test('film planning uses runtime frame counts, preserves exact total duration, and validates unknown runtimes',()=>{
  const plan=planFilm(info,15,{width:1920,height:1080});
  assert.equal(plan.segments.length,3);assert.deepEqual(plan.segments.map(s=>s.outputFrames),[120,120,120]);assert.deepEqual(plan.segments.map(s=>s.frames),[124,124,124]);assert.deepEqual(plan.segments.map(s=>s.skip),[0,1,1]);
  assert.equal(plan.width,64);assert.equal(plan.height,48);assert.equal(planFilm(info,15,{width:480,height:640}).width,48);
  for(const seconds of [1,5,7,15,30,31,60]){const p=planFilm(info,seconds);assert.equal(p.segments.reduce((n,s)=>n+s.outputFrames,0),seconds*24);assert.ok(p.segments.every(s=>info.frame_options.includes(s.frames)));}
  const short=planFilm({...info,frame_options:[17,73]},15);assert.ok(short.segments.length>3);assert.equal(short.segments.reduce((n,s)=>n+s.outputFrames,0),360);
  assert.throws(()=>planFilm({...info,frame_options:['invalid']},15),/invalid supported frame counts/);
  assert.throws(()=>planFilm({...info,family:'other'},15),/minimax_h3/);
  assert.throws(()=>planFilm({...info,canvases:[]},15),/canvas/);
});
test('Tiiny H3 runtime without a frame-count list uses duration requests and keeps three five-second contributions',()=>{
  // Synthetic capability report with the field shape observed on Tiiny H3:
  // no frame_options or default_frames, and an empty buckets array.
  const runtime={family:'minimax_h3',fps:24,canvases:[{width:832,height:480}],default_steps:7,step_options:[4,5,6,7,8],max_keyframes:2,buckets:[],dynamic_geometry:false,progressive_resolution:true};
  const plan=planFilm(runtime,15);
  assert.equal(plan.mode,'duration');assert.equal(plan.steps,7);assert.equal(plan.segments.length,3);
  assert.deepEqual(plan.segments.map(s=>s.requestSeconds),[5,5,5]);
  assert.deepEqual(plan.segments.map(s=>s.outputFrames),[120,120,120]);
  for(const segment of plan.segments){const params=filmSegmentParams(plan,segment);assert.deepEqual(params,{fps:24,steps:7,seconds:5,size:'832x480'});assert.ok(!('frames' in params));}
  for(const seconds of [1,5,7,15,30,31,60]){const p=planFilm(runtime,seconds);assert.equal(p.segments.reduce((n,s)=>n+s.outputFrames,0),seconds*24);assert.ok(p.segments.every(s=>s.requestSeconds>=1&&s.requestSeconds<=5));}
  const native=planFilm(info,5);assert.equal(native.mode,'frames');assert.equal(filmSegmentParams(native,native.segments[0]).frames,124);
});
test('real local processing extracts the exact final frame and stitches three clips into a 15-second film',{skip:!available.available},async()=>{
  const directory=await temp(),name='11111111-1111-4111-8111-111111111111.mp4',url='/assets/'+name;
  try{
    await clip(directory,name,124,true);const plan=planFilm(info,15),clips=[];
    for(let i=0;i<3;i++)clips.push(await normalizeClip(directory,url,plan,i));
    const frame=await lastFrame(directory,clips[0].url);assert.ok(frame.data.startsWith('data:image/png;base64,'));
    const expected=path.join(directory,'expected.png');
    await mediaCommand(ffmpeg,['-v','error','-nostdin','-y','-i',path.join(directory,path.basename(clips[0].url)),'-vf','select=eq(n\\,119)','-frames:v','1','-update','1',expected]);
    assert.deepEqual(Buffer.from(frame.data.split(',')[1],'base64'),await fs.readFile(expected));
    const film=await stitchFilm(directory,clips,plan),meta=await probeVideo(directory,film.url);
    assert.equal(meta.frames,360);assert.ok(Math.abs(meta.seconds-15)<.15,meta.seconds);assert.equal(meta.width,64);
    await assert.rejects(lastFrame(directory,'/assets/../../connection.json'),/saved in this Spindle/);
    assert.equal((await fs.readdir(directory)).filter(n=>n.endsWith('.txt')).length,0);
    await assert.rejects(lastFrame(directory,url,{signal:AbortSignal.abort()}));
  }finally{await clean(directory);}
});
test('studio routes pass enhanced text and real image references, chain film frames, and resume without double-counting saved work',{skip:!available.available,timeout:90000},async()=>{
  const directory=await temp(),data=path.join(directory,'data');await fs.mkdir(data);
  const inputName='22222222-2222-4222-8222-222222222222.mp4';await clip(directory,inputName);
  const video=await fs.readFile(path.join(directory,inputName)),png=await fs.readFile(path.join(root,'fixtures','star.png'));
  const models=[['text','Text Generation','Text'],['edit','Image-Text-to-Text','Text,Image'],['image','Text-to-Image','Text,Image'],['video','Text-to-Video','Text,Image']].map(([key,type,input])=>({id:creativeModels[key],model_id:creativeModels[key],type,input,output:key==='video'?'Video':key==='image'?'Image':'Text'}));
  let count=0,failAt=0,shortAt=0,holdNext=false,holding=false,retainedId=0,durationMode=false;const seen=[],references=[];
  const shortName='33333333-3333-4333-8333-333333333333.mp4';await clip(directory,shortName,17);const shortVideo=await fs.readFile(path.join(directory,shortName));
  const device=http.createServer(async(req,res)=>{
    try{
      const parts=[];for await(const b of req)parts.push(b);const raw=Buffer.concat(parts),p=new URL(req.url,'http://device').pathname;
      const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
      assert.equal(req.headers.authorization,'Bearer fabricated-studio-key');
      if(p==='/api/v1/models/online_models'||p==='/api/v1/models/')return json({data:models});
      if(p==='/v1/models')return json({data:models});
      if(p==='/api/v1/npu/status')return json({devices:[]});
      if(p==='/v1/video/info')return json(durationMode?{...info,frame_options:undefined,buckets:[]}:info);
      if(p==='/v1/chat/completions'){
        const b=JSON.parse(raw);seen.push(b);assert.ok(!JSON.stringify(b).includes('_spindle'));assert.equal(b.messages[0].role,'system');
        return json({choices:[{message:{content:JSON.stringify({rewritten_prompt:'An illuminated lighthouse at night.',wh_ratio:'16:9'})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:15,total_tokens:35}});
      }
      if(p==='/v1/images/generations'||p==='/v1/image/generate'){
        const b=JSON.parse(raw);seen.push(b);assert.equal(b.prompt,'An illuminated lighthouse at night.');
        if(p==='/v1/image/generate')assert.ok(b.image.startsWith('data:image/png;base64,'));
        return json({data:[{b64_json:png.toString('base64')}]});
      }
      if(p==='/v1/videos'&&req.method==='POST'){
        count++;const form=await new Response(raw,{headers:{'content-type':req.headers['content-type']}}).formData();
        assert.equal(form.get('model'),creativeModels.video);
        if(durationMode){assert.equal(form.get('frames'),null);assert.equal(Number(form.get('seconds')),5);assert.equal(form.get('size'),'64x48');}
        else assert.equal(Number(form.get('frames')),124);
        assert.equal(form.get('_spindlePreview'),null);
        references.push(Buffer.from(await form.get('input_reference').arrayBuffer()));
        if(count===failAt)return json({error:{message:'Fabricated segment failure'}},500);
        if(holdNext){holdNext=false;holding=true;retainedId=count;return json({id:'clip-'+count,status:'queued',progress:0});}
        return json({id:'clip-'+count,status:'completed',progress:100,usage:{input_tokens:2,output_tokens:3,total_tokens:5}});
      }
      if(/^\/v1\/videos\/clip-\d+$/.test(p))return json({id:p.split('/').at(-1),status:holding&&Number(p.match(/clip-(\d+)/)[1])===retainedId?'running':'completed',usage:{input_tokens:2,output_tokens:3,total_tokens:5}});
      if(/^\/v1\/videos\/clip-\d+\/content$/.test(p)){res.setHeader('content-type','video/mp4');res.end(Number(p.match(/clip-(\d+)/)[1])===shortAt?shortVideo:video);return;}
      return json({error:'Fixture route unavailable'},404);
    }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>device.listen(0,'127.0.0.1',resolve));
  const portServer=http.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
  let processHandle,logs='';const base='http://127.0.0.1:'+port;
  async function start(){
    processHandle=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,SPINDLE_PORT:String(port),SPINDLE_DATA_DIR:data,TIINY_CONFIG:path.join(directory,'no-config.json'),TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'fabricated-studio-key'},stdio:['ignore','pipe','pipe']});
    processHandle.stdout.on('data',b=>{logs+=b;});processHandle.stderr.on('data',b=>{logs+=b;});
    for(let i=0;i<150;i++){try{const r=await fetch(base);if(r.ok)return r.headers.get('set-cookie').split(';')[0];}catch{}if(processHandle.exitCode!==null)assert.fail(logs);await pause(30);}assert.fail('Server did not start: '+logs);
  }
  async function stop(){const child=processHandle;if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
  try{
    let cookie=await start();
    const get=async p=>(await fetch(base+p,{headers:{cookie}})).json();
    const post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
    async function settled(id){for(let i=0;i<1200;i++){const j=(await get('/api/runs')).find(j=>j.id===id);if(['completed','failed','cancelled'].includes(j.status))return j;await pause(30);}assert.fail('Studio job did not settle');}
    await get('/api/state');
    for(const name of ['studio.mjs','studio.css']){const response=await fetch(base+'/'+name);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),name.endsWith('.mjs')?/javascript/:/css/);}
    assert.equal((await fetch(base+'/api/studio/film',{method:'POST',body:'{}'})).status,403);
    for(const b of [{seconds:61,acknowledged:true},{seconds:31},{seconds:1.5}])assert.equal((await post('/api/studio/film',b)).status,400);
    const image=await post('/api/studio/image',{prompt:'A lighthouse'});assert.equal(image.status,202);
    const created=await settled(image.body.id);assert.equal(created.status,'completed',created.error);assert.equal(created.outputs[0].text,'An illuminated lighthouse at night.');
    const sourceAsset=created.outputs[1].assets[0].url;
    const edit=await post('/api/studio/image',{prompt:'Make it night',sourceAsset});const edited=await settled(edit.body.id);assert.equal(edited.status,'completed',edited.error);
    assert.equal(seen[2].model,creativeModels.edit);assert.equal(seen[2].messages.at(-1).content[1].type,'image_url');
    const requested=await post('/api/studio/film',{sourceAsset,prompt:'The light slowly sweeps the sea.',seconds:15});assert.equal(requested.status,202,JSON.stringify(requested.body));
    const film=await settled(requested.body.id);assert.equal(film.status,'completed',film.error);assert.equal(film.outputs.length,3);assert.equal(count,3);
    assert.deepEqual(references[0],png);
    const expected=await lastFrame(path.join(data,'assets'),film.outputs[0].assets[0].url);assert.deepEqual(references[1],Buffer.from(expected.data.split(',')[1],'base64'));
    assert.equal((await probeVideo(path.join(data,'assets'),film.finalOutput.assets[0].url)).frames,360);
    failAt=count+2;
    const interrupted=await post('/api/studio/film',{sourceAsset,seconds:15});const failed=await settled(interrupted.body.id);assert.equal(failed.status,'failed');assert.equal(failed.outputs.length,1);const before=count;
    failAt=0;const resumed=await post('/api/studio/resume',{id:failed.id});assert.equal(resumed.status,202,JSON.stringify(resumed.body));
    const complete=await settled(resumed.body.id);assert.equal(complete.status,'completed',complete.error);assert.equal(count-before,2);assert.equal(complete.outputs[0].reusedFrom.runId,failed.id);
    shortAt=count+1;
    const shortRun=await post('/api/studio/film',{sourceAsset,seconds:5});const tooShort=await settled(shortRun.body.id);assert.equal(tooShort.status,'failed');assert.equal(tooShort.outputs[0].needsRegeneration,true);
    shortAt=0;const retried=await post('/api/studio/resume',{id:tooShort.id});const retryComplete=await settled(retried.body.id);assert.equal(retryComplete.status,'completed',retryComplete.error);
    const beforeRetained=count;holdNext=true;
    const pendingRun=await post('/api/studio/film',{sourceAsset,seconds:15});
    let remoteRecorded=false;for(let i=0;i<200;i++){const saved=JSON.parse(await fs.readFile(path.join(data,'runs.json'),'utf8')),j=saved.find(j=>j.id===pendingRun.body.id);if(j.remote){remoteRecorded=true;break;}await pause(30);}assert.equal(remoteRecorded,true);
    await stop();cookie=await start();
    assert.ok((await get('/api/runs')).find(j=>j.id===pendingRun.body.id).remote,'The in-flight device job must survive restart');
    const runningResume=await post('/api/studio/resume',{id:pendingRun.body.id});assert.equal(runningResume.status,400);assert.match(runningResume.body.error,/still running/);assert.equal(count-beforeRetained,1);
    holding=false;const recovered=await post('/api/studio/resume',{id:pendingRun.body.id});assert.equal(recovered.status,202,JSON.stringify(recovered.body));
    const recoveredFilm=await settled(recovered.body.id);assert.equal(recoveredFilm.status,'completed',recoveredFilm.error);assert.equal(count-beforeRetained,3);assert.equal(recoveredFilm.outputs[0].reusedFrom.runId,pendingRun.body.id);
    durationMode=true;const durationRun=await post('/api/studio/film',{sourceAsset,seconds:15});
    const durationFilm=await settled(durationRun.body.id);assert.equal(durationFilm.status,'completed',durationFilm.error);assert.equal(durationFilm.film.plan.mode,'duration');assert.equal(durationFilm.outputs.length,3);assert.equal(durationFilm.film.runtimeInfo.frame_options,undefined);
    const durationMeta=await probeVideo(path.join(data,'assets'),durationFilm.finalOutput.assets[0].url);assert.equal(durationMeta.frames,360);
    const stats=await get('/api/metrics?days=0&task=video');assert.equal(stats.totals.completed,14);assert.equal(stats.totals.totalTokens,70);
    await stop();cookie=await start();
    const after=await get('/api/metrics?days=0&task=video');assert.equal(after.totals.completed,14);assert.equal(after.totals.totalTokens,70);
    const disk=await fs.readFile(path.join(data,'runs.json'),'utf8');assert.ok(!disk.includes('fabricated-studio-key'));
    const history=await get('/api/runs');assert.ok(history.find(j=>j.id===complete.id).finalOutput);assert.ok(history.every(j=>!j.file));
  }finally{await stop();await new Promise(resolve=>device.close(resolve));await clean(directory);}
});
