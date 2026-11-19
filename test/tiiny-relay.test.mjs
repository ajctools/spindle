import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createConnection} from 'node:net';
import {createTiinyRelayProxy} from '../scripts/tiiny-usb-relay.mjs';

test('travel relay reconnects through available adapters and probes before forwarding credentials',async()=>{
  const forwarded=[],probedAdapters=[],connectedAdapters=[];
  let tiiny=true;
  const device=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(!req.headers.authorization){
      assert.equal(req.url,'/v1/models');
      assert.equal(req.headers.host,'openai.api.tiiny');
      res.writeHead(401);
      res.end(JSON.stringify(tiiny?{error:'unauthorized',reason:'missing_token'}:{error:'different-service'}));
      return;
    }
    let body='';
    for await(const chunk of req)body+=chunk;
    forwarded.push({authorization:req.headers.authorization,url:req.url,body,source:req.socket.remoteAddress});
    res.end('{"ok":true}');
  });
  const realLoopback='127.0.0.1';
  await new Promise(resolve=>device.listen(0,realLoopback,resolve));
  const network={address:realLoopback,internal:false,netmask:[255,0,0,0].join('.')};
  const usb={...network,address:'127.0.0.3'};
  let adapters=[network];
  const relay=createTiinyRelayProxy({
    targets:[{host:'127.0.0.2',localAddress:usb.address},{host:'127.0.0.2'}],
    interfaces:()=>({test:adapters}),devicePort:device.address().port,log:()=>{},
    // macOS need not provision extra loopback aliases. Use a real HTTP
    // fixture on the assigned address while observing the logical adapters.
    deviceGet(options,handle){
      probedAdapters.push(options.localAddress);
      return http.get({...options,host:realLoopback,localAddress:realLoopback},handle);
    },
    deviceConnect(options){
      connectedAdapters.push(options.localAddress);
      return createConnection({...options,host:realLoopback,localAddress:realLoopback});
    },
  });
  await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
  const send=()=>new Promise((resolve,reject)=>{
    const request=http.request({host:'127.0.0.1',port:relay.address().port,path:'/v1/chat/completions',method:'POST',
      headers:{Authorization:'Bearer fabricated-key',Host:'openai.api.tiiny',Connection:'close'}},response=>{
      let body='';
      response.on('data',chunk=>{body+=chunk;});
      response.on('end',()=>resolve(JSON.parse(body)));
      response.on('error',reject);
    });
    request.on('error',reject);
    request.end('{"prompt":"synthetic"}');
  });
  try{
    assert.deepEqual(await send(),{ok:true});
    assert.deepEqual([probedAdapters.at(-1),connectedAdapters.at(-1)],[network.address,network.address]);
    adapters=[usb,network];
    assert.deepEqual(await send(),{ok:true});
    assert.deepEqual([probedAdapters.at(-1),connectedAdapters.at(-1)],[usb.address,usb.address]);
    adapters=[];
    await assert.rejects(send());
    adapters=[network];tiiny=false;
    await assert.rejects(send());
    assert.equal(forwarded.length,2);
    assert.equal(connectedAdapters.length,2);
    tiiny=true;
    assert.deepEqual(await send(),{ok:true});
    assert.equal(forwarded.length,3);
    assert.ok(forwarded.every(request=>request.body==='{"prompt":"synthetic"}'&&request.authorization==='Bearer fabricated-key'));
  }finally{
    await new Promise(resolve=>relay.close(resolve));
    await new Promise(resolve=>device.close(resolve));
  }
});
