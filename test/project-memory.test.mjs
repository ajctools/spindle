import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {embeddingRows,memoryContext,rankCheckpoints} from '../project-memory.mjs';

test('project recall requires relevant evidence and bounds automatic context',()=>{
  const note={id:'note',title:'Graphics card selection',brief:'The 3090 was ruled out because of cooling limits.'};
  assert.equal(rankCheckpoints([note],'Why skip the RTX-3090?')[0].checkpoint,note);
  assert.deepEqual(rankCheckpoints([note],'Find a pizza recipe'),[]);
  const [query,match]=embeddingRows({data:[{index:1,embedding:[3,0]},{index:0,embedding:[1,0]}]},2);
  assert.equal(rankCheckpoints([note],'Accelerator decision',query,new Map([['note',match]]))[0].checkpoint,note);
  assert.equal(embeddingRows({data:[{embedding:[0,0]}]},1),null);
  const large={title:'Large',brief:'x'.repeat(2800),result:'x'.repeat(5000)};
  const context=memoryContext([{checkpoint:large,mode:'brief'},{checkpoint:large,mode:'brief'}]);
  assert.equal(context.reduce((sum,item)=>sum+item.text.length,0),3200);
  assert.equal(memoryContext([{checkpoint:large,mode:'result'}])[0].text,large.result);
});

