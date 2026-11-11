import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {fetchMuseumSource,museumProjects,basicExhibits,curatedExhibits,museumHTML} from '../museum.mjs';
import {soundOptions,extractSoundtrack,replaceSoundtrack} from '../soundtrack.mjs';
import {filmTools,mediaCommand,probeVideo} from '../film.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ffmpeg=process.env.SPINDLE_FFMPEG || 'ffmpeg',tools=await filmTools();
const project=(id,title='Synthetic project')=>({title,source:'https://www.tiinyverse.com/posts/'+id,author:'Example Maker',publishedAt:'2026-01-02T10:00:00Z',description:'A fabricated local project for testing.',likes:0,comments:null});
async function temporary(){return fs.mkdtemp(path.join(root,'test','.runtime-'));}async function clean(dir){assert.ok(path.resolve(dir).startsWith(path.join(root,'test')+path.sep));await fs.rm(dir,{recursive:true,force:true});}
async function holdWindowsHistory(file){
  if(process.platform!=='win32')return;
  const lock=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$taskStream=[IO.File]::Open($env:SPINDLE_TEST_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);[Console]::WriteLine('locked');Start-Sleep -Milliseconds 400;$taskStream.Dispose()"],{windowsHide:true,env:{...process.env,SPINDLE_TEST_LOCK:file},stdio:['ignore','pipe','pipe']});
  let messages='';lock.stderr.on('data',b=>messages+=b);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{lock.kill();reject(new Error('History lock did not start: '+messages));},5000);lock.once('error',e=>{clearTimeout(timer);reject(e);});lock.stdout.once('data',()=>{clearTimeout(timer);resolve();});lock.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('History lock failed: '+messages));});});
}
test('museum imports only public topic posts, paginates within fixed HTTPS origins, and preserves unknown versus zero',async()=>{
  let calls=0;const snapshot=await fetchMuseumSource({fetcher:async(url,options)=>{
    assert.equal(url.origin,'https://www.tiinyverse.com');assert.equal(url.pathname,'/api/topics/usecase');assert.equal(url.searchParams.get('sort'),'top-liked');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    calls++;if(calls===2)assert.equal(url.searchParams.get('cursor'),'next cursor');
    return Response.json({topic:{id:'usecase'},posts:[{id:'public-'+calls,title:'Public example',status:'published',visibility:'public',author:{nickname:'Example Maker',accountId:'must-not-copy',bio:'private-extra-field'},publishedAtRaw:'2026-01-02',excerpt:'A public example',likedCount:calls===1?0:undefined,commentCount:0},{id:'private',title:'Private',status:'published',visibility:'private'}],pageInfo:{hasNextPage:true,nextCursor:'next cursor'}});
  }});
  assert.equal(calls,2);assert.equal(snapshot.projects.length,2);assert.equal(snapshot.hasMore,true);assert.ok(!JSON.stringify(snapshot).includes('must-not-copy'));const normalized=museumProjects(snapshot.projects);assert.equal(normalized[0].likes,0);assert.equal(normalized[1].likes,null);assert.equal(normalized[0].comments,0);
  await assert.rejects(fetchMuseumSource({fetcher:async()=>Response.json({topic:{id:'other'},posts:[]})}),/changed/);
});
test('museum curation cannot override source attribution, dates, counts, or insert executable HTML',async()=>{
  const projects=museumProjects([project('example-a'),project('example-b')]);
  assert.throws(()=>museumProjects([{...project('example'),source:'http://127.0.0.1/private'}]),/TiinyVerse/);
  assert.throws(()=>museumProjects([project('same'),project('same')]),/different/);
  const result=curatedExhibits(JSON.stringify({exhibits:projects.map(p=>({id:p.id,summary:'An original exhibit summary.',narration:'A short spoken guide.',scenePrompt:'A quiet local workshop.',author:'Forged',likes:999,publishedAt:'1900-01-01',accent:'red;url(evil)'}))}),projects);
  assert.equal(result[0].author,'Example Maker');assert.equal(result[0].likes,0);assert.equal(result[0].publishedAt,projects[0].publishedAt);assert.equal(result[0].accent,'#c29b61');
  const envelope=JSON.stringify({exhibits:result});
  assert.deepEqual(curatedExhibits('Here are the exhibits.\n```json\n'+envelope+'\n```\nA short closing note.',projects),result);
  assert.deepEqual(curatedExhibits('A preface. '+envelope+' A closing note.',projects),result);
  const dir=await temporary();try{
    const html=await museumHTML({title:'A </script><script>evil()</script> museum',exhibits:basicExhibits(projects),snapshot:{fetchedCount:40,hasMore:true},assetsDirectory:dir});
    assert.ok(!html.includes('__MUSEUM_DATA__'));assert.ok(html.includes("connect-src 'none'"));assert.ok(!html.includes('src="https://'));assert.ok(!html.includes('evil()'));
    const payload=JSON.parse(html.match(/<script id="museum-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.equal(payload.exhibits.length,2);assert.equal(payload.snapshot.hasMore,true);
    await assert.rejects(museumHTML({title:'Bad',exhibits:[{...result[0],art:{url:'/assets/../../connection.json',mime:'image/png'}}],assetsDirectory:dir}),/unsupported/);
  }finally{await clean(dir);}
});
test('sound options validate timing and volume without assuming a speech separation capability',()=>{
  assert.deepEqual(soundOptions(),{originalVolume:0,musicVolume:.15,offset:0,fit:false});assert.throws(()=>soundOptions({originalVolume:2}),/levels/);assert.throws(()=>soundOptions({offset:-1}),/levels/);
});
test('real soundtrack replacement preserves video frames and original files, mixes music, and rejects rushed speech',{skip:!tools.available,timeout:30000},async()=>{
  const dir=await temporary(),video='11111111-1111-4111-8111-111111111111.mp4',voice='22222222-2222-4222-8222-222222222222.wav',music='33333333-3333-4333-8333-333333333333.wav';
  try{
    await mediaCommand(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x48:rate=24','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,video)]);
    for(const [name,seconds]of [[voice,1],[music,1]])await mediaCommand(ffmpeg,['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t',String(seconds),path.join(dir,name)]);
    const original=await fs.readFile(path.join(dir,video)),audio=await extractSoundtrack(dir,'/assets/'+video);assert.equal(audio.mime,'audio/wav');
    const out=await replaceSoundtrack(dir,{video:'/assets/'+video,voice:'/assets/'+voice,music:'/assets/'+music,options:{originalVolume:.1,offset:.2}});
    assert.equal((await probeVideo(dir,out.url)).frames,72);assert.deepEqual(await fs.readFile(path.join(dir,video)),original);
    await assert.rejects(replaceSoundtrack(dir,{video:'/assets/'+video,voice:'/assets/'+voice,options:{offset:2.8}}),/Shorten/);
    await assert.rejects(replaceSoundtrack(dir,{video:'/assets/'+video,voice:'/assets/'+voice,options:{offset:2.8,fit:true}}),/1.35/);
  }finally{await clean(dir);}
});
test('museum build runs local model stages, exports a sandboxed offline artifact, and survives restart without duplicate usage',{timeout:30000},async()=>{
  const dir=await temporary(),data=path.join(dir,'data');await fs.mkdir(data);const png=await fs.readFile(path.join(root,'fixtures','star.png')),wav=await fs.readFile(path.join(root,'fixtures','speech.wav'));
  const models=[{id:'fixture/curator',model_id:'fixture/curator',type:'Text Generation',input:'Text'},{id:'fixture/art',model_id:'fixture/art',type:'Text-to-Image',input:'Text'},{id:'fixture/speech',model_id:'fixture/speech',type:'Text-to-Speech',input:'Text'},{id:'fixture/asr',model_id:'fixture/asr',type:'ASR',input:'Audio'},{id:'fixture/mesh',model_id:'fixture/mesh',type:'Image-to-3D',input:'Image'},{id:'fixture/music',model_id:'fixture/music',type:'Music Generation',input:'Text'}],calls=[];
  const projects=museumProjects([project('example-a','A first invention'),{...project('example-b','Another invention'),publishedAt:'2026-02-03'}]);let artCount=0,failArtAt=0,musicQueries=0;
  const device=http.createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks).toString(),p=new URL(req.url,'http://device').pathname;const json=v=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(v));};
    if(p==='/api/v1/models/online_models'||p==='/api/v1/models/'||p==='/v1/models')return json({data:models});if(p==='/api/v1/npu/status')return json({devices:[]});
    if(p==='/v1/chat/completions'){const b=JSON.parse(body);calls.push('curate');assert.ok(!body.includes('_spindle'));assert.ok(!b.messages.some(m=>m.content.includes('Searching the web')));return json({choices:[{message:{content:JSON.stringify({exhibits:JSON.parse(b.messages.at(-1).content.split('SOURCE DATA:\n').at(-1)).map(p=>({id:p.id,summary:'A grounded synthetic project description.',narration:'A clear spoken exhibit.',scenePrompt:'An abstract workshop.'}))})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}});}
    if(p==='/v1/images/generations'){calls.push('art');artCount++;if(artCount===failArtAt){res.statusCode=500;return json({error:{message:'Synthetic interrupted art step'}});}return json({data:[{b64_json:png.toString('base64')}]});}
    if(p==='/v1/3d/tasks'){calls.push('sculpture');assert.ok(body.includes('name="stage"\r\n\r\nshape'));assert.ok(body.includes('name="image"'));return json({id:'synthetic-shape',status:'completed'});}
    if(p==='/v1/3d/tasks/synthetic-shape/artifacts')return json({artifacts:[{id:'shape',filename:'shape.glb'}]});
    if(p==='/v1/3d/tasks/synthetic-shape/artifacts/shape'){res.setHeader('content-type','model/gltf-binary');return res.end(Buffer.from('Synthetic unsupported geometry exercises graceful fallback.'));}
    if(p==='/v1/music/info'){musicQueries++;if(musicQueries===1){res.statusCode=404;return json({error:'fixture/music is not loaded.'});}return json({model_info:{model:{supported_generation_types:['bgm']}}});}
    if(p==='/v1/music/generate/wav'){const b=JSON.parse(body);assert.equal(b.config.generation_type,'bgm');assert.match(b.config.caption,/no singing/);calls.push('ambient');res.setHeader('content-type','audio/wav');return res.end(wav);}
    if(p==='/v1/audio/speech'){calls.push('voice');res.setHeader('content-type','audio/wav');return res.end(wav);}
    if(p==='/v1/audio/transcriptions'){calls.push('transcribe');return json({text:'Corrected narration words.'});}
    res.writeHead(404);res.end('{}');
  });await new Promise(resolve=>device.listen(0,'127.0.0.1',resolve));
  const portServer=http.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));let child,logs='';const base='http://127.0.0.1:'+port;
  async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,SPINDLE_PORT:String(port),SPINDLE_DATA_DIR:data,TIINY_CONFIG:path.join(dir,'absent.json'),TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'fabricated-workshop-key'},stdio:['ignore','pipe','pipe']});child.stderr.on('data',b=>logs+=b);child.stdout.on('data',b=>logs+=b);for(let i=0;i<150;i++){try{const r=await fetch(base);if(r.ok)return r.headers.get('set-cookie').split(';')[0];}catch{}await pause(30);}assert.fail(logs);}
  async function stop(){if(child?.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
  try{let cookie=await start();const get=p=>fetch(base+p,{headers:{cookie}});const post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
    async function settled(id){for(let i=0;i<200;i++){const j=(await(await get('/api/runs')).json()).find(j=>j.id===id);if(['completed','failed'].includes(j.status))return j;await pause(30);}assert.fail('Museum did not settle');}
    assert.equal((await fetch(base+'/api/museum/build',{method:'POST',body:'{}'})).status,403);
    const requested=await post('/api/museum/build',{refreshSources:false,title:'Synthetic Museum',design:{preset:'vault'},projects,curate:true,art:true,voice:true,chat:'fixture/curator',image:'fixture/art',speech:'fixture/speech'});assert.equal(requested.status,202,JSON.stringify(requested.body));
    const job=await settled(requested.body.id);assert.equal(job.status,'completed',job.error);assert.deepEqual(calls,['curate','art','art','voice','voice']);assert.equal(job.outputs.length,5);
    await holdWindowsHistory(path.join(data,'runs.json'));
    const repack=await post('/api/museum/build',{rebuildId:job.id,refreshSources:false,curate:false,art:false,voice:false});assert.equal(repack.status,202,JSON.stringify(repack.body));const kept=await settled(repack.body.id);assert.equal(kept.status,'completed',kept.error);assert.equal(kept.steps.length,0);assert.equal(kept.museum.rebuiltFrom,job.id);assert.equal(kept.museum.design.preset,'vault');assert.equal(kept.museum.exhibits[0].art.url,job.museum.exhibits[0].art.url);assert.equal(kept.museum.exhibits[0].voice.url,job.museum.exhibits[0].voice.url);assert.equal(calls.length,5);
    const exported=job.finalOutput.assets[0],download=await get(exported.url);assert.match(download.headers.get('content-disposition'),/attachment/);const html=await download.text();assert.ok(html.includes('data:image/png;base64,'));assert.ok(html.includes('data:audio/wav;base64,'));assert.ok(!html.includes('fabricated-workshop-key'));
    const preview=await get(exported.previewUrl);assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.match(preview.headers.get('content-security-policy'),/connect-src 'none'/);
    const quick=await post('/api/museum/build',{refreshSources:false,title:'Quick',projects,curate:false,art:false,voice:false});assert.equal((await settled(quick.body.id)).status,'completed');assert.equal(calls.length,5);
    const stats=await(await get('/api/metrics?days=0')).json();assert.equal(stats.totals.completed,5);assert.equal(stats.totals.totalTokens,30);
    failArtAt=artCount+2;const interrupted=await post('/api/museum/build',{refreshSources:false,title:'Interrupted museum',projects,curate:true,art:true,voice:false,chat:'fixture/curator',image:'fixture/art'});const failed=await settled(interrupted.body.id);assert.equal(failed.status,'failed');assert.equal(failed.outputs.length,2);
    failArtAt=0;const beforeResume=calls.length,resumed=await post('/api/museum/resume',{id:failed.id});assert.equal(resumed.status,202,JSON.stringify(resumed.body));const recovered=await settled(resumed.body.id);assert.equal(recovered.status,'completed',recovered.error);assert.deepEqual(calls.slice(beforeResume),['art']);assert.equal(recovered.outputs[0].reusedFrom.runId,failed.id);
    if(tools.available){
      const name='44444444-4444-4444-8444-444444444444.mp4',file=path.join(data,'assets',name);
      await mediaCommand(ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x48:rate=24','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','10','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file]);
      const original=await fs.readFile(file),transcription=await post('/api/soundtrack/transcribe',{sourceAsset:'/assets/'+name,model:'fixture/asr'});assert.equal(transcription.status,202,JSON.stringify(transcription.body));const transcript=await settled(transcription.body.id);assert.equal(transcript.status,'completed',transcript.error);assert.equal(transcript.outputs[0].text,'Corrected narration words.');
      const replace=await post('/api/soundtrack/replace',{sourceAsset:'/assets/'+name,model:'fixture/speech',script:'The intended words.',options:{originalVolume:0}});assert.equal(replace.status,202,JSON.stringify(replace.body));const repaired=await settled(replace.body.id);assert.equal(repaired.status,'completed',repaired.error);assert.equal((await probeVideo(path.join(data,'assets'),repaired.finalOutput.assets[0].url)).frames,240);assert.deepEqual(await fs.readFile(file),original);
    }
    const hero=await post('/api/museum/build',{refreshSources:false,title:'One hero shape',projects:projects.slice(0,1),curate:false,art:false,voice:false,sculpture:true,image:'fixture/art',mesh:'fixture/mesh'});assert.equal(hero.status,202,JSON.stringify(hero.body));const shaped=await settled(hero.body.id);assert.equal(shaped.status,'completed',shaped.error);assert.equal(shaped.outputs.length,2);assert.equal(shaped.museum.exhibits[0].sculpture.mime,'model/gltf-binary');const shapedHTML=await(await get(shaped.finalOutput.assets[0].url)).text();assert.match(shapedHTML,/procedural sculpture because/);assert.deepEqual(calls.slice(-2),['art','sculpture']);
    const materials=await post('/api/museum/build',{refreshSources:false,title:'Material gallery',projects:projects.slice(0,1),curate:false,art:false,voice:false,materials:true,image:'fixture/art'});assert.equal(materials.status,202,JSON.stringify(materials.body));const surfaced=await settled(materials.body.id);assert.equal(surfaced.status,'completed',surfaced.error);assert.equal(surfaced.outputs.length,2);assert.equal(surfaced.museum.materials.floor.mime,'image/png');assert.equal(surfaced.museum.materials.timber.mime,'image/png');const materialHTML=await(await get(surfaced.finalOutput.assets[0].url)).text(),materialData=JSON.parse(materialHTML.match(/<script id="museum-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.match(materialData.materials.floorData,/^data:image\/png;base64,/);assert.match(materialData.materials.timberData,/^data:image\/png;base64,/);const reused=await post('/api/museum/build',{rebuildId:surfaced.id,refreshSources:false,curate:false,art:false,voice:false});const rebuilt=await settled(reused.body.id);assert.equal(rebuilt.status,'completed',rebuilt.error);assert.equal(rebuilt.steps.length,0);assert.equal(rebuilt.museum.materials.floor.url,surfaced.museum.materials.floor.url);
    const many=await post('/api/museum/build',{refreshSources:false,title:'Batched curation',projects:Array.from({length:7},(_,i)=>project('batch-'+i)),curate:true,art:false,voice:false,chat:'fixture/curator'});assert.equal(many.status,202,JSON.stringify(many.body));const batched=await settled(many.body.id);assert.equal(batched.status,'completed',batched.error);assert.equal(batched.outputs.length,2);assert.equal(batched.museum.exhibits.length,7);assert.equal(new Set(batched.museum.exhibits.map(e=>e.id)).size,7);
    const ambience=await post('/api/museum/build',{refreshSources:false,title:'Soundscape',projects:projects.slice(0,1),curate:false,art:false,voice:false,ambient:true,music:'fixture/music'});assert.equal(ambience.status,202,JSON.stringify(ambience.body));const scored=await settled(ambience.body.id);assert.equal(scored.status,'completed',scored.error);assert.equal(scored.outputs.length,1);assert.equal(musicQueries,2);assert.equal(scored.museum.ambient.mime,'audio/wav');const scoredHTML=await(await get(scored.finalOutput.assets[0].url)).text();const scoredData=JSON.parse(scoredHTML.match(/<script id="museum-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);assert.match(scoredData.ambientData,/^data:audio\/wav;base64,/);
    await stop();cookie=await start();const after=await(await get('/api/metrics?days=0')).json();assert.equal(after.totals.completed,tools.available?17:15);assert.equal(after.totals.totalTokens,120);
  }finally{await stop();await new Promise(resolve=>device.close(resolve));await clean(dir);}
});
