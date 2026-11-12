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
export function publicConnection(connection,source,remembered=false){
  return {endpoint:connection?.endpoint || '',nativeEndpoint:connection?.nativeBase || '',managementEndpoint:connection?.managementBase || '',
    hostRouting:connection?.hostRouting!==false,keyPresent:!!connection?.key,source,remembered};
}