test('chat recalls selected project checkpoints before web search and keeps search inputs private',async t=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const folder=await fs.mkdtemp(path.join(root,'test','.runtime-project-'));
  const models=[{id:'fixture/chat',type:'Text Generation',name:'Chat'},{id:'fixture/embedding',type:'Text Embedding',name:'Embedding'}];
  const result='## Graphics card selection\nThe 3090 was ruled out because of a private cooling constraint.';
  const savedBrief='A private cooling constraint ruled out the 3090.';
  const semanticPrompt='Which accelerator hit the thermal ceiling?';
  const freshPrompt='What is a used 3090 selling for today?';
  const ordinaryPrompt='Find a pizza recipe';
  const calls=[];
  let embeddingLoaded=true,singleEmbeddingOnly=false;
  const device=http.createServer(async(req,res)=>{
    const send=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
    const url=new URL(req.url,'http://mock');
    if(url.pathname==='/api/v1/models/online_models'||url.pathname==='/api/v1/models/')return send({data:models});
    if(url.pathname==='/v1/models')return send({data:embeddingLoaded?models:models.slice(0,1)});
    if(url.pathname==='/v1/embeddings'||url.pathname==='/v1/chat/completions'){
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      if(url.pathname==='/v1/embeddings'){
        calls.push({kind:'embed',input:body.input});
        if(singleEmbeddingOnly&&Array.isArray(body.input)){res.statusCode=400;return send({error:'Expected one string'});}
        const inputs=Array.isArray(body.input)?body.input:[body.input];
        return send({data:inputs.map((text,index)=>({index,embedding:/pizza|off-topic/i.test(text)?[0,1]:[1,0]}))});
      }
      const instruction=body.messages[0].content;
      if(instruction.startsWith('Decide whether')){
        calls.push({kind:'plan',body});
        const ask=body.messages.at(-1).content;
        return send({choices:[{message:{content:JSON.stringify({query:ask===freshPrompt?'used 3090 pricing':null,alternate:null})},finish_reason:'stop'}]});
      }
      if(instruction.startsWith('Select the search excerpts')){
        calls.push({kind:'review',body});
        return send({choices:[{message:{content:'{"sources":[1],"complete":true}'},finish_reason:'stop'}]});
      }
      if(instruction.startsWith('Write a project checkpoint brief'))return send({choices:[{message:{content:savedBrief},finish_reason:'stop'}]});
      calls.push({kind:'answer',body});
      return send({choices:[{message:{content:result},finish_reason:'stop'}]});
    }
    return send({data:[]});
  });
  device.listen(0,'127.0.0.1');await once(device,'listening');
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const {port}=reserve.address();await new Promise(resolve=>reserve.close(resolve));
  const webLog=path.join(folder,'web.log');
  const preload=path.join(folder,'web-fixture.mjs');
  await fs.writeFile(preload,`import fs from 'node:fs/promises';
const fixtureFetch=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
  if(new URL(url).hostname==='127.0.0.1')return fixtureFetch(url,options);
  await fs.appendFile(${JSON.stringify(webLog)},String(url)+'\\n');
  return new Response('fixture search returned no results',{status:200});
};`);
  const helper=spawn(process.execPath,['--import',pathToFileURL(preload).href,'server.mjs'],{cwd:root,
    env:{...process.env,SPINDLE_PORT:String(port),SPINDLE_DATA_DIR:folder,TIINY_CONFIG:path.join(folder,'unused.json'),
      TIINY_HOST:`http://127.0.0.1:${device.address().port}`,TIINY_KEY:'mock-local-key'},stdio:['ignore','pipe','pipe']});
  const exited=once(helper,'exit');
  t.after(async()=>{helper.kill();await exited;device.closeAllConnections();await new Promise(resolve=>device.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  const waitFor=async operation=>{
    for(let count=0;count<200;count++){
      const value=await operation();
      if(value)return value;
      await sleep(40);
    }
    throw Error('Timed out waiting for the mock Spindle helper.');
  };
  const home=await waitFor(()=>fetch(base).catch(()=>null));
  const cookie=home.headers.get('set-cookie').split(';')[0];
  const api=async(route,body)=>{
    const response=await fetch(base+route,{headers:{cookie,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
    const payload=await response.json();
    assert.ok(response.ok,JSON.stringify(payload));
    return payload;
  };
  const projects='/api/projects';
  const project=(await api(projects,{action:'create',name:'Private GPUs project'})).id;
  const other=(await api(projects,{action:'create',name:'Other project'})).id;
  assert.equal((await fetch(base+projects)).status,403);
  assert.equal((await fetch(base+'/project-memory.mjs')).status,200);
  await api('/api/state');
  const chat=async(prompt,fields={})=>{
    const run=await api('/api/run',{steps:[{model:'fixture/chat',task:'chat',prompt,promptMode:'literal',params:{_spindleWebSearch:{enabled:true}}}],keepChatModel:true,...fields});
    const complete=await waitFor(async()=>{
      const job=await api('/api/runs?id='+run.id);
      return ['queued','running'].includes(job.status)?null:job;
    });
    assert.equal(complete.status,'completed',complete.error);
    return complete;
  };
  const source=await chat('Initial investigation',{projectId:project});
  assert.deepEqual((await api(projects+'?id='+project)).checkpoints,[]);
  const checkpoint=await api(projects,{action:'save',projectId:project,runId:source.id});
  assert.equal(checkpoint.result,result);
  assert.equal((await api(projects,{action:'save',projectId:project,runId:source.id})).id,checkpoint.id);
  await waitFor(async()=>{
    const response=await fetch(base+'/api/runs',{headers:{cookie}});
    await response.body?.cancel();
    return response.headers.has('etag');
  });
  assert.equal((await api(projects,{action:'draft',projectId:project,checkpointId:checkpoint.id})).brief,savedBrief);
  await api(projects,{action:'edit',projectId:project,checkpointId:checkpoint.id,title:checkpoint.title,brief:savedBrief});

  calls.length=0;
  const recalled=await chat(semanticPrompt,{projectId:project});
  assert.equal(recalled.recalledMemory[0].id,checkpoint.id);
  assert.deepEqual(calls.map(call=>call.kind),['embed','plan','answer']);
  assert.match(JSON.stringify(calls[2].body),/private cooling constraint/);
  const offTopic=await chat(ordinaryPrompt,{projectId:project});
  assert.deepEqual(offTopic.recalledMemory,[]);
  assert.deepEqual((await chat(semanticPrompt,{projectId:other})).recalledMemory,[]);
  assert.equal((await chat(semanticPrompt,{projectId:project,memoryRequest:{paused:true}})).recalledMemory,undefined);

  const fresh=await chat(freshPrompt,{projectId:project});
  assert.equal(fresh.recalledMemory[0].id,checkpoint.id);
  const web=await fs.readFile(webLog,'utf8');
  assert.match(web,/used[+%20]+3090[+%20]+pricing/);
  assert.doesNotMatch(web,/private|cooling|project/i);
  for(const call of calls.filter(item=>['plan','review'].includes(item.kind)))assert.doesNotMatch(JSON.stringify(call.body),/private cooling|Private GPUs project|Graphics card selection/);

  singleEmbeddingOnly=true;
  await api(projects,{action:'edit',projectId:project,checkpointId:checkpoint.id,title:checkpoint.title,brief:savedBrief});
  calls.length=0;
  assert.equal((await chat(semanticPrompt,{projectId:project})).recalledMemory[0].id,checkpoint.id);
  assert.deepEqual(calls.filter(call=>call.kind==='embed').map(call=>typeof call.input),['object','string','string']);

  embeddingLoaded=false;
  const keyword=await chat('Why did we rule out the 3090?',{projectId:project});
  assert.equal(keyword.recalledMemory[0].id,checkpoint.id);
  const resume=await chat('Continue',{projectId:project,memoryRequest:{checkpointId:checkpoint.id,mode:'brief'}});
  assert.equal(resume.recalledMemory[0].mode,'brief');
  const ambiguous=await chat('Is it still cheaper today?',{projectId:project,memoryRequest:{checkpointId:checkpoint.id,mode:'brief'}});
  assert.match(ambiguous.outputs[0].webSearchWarning,/Enter a public search query/);
  const refined=await chat('Revise this result',{projectId:project,memoryRequest:{checkpointId:checkpoint.id,mode:'result'}});
  assert.equal(refined.recalledMemory[0].mode,'result');

  const imported=await api(projects,{action:'import',bundle:{format:'spindle-project',version:1,name:'Imported',checkpoints:[checkpoint]}});
  assert.equal((await api(projects+'?id='+imported.id)).checkpoints[0].result,result);
  const marker='fixture for project storage removal';
  const temporary=await api(projects,{action:'import',bundle:{format:'spindle-project',version:1,name:'Deletion fixture',checkpoints:[
    {title:'Deletion check',brief:marker,result:marker.repeat(30)},
  ]}});
  const projectFiles=async()=> (await fs.readdir(folder)).filter(name=>/^projects\.(?:sqlite|json)/.test(name));
  const containsMarker=async()=> (await Promise.all((await projectFiles()).map(name=>fs.readFile(path.join(folder,name)))))
    .some(bytes=>bytes.includes(marker));
  assert.equal(await containsMarker(),true);
  const temporaryCheckpoint=(await api(projects+'?id='+temporary.id)).checkpoints[0];
  await api(projects,{action:'remove',projectId:temporary.id,checkpointId:temporaryCheckpoint.id});
  assert.equal(await containsMarker(),false);
  assert.ok(!(await projectFiles()).some(name=>/-(?:wal|shm|journal)$/.test(name)));
  await api(projects,{action:'remove',projectId:project,checkpointId:checkpoint.id});
  assert.deepEqual((await chat('Why did we rule out the 3090?',{projectId:project})).recalledMemory,[]);
});
