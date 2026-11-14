import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {csvCell,cleanHardware,redactError,requestAccess} from '../security.mjs';
import {normalize} from '../core.mjs';

test('untrusted model capacity and size strings cannot enter numeric UI fields',()=>{
  const model={id:'fixture/chat',type:'Text Generation',name:'Fixture',npu_usage:'<img id="untrusted">',size:'<img id="untrusted">'};
  const result=normalize([model],[model],[])[0];assert.equal(result.npu,null);assert.equal(result.storeNpu,null);assert.equal(result.size,null);
});

test('hardware serialization excludes identifiers and arbitrary nested device fields',()=>{
  const hardware=cleanHardware({devices:[{util_percent:2,mem_used_mb:20,mem_total_mb:100,serial_number:'private-device',mac_address:'private-interface'}],cpu:{total_percent:3,hostname:'private-host'},memory:{usage_percent:4,owner:'private-owner'},npu:{device_sn:'private-device'}});
  assert.equal(hardware.cpu.total_percent,3);assert.equal(hardware.devices[0].mem_used_mb,20);
  assert.ok(!JSON.stringify(hardware).includes('private-'));assert.equal(cleanHardware({devices:[{}]}).devices[0].util_percent,null);
});
test('CSV cells neutralize formulas, including leading whitespace and control characters',()=>{
  for(const value of ['=1+1','+SUM(A1)','-1+1','@SUM(A1)','\t=1','\r\n=1',' \u0000=1'])assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('ordinary "text"'),'"ordinary ""text"""');assert.equal(csvCell(12),'"12"');
});
test('diagnostic redaction removes keys, encoded key variants and local user paths',()=>{
  const key='fixture/private+key',winPath=['C:','Users','Example','data','output.png'].join(String.fromCharCode(92)),posixPath=['','home','example','data','output.png'].join('/');
  const result=redactError([key,encodeURIComponent(key),Buffer.from(key).toString('base64'),winPath,posixPath].join(' '),[key]);
  assert.ok(!result.includes(key));assert.ok(!result.includes('Example'));assert.ok(!result.includes('example'));assert.ok(result.includes('[redacted]'));assert.ok(result.includes('[local path]'));
});
test('access policy protects private reads, bootstrap and writes from other origins',()=>{
  const context={port:18440,secret:'test-session',pathname:'/api/runs'},req={method:'GET',headers:{host:'127.0.0.1:18440',cookie:'spindle=test-session'}};
  assert.equal(requestAccess(req,context),null);
  for(const headers of [{cookie:''},{origin:'https://example.org'},{origin:'null'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},{host:'attacker.invalid:18440'}])assert.equal(requestAccess({...req,headers:{...req.headers,...headers}},context).status,403);
  assert.equal(requestAccess({...req,headers:{host:req.headers.host,'sec-fetch-site':'cross-site'}},{...context,pathname:'/api/session'}).status,403);
});
test('HTTP privacy boundaries reject unauthenticated reads, rebinding, cross-origin bootstrap and redirects',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),data=await fs.mkdtemp(path.join(root,'test','.runtime-'));
  let stolen=0;const sink=http.createServer((req,res)=>{stolen++;res.end('unexpected');});await new Promise(r=>sink.listen(0,'127.0.0.1',r));
  const device=http.createServer((req,res)=>{res.writeHead(302,{Location:'http://127.0.0.1:'+sink.address().port+'/untrusted'});res.end();});await new Promise(r=>device.listen(0,'127.0.0.1',r));
  const env={...process.env,SPINDLE_PORT:'18440',SPINDLE_DATA_DIR:data,TIINY_CONFIG:path.join(data,'missing-config.json')};delete env.TIINY_HOST;delete env.TIINY_KEY;
  const html='<!doctype html><html><head><title>Fixture app</title></head><body><script>document.title = "Running";</script></body></html>';
  const preview='/api/chat/preview?id=fixture-app&step=0';
  await fs.writeFile(path.join(data,'runs.json'),JSON.stringify([{id:'fixture-app',status:'completed',steps:[{task:'chat'},{task:'chat'}],outputs:[
    {task:'chat',text:'Here is the app.\n\n```html\n'+html+'\n```\n',finishReason:'stop'},
    {task:'chat',text:html,finishReason:'length'},
  ]}]));
  const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:'ignore'}),base='http://127.0.0.1:18440';
  try{
    await fs.writeFile(path.join(data,'tiiny-foley.html'),'<title>Private local fixture</title>');
    for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await pause(100);}
    const home=await fetch(base),cookie=home.headers.get('set-cookie').split(';')[0];
    assert.match(home.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
    assert.ok((await home.text()).includes('SPINDLE / COMPANION V'+version+'</div>'));
    const routes=['/api/connection','/api/runs','/api/state','/api/readiness','/api/workflows','/api/telemetry','/api/device-ledger','/api/metrics','/api/vault/documents','/catalog.json','/catalog.csv','/metrics.json','/metrics.csv','/foley','/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'];
    for(const route of routes)assert.equal((await fetch(base+route)).status,403,route);
    assert.equal((await fetch(base+'/api/session',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
    assert.equal((await fetch(base+'/api/connection',{headers:{cookie,origin:'https://example.org'}})).status,403);
    assert.equal((await fetch(base+'/foley',{headers:{cookie,'sec-fetch-site':'cross-site'}})).status,403);
    const foley=await fetch(base+'/foley',{headers:{cookie}});
    assert.equal(foley.status,200);
    assert.equal(foley.headers.get('set-cookie'),null);
    assert.equal(await foley.text(),'<title>Private local fixture</title>');
    assert.equal((await fetch(base+preview)).status,403);
    const app=await fetch(base+preview,{headers:{cookie,'sec-fetch-site':'same-origin'}});
    assert.equal(app.status,200);
    assert.equal(await app.text(),html);
    const policy=app.headers.get('content-security-policy');
    assert.match(policy,/connect-src 'none'/);
    assert.match(policy,/frame-ancestors 'self'; sandbox allow-scripts$/);
    assert.equal((await fetch(base+preview.replace('step=0','step=1'),{headers:{cookie}})).status,404);
    const rebound=await new Promise((resolve,reject)=>{http.get(base+'/api/connection',{headers:{cookie,Host:'attacker.invalid:18440'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(rebound,403);
    const local=await fetch(base+'/api/connection',{headers:{cookie}});assert.equal(local.status,200);assert.equal(local.headers.get('cross-origin-resource-policy'),'same-origin');assert.match(local.headers.get('content-security-policy'),/base-uri 'none'/);
    for(const route of ['/data/connection.json','/.env','/server.mjs','/.git/config'])assert.equal((await fetch(base+route,{headers:{cookie}})).status,404);
    const missing=await(await fetch(base+'/assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png',{headers:{cookie}})).text();assert.ok(!missing.includes(data));assert.ok(missing.includes('[local path]'));
    const malformed=await fetch(base+'/api/connection/test',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{"key":"fixture-malformed-body-key"'});
    assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{error:'The request body is not valid JSON.'});
    const redirected=await fetch(base+'/api/connection/test',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({endpoint:'http://127.0.0.1:'+device.address().port,key:'redirect-fixture-key',hostRouting:false})});
    assert.equal(redirected.status,400);assert.equal(stolen,0);assert.ok(!(await redirected.text()).includes('redirect-fixture-key'));
  }finally{proc.kill();await new Promise(r=>proc.once('exit',r));await Promise.all([new Promise(r=>device.close(r)),new Promise(r=>sink.close(r))]);assert.ok(data.startsWith(path.join(root,'test')+path.sep));await fs.rm(data,{recursive:true,force:true});}
});
