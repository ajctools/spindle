import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createCustomEndpoints} from '../custom-endpoints.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

test('cloud profiles use HTTPS, preserve their type, and mask keys',async t=>{
  let stored=[];
  const readJSON=async()=>stored,writeJSON=async(_file,next)=>{stored=next;};
  const profiles=await createCustomEndpoints({readJSON,writeJSON});
  const request=t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://cloud.example.org/v1/models');
    assert.equal(options.headers.Authorization,'Bearer fixture-cloud-key');
    return Response.json({data:[{id:'example-model'}]});
  });
  const profile={kind:'cloud',name:'Cloud fixture',url:'http://cloud.example.org/v1',key:'fixture-cloud-key'};
  await assert.rejects(profiles.save(profile),/require an HTTPS/);
  assert.equal(request.mock.callCount(),0);
  const saved=await profiles.save({...profile,url:'https://cloud.example.org/v1'});
  assert.equal(saved.kind,'cloud');
  assert.equal(saved.key,undefined);
  assert.equal(stored[0].key,undefined);
  assert.equal(profiles.forRun(saved.id,'example-model').key,'fixture-cloud-key');
  await assert.rejects(profiles.save({...profile,...saved,kind:'custom'}),/change the endpoint type/);
  const reopened=await createCustomEndpoints({readJSON,writeJSON});
  assert.equal(reopened.list()[0].kind,'cloud');
  assert.equal(reopened.list()[0].needsKey,true);
});

async function serve(handler){
  const server=http.createServer(handler).listen(0,'127.0.0.1');
  await once(server,'listening');
  return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{
    server.closeAllConnections();server.close(resolve);
  })};
}
async function waitFor(fn){
  for(let i=0;i<150;i++){const value=await fn();if(value)return value;await delay(30);}
  throw Error('Mock Spindle did not reach the expected state.');
}

