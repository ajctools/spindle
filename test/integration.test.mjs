import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

test('local bridge inventories, protects writes, hands workflow outputs across models, and restores residency',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const testDir=await fs.mkdtemp(path.join(root,'test','.runtime-'));
  const port=18437,events=[];let loaded=['test/chat'];
  const models=[{id:'test/chat',model_id:'test/chat',name:'Chat',type:'Text Generation',input:'Text',output:'Text',npu_usage:70},{id:'test/voice',model_id:'test/voice',name:'Voice',type:'Text-to-Speech',input:'Text',output:'Audio',npu_usage:50}];
  const device=http.createServer(async(req,res)=>{
    let raw='';for await(const b of req)raw+=b;
    const p=new URL(req.url,'http://device').pathname;
    const send=j=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(j));};
    assert.equal(req.headers.authorization,'Bearer fixture-key');
    if(p==='/api/v1/models/online_models')return send(models);
    if(p==='/api/v1/models/')return send({data:models});
    if(p==='/v1/models')return send({data:models.filter(m=>loaded.includes(m.id))});
    if(p==='/api/v1/npu/status')return send({devices:[],cpu:{},memory:{}});
    if(p==='/api/v1/models/npu/status')return send({models:loaded.map(id=>({model_id:id,status:'running'}))});
    if(p==='/api/v1/tasks')return send({tasks:[]});
    if(p.endsWith('/start')||p.endsWith('/stop')){const id=decodeURIComponent(p.split('/').at(-2));const action=p.split('/').at(-1);events.push([action,id]);loaded=action==='start'?[...loaded,id]:loaded.filter(x=>x!==id);return send({ok:true});}
    if(p==='/v1/chat/completions'){
      const b=JSON.parse(raw);assert.equal(b.model,'test/chat');assert.equal(b.stream,true);assert.equal(b.stream_options.include_usage,true);assert.ok(!JSON.stringify(b).includes('_spindle'));events.push(['chat',b.messages.at(-1).content]);
      assert.equal(b.max_tokens,b.messages.at(-1).content==='Test an explicit response limit'?16384:32768);
      if(b.messages.at(-1).content==='Test a stream failure'){
        res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({error:{message:'Upstream rejected fixture-key'}})+'\n\n');return;
      }
      res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'A private model thought.'}}]})+'\n\n');
      setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:'A useful handoff.'},finish_reason:b.max_tokens?'length':'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}})+'\n\ndata: [DONE]\n\n'),200);return;
    }
    if(p==='/v1/audio/speech'){const b=JSON.parse(raw);events.push(['speech',b.input]);res.setHeader('content-type','audio/mpeg');res.end(Buffer.from([73,68,51,4,0,0]));return;}
    res.statusCode=404;send({error:{message:'Unknown fixture route '+p}});
  });
  await new Promise(r=>device.listen(0,'127.0.0.1',r));
  const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,SPINDLE_PORT:String(port),SPINDLE_DATA_DIR:testDir,TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
  let log='';proc.stdout.on('data',b=>log+=b);proc.stderr.on('data',b=>log+=b);
  const base='http://127.0.0.1:'+port;
  try{
    let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(base);if(r.ok){ready=true;break;}}catch{}await pause(100);}
    assert.ok(ready,log);
    const home=await fetch(base),cookie=home.headers.get('set-cookie').split(';')[0];
    const get=route=>fetch(base+route,{headers:{cookie}});
    const state=await (await get('/api/state')).json();assert.equal(state.models.length,2);assert.equal(state.models.filter(m=>m.loaded).length,1);assert.ok(!JSON.stringify(state).includes('fixture-key'));
    assert.equal((await fetch(base+'/api/run',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/run',{method:'POST',headers:{cookie,origin:'https://example.com'},body:'{}'})).status,403);
    const post=async(p,b)=>(await fetch(base+p,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)})).json();
    assert.deepEqual(await (await get('/api/search/settings')).json(),{braveKeyPresent:false});
    assert.deepEqual(await post('/api/search/settings',{key:'fixture-session-search-key'}),{braveKeyPresent:true});
    assert.ok(!JSON.stringify(await (await get('/api/search/settings')).json()).includes('fixture-session-search-key'));
    const w=await post('/api/workflows',{name:'Narrated idea',steps:[{task:'chat',model:'test/chat',prompt:'{{input}}'},{task:'speech',model:'test/voice',prompt:'{{previous.text}}'}]});assert.ok(w.id);
    const created=await post('/api/run',{name:w.name,input:'Explain a handoff.',switchModels:true,steps:w.steps});assert.ok(created.id);
    let job,sawThinking=false;for(let i=0;i<100;i++){job=(await (await get('/api/runs')).json()).find(j=>j.id===created.id);if(job.partial?.reasoning)sawThinking=true;if(['completed','failed'].includes(job.status))break;await pause(70);}
    assert.equal(job.status,'completed',job.error);assert.equal(sawThinking,true);assert.equal(job.outputs[0].reasoning,'A private model thought.');assert.equal(job.outputs[0].text,'A useful handoff.');assert.equal(job.outputs[0].metrics.totalTokens,18);assert.equal(job.partial,undefined);assert.ok(!JSON.stringify(job).includes('fixture-session-search-key'));assert.equal(job.outputs.length,2);assert.equal(job.restoredModels,true);assert.deepEqual(loaded,['test/chat']);
    assert.equal(job.outputs[0].responseLimit,32768);
    assert.ok(events.some(e=>e[0]==='speech'&&e[1]==='A useful handoff.'));
    assert.ok(!(await fs.readFile(path.join(testDir,'runs.json'),'utf8')).includes('fixture-session-search-key'));
    assert.deepEqual(await post('/api/search/settings',{key:''}),{braveKeyPresent:false});
    const media=await get(job.outputs[1].assets[0].url);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'audio/mpeg');
    assert.equal((await get('/catalog.csv')).status,200);
    assert.deepEqual(events.filter(e=>['start','stop'].includes(e[0])),[['stop','test/chat'],['start','test/voice'],['stop','test/voice'],['start','test/chat']]);
    const failed=await post('/api/run',{input:'Test a stream failure',steps:[{task:'chat',model:'test/chat',prompt:'{{input}}'}]});
    let failure;for(let i=0;i<60;i++){failure=(await (await get('/api/runs')).json()).find(j=>j.id===failed.id);if(failure.status==='failed')break;await pause(50);}
    assert.equal(failure.status,'failed');assert.ok(failure.error.includes('[redacted]'));assert.ok(!failure.error.includes('fixture-key'));
    const limited=await post('/api/run',{input:'Test an explicit response limit',steps:[{task:'chat',model:'test/chat',prompt:'{{input}}',params:{max_tokens:16384}}]});
    let limitedJob;for(let i=0;i<60;i++){limitedJob=(await (await get('/api/runs')).json()).find(j=>j.id===limited.id);if(['completed','failed'].includes(limitedJob.status))break;await pause(50);}
    assert.equal(limitedJob.status,'completed',limitedJob.error);assert.equal(limitedJob.outputs[0].responseLimit,16384);assert.equal(limitedJob.outputs[0].finishReason,'length');
  }finally{
    proc.kill();await new Promise(r=>proc.once('exit',r));await new Promise(r=>device.close(r));
    // This directory was created directly under the test directory by mkdtemp.
    assert.ok(testDir.startsWith(path.join(root,'test')+path.sep));await fs.rm(testDir,{recursive:true,force:true});
  }
});
