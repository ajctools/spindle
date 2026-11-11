import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {filmTools,mediaCommand} from '../film.mjs';
import {sourceInfo} from '../rough-cut.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),tools=await filmTools();
test('rough cut reviews takes before export; deleting the export retains the original; power actions and live cues use the correct routes',{skip:!tools.available,timeout:35000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-rough-test-')),data=path.join(dir,'data'),wav=path.join(dir,'input.wav');
  const models=[{id:'test/asr',type:'ASR'},{id:'test/decision',type:'Text Classification'}],power=[];
  let asr=0,ac=false,deviceBusy=true,server;
  const device=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks).toString(),json=x=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
    switch(req.url){
      case '/api/v1/models/online_models':case '/api/v1/models/':case '/v1/models':return json({data:models});
      case '/api/v1/npu/status':return json({devices:[]});
      case '/api/v1/tasks':return json({tasks:deviceBusy?[{status:'running'}]:[]});
      case '/v1/audio/transcriptions':return json({text:asr++?'Open the model shelf.':'Open the mod—'});
      case '/v1/systemone':{const q=JSON.parse(body).questions;if(q.cue)return json({answers:{cue:{choice:'heartbeat',probabilities:{heartbeat:.9}}}});return json({answers:{take1:{choice:'replaced',probabilities:{replaced:.95}}}});}
      case '/api/v1/sys/ac_power/':if(req.method==='POST')ac=JSON.parse(body).switch===1;return json({ac_power:ac});
      case '/api/v1/sys/reboot/':case '/api/v1/sys/shutdown/':power.push(req.url);return json({ok:true});
      default:res.statusCode=404;return json({error:'Unknown route'});
    }
  });
  try{
    await mediaCommand(process.env.SPINDLE_FFMPEG||'ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=1','-f','lavfi','-i','anullsrc=r=44100:cl=mono:d=1','-f','lavfi','-i','sine=frequency=880:duration=1','-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1','-c:a','pcm_s16le',wav]);
    await new Promise(r=>device.listen(0,'127.0.0.1',r));
    const temp=http.createServer();await new Promise(r=>temp.listen(0,'127.0.0.1',r));const port=temp.address().port;await new Promise(r=>temp.close(r));
    server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,TIINY_HOST:'http://127.0.0.1:'+device.address().port,TIINY_KEY:'fixture-key',SPINDLE_DATA_DIR:data,SPINDLE_PORT:String(port)},stdio:'ignore'});
    const base='http://127.0.0.1:'+port;
    let home;for(let i=0;i<50;i++){try{home=await fetch(base);if(home.ok)break;}catch{}await delay(100);}
    assert.ok(home?.ok);
    const cookie=home.headers.get('set-cookie').split(';')[0],get=p=>fetch(base+p,{headers:{cookie}}),post=(p,b)=>fetch(base+p,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(b)});
    assert.equal((await fetch(base+'/api/foley/cue',{method:'HEAD',headers:{cookie}})).status,204);
    const cue=await (await post('/api/foley/cue',{text:'Only her heartbeat.'})).json();assert.equal(cue.cue,'heartbeat');assert.equal(cue.score,.9);assert.equal(cue.model,'test/decision');
    assert.equal((await post('/api/device/power',{action:'shutdown',confirm:true})).status,400);
    assert.equal((await post('/api/device/power',{action:'shutdown'})).status,400);
    assert.deepEqual(power,[]);
    assert.equal((await post('/api/device/power',{action:'ac-power',enabled:true,confirm:true})).status,200);
    assert.equal((await (await get('/api/device/power')).json()).acPower,true);
    deviceBusy=false;
    assert.equal((await post('/api/device/power',{action:'restart',confirm:true})).status,200);
    assert.deepEqual(power,['/api/v1/sys/reboot/']);
    const bytes=await fs.readFile(wav),created=await post('/api/rough-cut/analyze',{asr:'test/asr',decision:'test/decision',file:{name:'input.wav',data:'data:audio/wav;base64,'+bytes.toString('base64')}});
    assert.equal(created.status,202);const {id}=await created.json();
    let job;for(let i=0;i<100;i++){job=(await(await get('/api/runs')).json()).find(j=>j.id===id);if(['completed','failed'].includes(job.status))break;await delay(80);}
    assert.equal(job.status,'completed',job.error);assert.deepEqual(job.roughCut.segments.map(x=>x.cut),[true,false]);
    assert.equal((await post('/api/rough-cut/export',{id,cuts:[0,1]})).status,400);
    const output=await(await post('/api/rough-cut/export',{id,cuts:[0]})).json(),assetDir=path.join(data,'assets');
    assert.equal((await sourceInfo(path.join(assetDir,path.basename(output.url)))).duration,1.5);
    assert.deepEqual(await fs.readFile(path.join(assetDir,path.basename(job.roughCut.sourceAsset))),bytes);
    assert.equal((await post('/api/library/delete',{url:output.url})).status,200);
    assert.equal((await (await get('/api/runs')).json()).find(j=>j.id===id).finalOutput.assets.length,0);
    assert.equal((await get(output.url)).ok,false);
    assert.ok((await fs.stat(path.join(data,'trash',path.basename(output.url)))).size>0);
  }finally{
    if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill();await stopped;}
    if(device.listening)await new Promise(r=>device.close(r));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