test('custom chat isolates endpoints with overlapping models, keeps history, and persists keys only on request',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-endpoints-'));
  t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const seen=[],model='same-model';
  const makeEndpoint=async label=>serve(async(req,res)=>{
    const entry={label,route:req.url,key:req.headers.authorization};
    seen.push(entry);
    if(req.url==='/redirect/models'){
      res.writeHead(302,{location:alpha.origin+'/openai/v1/models'});res.end();return;
    }
    if(req.url.endsWith('/models')){
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({data:[{id:model}]}));return;
    }
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    entry.body=JSON.parse(Buffer.concat(chunks));
    const key=entry.key?.slice(7)||'none';
    const content=label+' reply; echoed key: '+key+'; encoded key: '+Buffer.from(key).toString('base64');
    const usage={prompt_tokens:12,completion_tokens:8,total_tokens:20};
    if(entry.body.stream){
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const write=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
      write({choices:[{delta:{reasoning_content:'Reasoning from '+label}}]});
      write({choices:[{delta:{content},finish_reason:'stop'}]});
      write({choices:[],usage});res.end('data: [DONE]\n\n');
    }else{
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage}));
    }
  });
  const alpha=await makeEndpoint('alpha'),beta=await makeEndpoint('beta');
  t.after(alpha.close);t.after(beta.close);
  const reservation=await serve(),base=reservation.origin;await reservation.close();
  const env={...process.env,SPINDLE_PORT:new URL(base).port,SPINDLE_DATA_DIR:folder,TIINY_CONFIG:path.join(folder,'no-cli.json')};
  delete env.TIINY_HOST;delete env.TIINY_KEY;
  let helper,exited,cookie;
  const stop=async()=>{if(helper){helper.kill();await exited;helper=null;}};
  t.after(stop);
  const start=async()=>{
    helper=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore'});
    exited=once(helper,'exit');
    const response=await waitFor(()=>fetch(base).catch(()=>null));
    cookie=response.headers.get('set-cookie').split(';')[0];await response.body.cancel();
  };
  const api=async(route,body)=>{
    const response=await fetch(base+route,{headers:{cookie,'Content-Type':'application/json'},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
    return {status:response.status,body:await response.json()};
  };
  await start();
  assert.equal((await fetch(base+'/api/endpoints')).status,403);
  const a=await api('/api/endpoints',{name:'Alpha',url:alpha.origin+'/openai/v1/',key:'synthetic-alpha-token'});
  const b=await api('/api/endpoints',{name:'Beta',url:beta.origin,key:'synthetic-beta-token',remember:true});
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.deepEqual(a.body.models,[model]);assert.deepEqual(b.body.models,[model]);
  assert.equal((await api('/api/state')).body.offline,true);
  assert.doesNotMatch(JSON.stringify((await api('/api/endpoints')).body),/synthetic-.*-token/);
  assert.equal((await api('/api/endpoints',{id:a.body.id,name:'Alpha',url:beta.origin})).status,400);
  assert.equal((await api('/api/endpoints',{name:'Redirect',url:beta.origin+'/redirect',key:'synthetic-redirect-token'})).status,400);
  assert.equal(seen.filter(row=>row.label==='alpha'&&row.route.endsWith('/models')).length,1);

  const send=(endpoint,extra={},params={})=>api('/api/run',{endpointId:endpoint.id,switchModels:true,...extra,
    steps:[{task:'chat',model,promptMode:'literal',prompt:'First line',attachments:[{name:'note.txt',text:'Attached line'}],messages:[{role:'user',content:'Earlier turn'}],params}]});
  assert.equal((await send(a.body,{vaultReference:{}})).status,400);
  const sent=await send(a.body,{}, {_spindleWebSearch:{enabled:true,query:'Do not search'},_spindleStream:true});
  assert.equal(sent.status,202);
  const finished=id=>waitFor(async()=>{
    const {body}=await api('/api/runs?id='+id);
    return ['queued','running'].includes(body.status)?null:body;
  });
  const reply=await finished(sent.body.id);
  assert.equal(reply.status,'completed',reply.error);
  assert.equal(reply.switchModels,false);
  assert.equal(reply.outputs[0].reasoning,'Reasoning from alpha');
  assert.match(reply.outputs[0].text,/alpha reply; echoed key: \[redacted\]/);
  assert.match(reply.outputs[0].text,/encoded key: \[redacted\]/);
  assert.ok(!(await fs.readFile(path.join(folder,'runs.json'),'utf8')).includes(Buffer.from('synthetic-alpha-token').toString('base64')));
  assert.equal(reply.outputs[0].metrics.totalTokens,20);
  assert.equal(reply.outputs[0].measurement.resources,null);
  assert.equal(reply.outputs[0].responseLimit,null);
  const call=seen.find(row=>row.route.endsWith('/chat/completions'));
  assert.equal(call.route,'/openai/v1/chat/completions');
  assert.equal(call.key,'Bearer synthetic-alpha-token');
  assert.deepEqual(call.body.messages.map(m=>m.role),['user','user']);
  assert.match(call.body.messages.at(-1).content,/Attached line/);
  assert.equal(call.body._spindleWebSearch,undefined);
  assert.ok(!seen.some(row=>row.label==='beta'&&row.route.endsWith('/chat/completions')));

  const workflow={name:'Two routes',input:'Workflow input',steps:[
    {task:'chat',model,endpointId:a.body.id,prompt:'First: {{input}}'},
    {task:'chat',model,endpointId:b.body.id,prompt:'Second: {{previous.text}}'},
  ]};
  assert.equal((await api('/api/workflow/run',workflow)).status,400);
  const recipe=await api('/api/workflows',workflow);
  assert.equal(recipe.body.steps[1].endpointId,b.body.id);
  const routed=await api('/api/workflow/run',{...workflow,confirmEndpoints:true});
  assert.equal(routed.status,202,JSON.stringify(routed.body));
  const routedReply=await finished(routed.body.id);
  assert.equal(routedReply.status,'completed',routedReply.error);
  assert.deepEqual(routedReply.outputs.map(output=>output.endpointName),['Alpha','Beta']);
  const workflowCalls=seen.filter(entry=>entry.body).slice(-2);
  assert.equal(workflowCalls[0].body.messages[0].content,'First: Workflow input');
  assert.match(workflowCalls[1].body.messages[0].content,/Second: alpha reply/);
  assert.doesNotMatch(workflowCalls[1].body.messages[0].content,/synthetic-alpha-token/);

  await stop();await start();
  assert.equal((await send(a.body)).status,400);
  const betaRun=await send(b.body,{previousChatRunId:reply.id},{_spindleStream:false});
  const betaReply=await finished(betaRun.body.id);
  assert.equal(betaReply.status,'completed',betaReply.error);
  assert.equal(betaReply.previousChatRunId,undefined);
  assert.equal(seen.at(-1).route,'/v1/chat/completions');
  assert.equal(seen.at(-1).key,'Bearer synthetic-beta-token');
  assert.equal((await api('/api/endpoints/remove',{id:b.body.id})).status,200);
  assert.equal((await send(b.body)).status,400);
  assert.doesNotMatch(await fs.readFile(path.join(folder,'runs.json'),'utf8'),/synthetic-.*-token/);
});
