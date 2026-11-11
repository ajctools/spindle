import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

const chatPrompt='Look up the meaning of {{previous.text}}';
const priorTurn='Private text from an earlier chat turn';

test('local bridge inventories, protects writes, hands workflow outputs across models, and restores residency',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const testDir=await fs.mkdtemp(path.join(root,'test','.runtime-'));
  const port=18437,events=[];let loaded=['test/chat'],showDeviceWebPage=false;
  const voiceStart=Promise.withResolvers(),voiceOutput=Promise.withResolvers(),traceStreamEnd=Promise.withResolvers();
  const models=[{id:'test/chat',model_id:'test/chat',name:'Chat',type:'Text Generation',input:'Text',output:'Text',npu_usage:70},{id:'test/voice',model_id:'test/voice',name:'Voice',type:'Text-to-Speech',input:'Text',output:'Audio',npu_usage:50}];
  const device=http.createServer(async(req,res)=>{
    let raw='';for await(const b of req)raw+=b;
    const p=new URL(req.url,'http://device').pathname;
    const send=j=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(j));};
    assert.equal(req.headers.authorization,'Bearer fixture-key');
    if(showDeviceWebPage){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>Private device web page fixture</title>');return;}
    if(p==='/api/v1/models/online_models')return send(models);
    if(p==='/api/v1/models/')return send({data:models});
    if(p==='/v1/models')return send({data:models.filter(m=>loaded.includes(m.id))});
    if(p==='/api/v1/npu/status')return send({devices:[],cpu:{},memory:{}});
    if(p==='/api/v1/models/npu/status')return send({models:loaded.map(id=>({model_id:id,status:'running'}))});
    if(p==='/api/v1/tasks')return send({tasks:[]});
    if(p.endsWith('/start')||p.endsWith('/stop')){
      const id=decodeURIComponent(p.split('/').at(-2)),action=p.split('/').at(-1);
      events.push([action,id]);
      if(action==='start'&&id==='test/voice')await voiceStart.promise;
      loaded=action==='start'?[...loaded,id]:loaded.filter(x=>x!==id);return send({ok:true});
    }
    if(p==='/v1/chat/completions'){
      const b=JSON.parse(raw);assert.equal(b.model,'test/chat');assert.equal(b.stream,true);assert.equal(b.stream_options.include_usage,true);assert.ok(!JSON.stringify(b).includes('_spindle'));events.push(['chat',b.messages.at(-1).content]);
      if(b.messages.at(-1).content===chatPrompt){
        assert.equal(b.messages[0].role,'system');assert.match(b.messages[0].content,/Fixture search result/);
        assert.equal(b.messages[1].content,priorTurn);
      }
      assert.equal(b.max_tokens,b.messages.at(-1).content==='Test an explicit response limit'?16384:32768);
      if(b.messages.at(-1).content==='Test a stream failure'){
        res.setHeader('content-type','text/event-stream');res.end('data: '+JSON.stringify({error:{message:'Upstream rejected fixture-key'}})+'\n\n');return;
      }
      res.setHeader('content-type','text/event-stream');res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'A private model thought.'}}]})+'\n\n');
      if(b.messages.at(-1).content===chatPrompt)await traceStreamEnd.promise;
      setTimeout(()=>res.end('data: '+JSON.stringify({choices:[{delta:{content:'A useful handoff.'},finish_reason:b.max_tokens?'length':'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}})+'\n\ndata: [DONE]\n\n'),200);return;
    }
    if(p==='/v1/audio/speech'){const b=JSON.parse(raw);events.push(['speech',b.input]);await voiceOutput.promise;res.setHeader('content-type','audio/mpeg');res.end(Buffer.from([73,68,51,4,0,0]));return;}
    res.statusCode=404;send({error:{message:'Unknown fixture route '+p}});
  });
  await new Promise(r=>device.listen(0,'127.0.0.1',r));
  const archivedChat={id:'archived-zero',startedAt:'2020-01-01T12:00:00Z',task:'chat',model:'test/chat',status:'completed',profile:{hasFile:false},inputTokens:0,outputTokens:0,totalTokens:0};
  const archivedMetrics=[
    archivedChat,
    {...archivedChat,id:'archived-unknown',inputTokens:null,outputTokens:null,totalTokens:null},
    {...archivedChat,id:'archived-other-device',connectionId:'other-fixture-device',inputTokens:99,outputTokens:99,totalTokens:198},
  ];
  await fs.writeFile(path.join(testDir,'metrics.ndjson'),archivedMetrics.map(record=>JSON.stringify(record)).join('\n')+'\n');
  const searchFixture=path.join(testDir,'search-fixture.mjs');
  await fs.writeFile(searchFixture,`
    import assert from 'node:assert/strict';
    const fetchDevice=globalThis.fetch;
    globalThis.fetch=async (input,options)=>{
      const url=new URL(input);
      if(url.hostname==='127.0.0.1')return fetchDevice(input,options);
      assert.equal(url.origin,'https://html.duckduckgo.com');
      assert.equal(url.searchParams.get('q'),${JSON.stringify(chatPrompt)});
      assert.equal(options.headers.Authorization,undefined);
      assert.equal(options.headers['X-Subscription-Token'],undefined);
      return new Response('<a class="result__a" href="https://example.com">Fixture search result</a>',{headers:{'Set-Cookie':'upstream=fixture-private-cookie'}});
    };
  `);
  const proc=spawn(process.execPath,['--import',pathToFileURL(searchFixture).href,'server.mjs'],{cwd:root,env:{...process.env,SPINDLE_PORT:String(port),SPINDLE_DATA_DIR:testDir,TIINY_CONFIG:path.join(testDir,'absent-config.json'),TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'fixture-key'},stdio:['ignore','pipe','pipe']});
  let log='';proc.stdout.on('data',b=>log+=b);proc.stderr.on('data',b=>log+=b);
  const base='http://127.0.0.1:'+port;
  try{
    let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(base);if(r.ok){ready=true;break;}}catch{}await pause(100);}
    assert.ok(ready,log);
    const home=await fetch(base),cookie=home.headers.get('set-cookie').split(';')[0];
    const get=route=>fetch(base+route,{headers:{cookie}});
    const initialMetrics=await (await get('/api/metrics?days=7')).json();
    assert.equal(initialMetrics.cloudUsage.covered,0);
    assert.deepEqual(initialMetrics.lifetimeCloudUsage,{inputTokens:0,outputTokens:0,covered:1,completed:2,excluded:1});
    const state=await (await get('/api/state')).json();assert.equal(state.models.length,2);assert.equal(state.models.filter(m=>m.loaded).length,1);assert.ok(!JSON.stringify(state).includes('fixture-key'));
    assert.equal((await fetch(base+'/api/run',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/run',{method:'POST',headers:{cookie,origin:'https://example.com'},body:'{}'})).status,403);
    const post=async(p,b)=>(await fetch(base+p,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)})).json();
    assert.deepEqual(await (await get('/api/search/settings')).json(),{braveKeyPresent:false});
    assert.deepEqual(await post('/api/search/settings',{key:'fixture-session-search-key'}),{braveKeyPresent:true});
    assert.ok(!JSON.stringify(await (await get('/api/search/settings')).json()).includes('fixture-session-search-key'));
    const w=await post('/api/workflows',{name:'Narrated idea',steps:[{task:'chat',model:'test/chat',prompt:'{{input}}'},{task:'speech',model:'test/voice',prompt:'{{previous.text}}'}]});assert.ok(w.id);
    const created=await post('/api/run',{name:w.name,input:'Explain a handoff.',switchModels:true,steps:w.steps});assert.ok(created.id);
    let job,sawThinking=false,sawLoading=false,sawReady=false;
    for(let i=0;i<100;i++){
      job=(await (await get('/api/runs')).json()).find(j=>j.id===created.id);
      if(job.partial?.reasoning)sawThinking=true;
      if(job.currentStep===0)assert.equal(job.modelLoad,undefined,'Already-loaded chat should skip model loading');
      if(job.modelLoad?.ready===false){
        assert.deepEqual(job.modelLoad,{id:'test/voice',ready:false});
        sawLoading=true;
        voiceStart.resolve();
      }
      if(!sawReady&&job.modelLoad?.ready===true&&events.some(([action])=>action==='speech')){
        assert.deepEqual(job.modelLoad,{id:'test/voice',ready:true});
        const persisted=JSON.parse(await fs.readFile(path.join(testDir,'runs.json'),'utf8')).find(j=>j.id===created.id);
        assert.equal(persisted.modelLoad,undefined);
        sawReady=true;
        voiceOutput.resolve();
      }
      if(['completed','failed'].includes(job.status))break;
      await pause(70);
    }
    assert.equal(sawLoading,true,'A cold model should report loading before the start request completes');
    assert.equal(sawReady,true,'The model should report readiness while inference is in progress');
    assert.equal(job.modelLoad,undefined,'Completed runs should omit transient loading state');
    assert.equal(job.status,'completed',job.error);assert.equal(sawThinking,true);assert.equal(job.outputs[0].reasoning,'A private model thought.');assert.equal(job.outputs[0].text,'A useful handoff.');assert.equal(job.outputs[0].metrics.totalTokens,18);assert.equal(job.partial,undefined);assert.ok(!JSON.stringify(job).includes('fixture-session-search-key'));assert.equal(job.outputs.length,2);assert.equal(job.restoredModels,true);assert.deepEqual(loaded,['test/chat']);
    assert.equal(job.outputs[0].responseLimit,32768);
    assert.ok(events.some(e=>e[0]==='speech'&&e[1]==='A useful handoff.'));
    assert.ok(!(await fs.readFile(path.join(testDir,'runs.json'),'utf8')).includes('fixture-session-search-key'));
    assert.deepEqual(await post('/api/search/settings',{key:''}),{braveKeyPresent:false});
    const media=await get(job.outputs[1].assets[0].url);assert.equal(media.status,200);assert.equal(media.headers.get('content-type'),'audio/mpeg');
    assert.equal((await get('/catalog.csv')).status,200);
    assert.deepEqual(events.filter(e=>['start','stop'].includes(e[0])),[['stop','test/chat'],['start','test/voice'],['stop','test/voice'],['start','test/chat']]);
    const traceRoute='/api/security/chat-trace',trace=async()=>(await get(traceRoute)).json();
    assert.equal((await fetch(base+traceRoute)).status,403);
    assert.equal((await fetch(base+traceRoute,{method:'POST',headers:{cookie,origin:'https://example.com'},body:'{}'})).status,403);
    assert.deepEqual(await trace(),{active:false,events:[],dropped:0});
    assert.equal((await post(traceRoute,{action:'start'})).active,true);
    const failed=await post('/api/run',{input:'Test a stream failure',steps:[{task:'chat',model:'test/chat',prompt:'{{input}}'}]});
    let failure;for(let i=0;i<60;i++){failure=(await (await get('/api/runs')).json()).find(j=>j.id===failed.id);if(failure.status==='failed')break;await pause(50);}
    assert.equal(failure.status,'failed');assert.ok(failure.error.includes('[redacted]'));assert.ok(!failure.error.includes('fixture-key'));
    const limited=await post('/api/run',{input:'Test an explicit response limit',steps:[{task:'chat',model:'test/chat',prompt:'{{input}}',params:{max_tokens:16384}}]});
    let limitedJob;for(let i=0;i<60;i++){limitedJob=(await (await get('/api/runs')).json()).find(j=>j.id===limited.id);if(['completed','failed'].includes(limitedJob.status))break;await pause(50);}
    assert.equal(limitedJob.status,'completed',limitedJob.error);assert.equal(limitedJob.outputs[0].responseLimit,16384);assert.equal(limitedJob.outputs[0].finishReason,'length');
    assert.deepEqual((await trace()).events.map(e=>[e.kind,e.runId,e.responseType]),[['chat',failed.id,'SSE'],['chat',limited.id,'SSE']]);
    const searchStep={task:'chat',model:'test/chat',params:{_spindleWebSearch:{enabled:true,provider:'duckduckgo',query:''}}};
    const finish=async({id})=>{let run;for(let i=0;i<80;i++){run=(await (await get('/api/runs')).json()).find(j=>j.id===id);if(['completed','failed'].includes(run?.status))return run;await pause(50);}assert.fail('Chat did not reach a terminal state: '+run?.status);};
    const searched=await post('/api/run',{steps:[{...searchStep,prompt:chatPrompt,promptMode:'literal',messages:[{role:'user',content:priorTurn}]}]});
    let partial;
    for(let i=0;i<80;i++){
      partial=(await (await get('/api/runs')).json()).find(run=>run.id===searched.id);
      if(partial?.partial?.reasoning||partial?.status==='failed')break;
      await pause(25);
    }
    assert.equal(partial?.status,'running',partial?.error);
    assert.equal(partial?.partial?.reasoning,'A private model thought.');
    const searchedEvents=(await trace()).events.filter(e=>e.runId===searched.id);
    assert.deepEqual(searchedEvents.map(e=>[e.kind,e.protocol,e.status,e.setCookie]),[['search','https:',200,true],['chat','http:',200,false]]);
    assert.deepEqual(searchedEvents[0].sent,['Current prompt as query']);
    assert.deepEqual(searchedEvents[1].sent,['Current prompt','Tiiny API key','Conversation history','Search evidence']);
    assert.equal(searchedEvents[0].origin,'https://html.duckduckgo.com');
    assert.equal(searchedEvents[1].origin,'http://127.0.0.1:'+device.address().port);
    traceStreamEnd.resolve();
    const chat=await finish(searched);
    assert.equal(chat.status,'completed',chat.error);
    assert.equal(chat.outputs[0].text,'A useful handoff.');
    assert.equal(chat.outputs[0].webSearch.query,chatPrompt);
    const handoff=await finish(await post('/api/run',{input:'Private workflow input',steps:[{...searchStep,prompt:'Summarize {{input}}'}]}));
    assert.equal(handoff.status,'failed');
    assert.match(handoff.error,/explicit web search query/);
    assert.equal(handoff.outputs.length,0);
    showDeviceWebPage=true;
    const offline=await (await get('/api/state')).json();
    assert.equal(offline.offline,true);
    assert.equal(offline.error,'The configured Tiiny endpoint returned an HTML page instead of an API response (HTTP 200).');
    showDeviceWebPage=false;
    const stopped=await post(traceRoute,{action:'stop'});
    assert.equal(stopped.active,false);
    assert.equal(stopped.events.length,5);
    const check=stopped.events.at(-1);
    assert.deepEqual([check.kind,check.status,check.responseType],['check',200,'HTML']);
    assert.doesNotMatch(JSON.stringify(stopped),/Private device web page fixture/);
    const exported=await get(traceRoute+'?export=1');
    assert.match(exported.headers.get('content-disposition'),/attachment/);
    const traceJSON=await exported.text();
    for(const secret of [chatPrompt,priorTurn,'fixture-key','fixture-private-cookie','A private model thought.',searched.id,'127.0.0.1'])assert.ok(!traceJSON.includes(secret));
    assert.equal(JSON.parse(traceJSON).events[3].origin,null);
    assert.equal(JSON.parse(traceJSON).events[4].origin,null);
    assert.deepEqual(await post(traceRoute,{action:'clear'}),{active:false,events:[],dropped:0});

    const filters='days=7&task=speech&model=test%2Fvoice&benchmarks=true';
    const selectedMetrics=await (await get('/api/metrics?'+filters)).json();
    assert.equal(selectedMetrics.cloudUsage.covered,0);
    assert.deepEqual(selectedMetrics.lifetimeCloudUsage,{inputTokens:30,outputTokens:24,covered:4,completed:5,excluded:1});
    const allMetrics=await (await get('/api/metrics?days=0')).json();
    assert.deepEqual(selectedMetrics.lifetimeCloudUsage,allMetrics.cloudUsage);
    const filteredExport=await (await get('/metrics.json?'+filters)).json();
    assert.equal(filteredExport.records.length,0);
    assert.equal(Object.hasOwn(filteredExport,'lifetimeCloudUsage'),false);

    const configured=await post('/api/chat/default',{model:'test/chat'});
    assert.deepEqual(configured,{model:'test/chat'});
    assert.equal((await(await get('/api/state')).json()).defaultChatModel,'test/chat');
    loaded=['test/voice'];
    const beforeWarm=events.length;
    assert.deepEqual(await post('/api/chat/default/load',{}),{status:'occupied'});
    assert.equal(events.length,beforeWarm);
    loaded=[];
    assert.deepEqual(await post('/api/chat/default/load',{}),{status:'ready'});
    assert.deepEqual(loaded,['test/chat']);
    assert.deepEqual(events.slice(beforeWarm),[['start','test/chat']]);
    const local=await finish(await post('/api/run',{tiinyOnly:true,steps:[{...searchStep,prompt:'One local message',params:{_spindleWebSearch:{enabled:true,provider:'duckduckgo',query:'unused private search query'}}}]}));
    assert.equal(local.status,'completed',local.error);
    assert.equal(local.outputs[0].webSearch,undefined);
    assert.deepEqual(local.steps[0].params._spindleWebSearch,{enabled:false});
    assert.doesNotMatch(JSON.stringify(local),/unused private search query/);
  }finally{
    voiceStart.resolve();voiceOutput.resolve();traceStreamEnd.resolve();
    proc.kill();await new Promise(r=>proc.once('exit',r));await new Promise(r=>device.close(r));
    // This directory was created directly under the test directory by mkdtemp.
    assert.ok(testDir.startsWith(path.join(root,'test')+path.sep));await fs.rm(testDir,{recursive:true,force:true});
  }
});
