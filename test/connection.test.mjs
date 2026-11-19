import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {normalizeConnection,deviceURL,publicConnection,createTiinyRelay} from '../connection.mjs';

test('endpoint parsing preserves API prefixes and rejects credential leaks across origins',()=>{
  const c=normalizeConnection({endpoint:'http://192.0.2.10/openai/v1/',key:'secret'});
  assert.equal(deviceURL(c,'/v1/chat/completions','openai'),'http://192.0.2.10/openai/v1/chat/completions');
  assert.equal(deviceURL(c,'/v1/videos'),'http://192.0.2.10/v1/videos');
  assert.equal(deviceURL(c,'/api/v1/models/'),'http://192.0.2.10/api/v1/models/');
  assert.ok(!JSON.stringify(publicConnection(c,'test')).includes('secret'));
  for(const endpoint of ['https://user:password@example.com','https://example.com?key=abc','file:///etc/passwd'])assert.throws(()=>normalizeConnection({endpoint,key:'a'}));
  assert.throws(()=>normalizeConnection({endpoint:'http://192.0.2.10',nativeEndpoint:'https://other.example/v1',key:'a'}),/same origin/);
});

test('Tiiny USB relay keeps the saved device identity and falls back only after a Tiiny API probe',async()=>{
  const connection=normalizeConnection({endpoint:'http://192.0.2.10/custom/v1',key:'owner-key'});
  const relayOrigin='http://127.0.0.1:18438';
  const target=deviceURL(connection,'/api/v1/models/?view=full');
  const probes=[];
  let clock=1,lanOnline=true,usbOnline=true;
  const relay=createTiinyRelay({endpoint:connection.endpoint,origin:relayOrigin},{
    now:()=>clock,
    async request(url,options){
      probes.push(url);
      assert.deepEqual(options.headers,{Host:'openai.api.tiiny'});
      assert.equal(options.redirect,'error');
      if(url.startsWith(connection.url)?lanOnline:usbOnline){
        return Response.json({error:'unauthorized',reason:'missing_token'},{status:401});
      }
      return new Response('Other service',{status:401});
    },
  });
  assert.equal(await relay.target(connection,target),target);
  lanOnline=false;
  relay.invalidate();
  const routed=relayOrigin+'/api/v1/models/?view=full';
  assert.deepEqual(await Promise.all([relay.target(connection,target),relay.target(connection,target)]),[routed,routed]);
  assert.deepEqual(probes,[connection.endpoint+'/models',connection.endpoint+'/models',relayOrigin+'/custom/v1/models']);
  const other={...connection,endpoint:connection.url+'/other/v1'};
  assert.equal(await relay.target(other,target),target);
  lanOnline=true;
  assert.equal(await relay.target(connection,target),routed);
  clock+=15000;
  assert.equal(await relay.target(connection,target),target);
  lanOnline=false;
  usbOnline=false;
  relay.invalidate();
  assert.equal(await relay.target(connection,target),target);
  assert.throws(()=>createTiinyRelay({endpoint:connection.endpoint,origin:'http://192.0.2.20:18438'}),/loopback/);
});
test('new owners can test, save, reconnect, and reset without a Tiiny CLI installation',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),data=await fs.mkdtemp(path.join(root,'test','.runtime-'));
  const device=http.createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer owner-key');
    assert.equal(req.url,'/custom/v1/models');res.setHeader('content-type','application/json');res.end('{"data":[{"id":"owner/chat"}]}');
  });await new Promise(r=>device.listen(0,'127.0.0.1',r));
  const endpoint='http://127.0.0.1:'+device.address().port+'/custom/v1';
  const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const env={...process.env,SPINDLE_PORT:String(port),SPINDLE_DATA_DIR:data,TIINY_CONFIG:path.join(data,'no-cli-config.json')};delete env.TIINY_HOST;delete env.TIINY_KEY;
  const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore'}),base='http://127.0.0.1:'+port;
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await pause(100);}
    const home=await fetch(base),cookie=home.headers.get('set-cookie').split(';')[0];
    const get=route=>fetch(base+route,{headers:{cookie}});
    const post=async(p,b)=>{const r=await fetch(base+p,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json()};};
    assert.equal((await(await get('/api/connection')).json()).keyPresent,false);
    const fields={endpoint,key:'owner-key',hostRouting:false,remember:true};
    assert.equal((await post('/api/connection/test',fields)).body.loadedModels,1);
    assert.equal((await post('/api/connection',fields)).body.keyPresent,true);
    const info=await(await get('/api/connection')).json();assert.equal(info.remembered,true);assert.ok(!JSON.stringify(info).includes('owner-key'));
    assert.equal(JSON.parse(await fs.readFile(path.join(data,'connection.json'),'utf8')).key,'owner-key');
    assert.match((await post('/api/connection/test',{endpoint:'http://another-device.local',key:''})).body.error,/new endpoint/);
    assert.equal((await post('/api/connection/reset',{})).body.ok,true);
    assert.equal((await(await get('/api/connection')).json()).keyPresent,false);
  }finally{proc.kill();await new Promise(r=>proc.once('exit',r));await new Promise(r=>device.close(r));assert.ok(data.startsWith(path.join(root,'test')+path.sep));await fs.rm(data,{recursive:true,force:true});}
});
