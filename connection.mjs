export function normalizeConnection(value) {
  const parse=(text,label)=>{
    let u;try{u=new URL(String(text).includes('://')?text:'http://'+text);}catch{throw new Error(label+' must be a valid HTTP or HTTPS URL.');}
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error(label+' must not contain credentials, query parameters, or fragments.');
    return u;
  };
  if(!value.endpoint?.trim())throw new Error('Enter your Tiiny device URL or OpenAI-compatible base URL.');
  if(!value.key?.trim())throw new Error('Enter your Tiiny API key.');
  const endpoint=parse(value.endpoint.trim(),'Endpoint');
  const origin=endpoint.origin,base=endpoint.pathname.replace(/\/$/,'');
  const native=value.nativeEndpoint?parse(value.nativeEndpoint,'Native endpoint').href.replace(/\/$/,''):origin+'/v1';
  const management=value.managementEndpoint?parse(value.managementEndpoint,'Management endpoint').href.replace(/\/$/,''):origin;
  // One key is shared across Tiiny's surfaces. An advanced URL cannot send it to a different origin.
  if(new URL(native).origin!==origin||new URL(management).origin!==origin)throw new Error('Native and management endpoints must use the same origin as the Tiiny endpoint.');
  return {endpoint:endpoint.href.replace(/\/$/,''),url:origin,openaiBase:origin+(base||'/v1'),nativeBase:native,managementBase:management,
    key:value.key.trim(),hostRouting:value.hostRouting!==false};
}
export function deviceURL(connection,route,transport='native') {
  if(route.startsWith('/api/')||route.startsWith('/kb/'))return connection.managementBase+route;
  return (transport==='openai'?connection.openaiBase:connection.nativeBase)+route.replace(/^\/v1/,'');
}

export function createTiinyRelay({endpoint,origin}, {request=fetch,now=Date.now}={}){
  if(!endpoint&&!origin)return null;
  const primary=new URL(endpoint),relay=new URL(origin);
  if(primary.protocol!=='http:'||primary.username||primary.password||primary.search||primary.hash||
     relay.protocol!=='http:'||relay.hostname!=='127.0.0.1'||!relay.port||relay.href!==relay.origin+'/'||primary.origin===relay.origin){
    throw Error('The Tiiny USB relay requires an HTTP LAN endpoint and a distinct HTTP loopback origin with an explicit port.');
  }
  const primaryEndpoint=primary.href.replace(/\/$/,'');
  const viaRelay=url=>{const target=new URL(url);target.host=relay.host;return target.href;};
  let selected=false,checkedUntil=0,pending;
  async function isTiiny(url,hostRouting){
    try{
      const response=await request(url,{headers:hostRouting?{Host:'openai.api.tiiny'}:{},redirect:'error',signal:AbortSignal.timeout(1200)});
      if(response.status!==401){
        void response.body?.cancel().catch(()=>{});
        return false;
      }
      const body=await response.json();
      return body.error==='unauthorized'&&body.reason==='missing_token';
    }catch{return false;}
  }
  async function choose(connection){
    const models=deviceURL(connection,'/v1/models','openai');
    const local=await isTiiny(models,connection.hostRouting);
    selected=!local&&await isTiiny(viaRelay(models),connection.hostRouting);
    checkedUntil=now()+(local?5000:selected?15000:1000);
  }
  return {
    async target(connection,url){
      if(connection.endpoint!==primaryEndpoint)return url;
      if(now()>=checkedUntil){
        pending??=choose(connection).finally(()=>{pending=null;});
        await pending;
      }
      return selected?viaRelay(url):url;
    },
    invalidate(){checkedUntil=0;},
  };
}
export function publicConnection(connection,source,remembered=false){
  return {endpoint:connection?.endpoint || '',nativeEndpoint:connection?.nativeBase || '',managementEndpoint:connection?.managementBase || '',
    hostRouting:connection?.hostRouting!==false,keyPresent:!!connection?.key,source,remembered};
}
