import {spawn} from 'node:child_process';
import {createConnection,createServer,isIPv4} from 'node:net';
import http from 'node:http';
import {networkInterfaces} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';

const ipv4Number=address=>address.split('.').reduce((value,part)=>(value<<8)|Number(part),0);

function sameSubnet(left,right,mask){
  return (ipv4Number(left)&ipv4Number(mask))===(ipv4Number(right)&ipv4Number(mask));
}

function probeTiiny({host,localAddress},port,deviceGet){
  return new Promise(resolve=>{
    const request=deviceGet({host,port,localAddress,path:'/v1/models',headers:{Host:'openai.api.tiiny',Connection:'close'}},response=>{
      let body='';
      response.on('data',chunk=>{
        body+=chunk;
        if(body.length>4096)request.destroy();
      });
      response.on('end',()=>{
        try{
          const value=JSON.parse(body);
          resolve(response.statusCode===401&&value.error==='unauthorized'&&value.reason==='missing_token');
        }catch{resolve(false);}
      });
      response.on('error',()=>resolve(false));
    });
    const deadline=setTimeout(()=>request.destroy(),800);
    request.once('close',()=>{clearTimeout(deadline);resolve(false);});
    request.on('error',()=>resolve(false));
  });
}

export function createTiinyRelayProxy({targets,interfaces=networkInterfaces,devicePort=80,deviceGet=http.get,deviceConnect=createConnection,log=console.log}){
  let lastRoute='';
  return createServer(async client=>{
    client.on('error',()=>{});
    client.pause();
    const adapters=Object.values(interfaces()).flat().filter(adapter=>!adapter.internal&&isIPv4(adapter.address));
    let destination;
    for(const target of targets){
      const adapter=adapters.find(candidate=>candidate.address!==target.host&&
        (!target.localAddress||candidate.address===target.localAddress)&&sameSubnet(candidate.address,target.host,candidate.netmask));
      if(!adapter)continue;
      const candidate={host:target.host,localAddress:adapter.address};
      if(await probeTiiny(candidate,devicePort,deviceGet)){destination=candidate;break;}
      if(client.destroyed)return;
    }
    if(!destination){
      if(lastRoute!=='offline'){log('Waiting for Tiiny on a configured USB or local network address.');lastRoute='offline';}
      client.destroy();return;
    }
    if(client.destroyed)return;
    const route=destination.host+' via '+destination.localAddress;
    if(lastRoute!==route){log('Tiiny route available through the traveling computer.');lastRoute=route;}
    const device=deviceConnect({...destination,port:devicePort});
    const deadline=setTimeout(()=>device.destroy(),1500);
    device.once('connect',()=>clearTimeout(deadline));
    device.once('close',()=>{clearTimeout(deadline);client.destroy();});
    device.on('error',()=>client.destroy());
    client.on('error',()=>device.destroy());
    client.once('close',()=>device.destroy());
    client.pipe(device).pipe(client);
    client.resume();
  });
}

async function main(){
  const [sshHost,usbAddress,tiinyAddress,portText='18438',...networkAddresses]=process.argv.slice(2);
  const port=Number(portText);
  if(!/^[\w][\w.@-]*$/.test(sshHost || '')||!isIPv4(usbAddress)||!isIPv4(tiinyAddress)||
     usbAddress===tiinyAddress||networkAddresses.some(address=>!isIPv4(address))||
     !Number.isInteger(port)||port<1024||port>65535){
    throw Error('Usage: node scripts/tiiny-usb-relay.mjs <SSH alias> <computer USB IPv4> <Tiiny USB IPv4> [port] [Tiiny local network IPv4 ...]');
  }

  const log=message=>console.log(new Date().toISOString()+' '+message);
  const targets=[{host:tiinyAddress,localAddress:usbAddress},...networkAddresses.map(host=>({host}))];
  const server=createTiinyRelayProxy({targets,log});
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
  log('Tiiny relay listening on loopback.');

  const forward='127.0.0.1:'+port+':127.0.0.1:'+port;
  let ssh,lastError='';
  function stop(){ssh?.kill();server.close();process.exit(0);}
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
  for(;;){
    ssh=spawn('ssh',['-NT','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
      '-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=5','-o','ServerAliveInterval=10',
      '-o','ServerAliveCountMax=2','-o','TCPKeepAlive=yes','-R',forward,sshHost],{stdio:['ignore','ignore','pipe'],windowsHide:true});
    let errorText='';
    ssh.stderr.on('data',chunk=>{errorText=(errorText+chunk).slice(-2048);});
    ssh.on('error',error=>{errorText=error.message;});
    const code=await new Promise(resolve=>ssh.once('close',resolve));
    const failure='SSH disconnected ('+code+'). '+errorText.trim();
    if(failure!==lastError){log(failure);lastError=failure;}
    await pause(4000);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
