import {randomUUID} from 'node:crypto';

function baseURL(value){
  let url;
  try{url=new URL(value);}catch{}
  if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
    throw Error('Enter an HTTP or HTTPS API base URL without credentials, a query, or a fragment.');
  return url.origin+(url.pathname.replace(/\/+$/,'')||'/v1');
}

export async function endpointRequest(profile,route,{body,signal}={}){
  const name=profile.kind==='cloud'?'cloud endpoint':'custom endpoint';
  let response;
  try{
    response=await fetch(profile.url+route,{method:body?'POST':'GET',redirect:'error',signal,
      headers:{...(profile.key?{Authorization:'Bearer '+profile.key}:{}),...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined});
  }catch{
    signal?.throwIfAborted();
    throw Error('Could not reach the '+name+'. Check its URL and make sure it does not redirect.');
  }
  if(!response.ok||response.headers.get('content-type')?.includes('text/html')){
    await response.body?.cancel().catch(()=>{});
    throw Error('The '+name+' did not accept the request (HTTP '+response.status+'). Check the API base URL, credentials, and model.');
  }
  return response;
}

export async function createCustomEndpoints({readJSON,writeJSON}){
  const file='custom-endpoints.json';
  let profiles=await readJSON(file,[]),pending=Promise.resolve();
  const sessionKeys=new Map();
  const publish=p=>({id:p.id,name:p.name,url:p.url,models:p.models,...(p.kind==='cloud'?{kind:'cloud'}:{}),remember:!!p.key,
    keyPresent:!!(p.key||sessionKeys.get(p.id)),needsKey:p.keyRequired&&!p.key&&!sessionKeys.has(p.id)});
  const list=()=>profiles.map(publish);
  const serialize=fn=>{
    const result=pending.catch(()=>{}).then(fn);
    pending=result;
    return result;
  };
  return {
    list,
    secrets:()=>profiles.map(p=>p.key||sessionKeys.get(p.id)).filter(Boolean),
    forRun(id,model){
      const p=profiles.find(row=>row.id===id);
      if(!p?.models.includes(model))throw Error('Choose a model from a configured custom endpoint.');
      if(publish(p).needsKey)throw Error('Enter the API key again in Settings → '+(p.kind==='cloud'?'Cloud endpoints.':'Custom endpoints.'));
      return {...p,key:p.key||sessionKeys.get(id)||''};
    },
    save(b){return serialize(async()=>{
      const old=profiles.find(p=>p.id===b.id);
      if(b.id&&!old)throw Error('This custom endpoint was removed.');
      if(!old&&profiles.length>=20)throw Error('Remove an endpoint before adding another (limit: 20).');
      const name=typeof b.name==='string'?b.name.trim():'';
      if(!name||name.length>80)throw Error('Enter an endpoint name (up to 80 characters).');
      const url=baseURL(b.url);
      if(old&&old.url!==url)throw Error('Add a separate endpoint to use a different URL.');
      if(b.kind!==undefined&&!['custom','cloud'].includes(b.kind))throw Error('Choose a supported endpoint type.');
      const kind=old?(old.kind??'custom'):(b.kind??'custom');
      if(old&&b.kind!==undefined&&b.kind!==kind)throw Error('Add a separate profile to change the endpoint type.');
      if(kind==='cloud'&&!url.startsWith('https:'))throw Error('Cloud endpoints require an HTTPS API base URL.');
      const entered=typeof b.key==='string'?b.key.trim():'';
      const key=entered||(b.clearKey===true?'':old?.key||sessionKeys.get(old?.id)||'');
      if(key.length>4096||/[^\x21-\x7e]/.test(key))throw Error('Enter a valid bearer API key.');
      if(old?.keyRequired&&!key&&b.clearKey!==true)throw Error('Enter the API key again or choose to connect without it.');
      const response=await endpointRequest({url,key,kind},'/models',{signal:AbortSignal.timeout(15_000)});
      let data;
      try{({data}=await response.json());}catch{throw Error('The custom endpoint did not return a valid OpenAI-compatible model list.');}
      const models=[...new Set((Array.isArray(data)?data:[]).map(row=>row?.id)
        .filter(id=>typeof id==='string'&&id.trim()&&id.length<=256&&(!key||!id.includes(key))))].slice(0,500);
      if(!models.length)throw Error('The custom endpoint did not list any models.');
      const profile={id:old?.id||randomUUID(),name,url,models,...(kind==='cloud'?{kind}:{}),keyRequired:!!key,...(b.remember===true&&key?{key}:{})};
      const next=old?profiles.map(row=>row.id===old.id?profile:row):[...profiles,profile];
      await writeJSON(file,next);
      if(key&&!profile.key)sessionKeys.set(profile.id,key);else sessionKeys.delete(profile.id);
      profiles=next;
      return publish(profile);
    });},
    remove(id){return serialize(async()=>{
      const next=profiles.filter(p=>p.id!==id);
      await writeJSON(file,next);
      profiles=next;sessionKeys.delete(id);
      return list();
    });},
  };
}
