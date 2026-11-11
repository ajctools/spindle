const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function cleanHardware(value={}){
  // Deliberately omit serials, interface addresses, hostnames and arbitrary future fields.
  return {devices:(value.devices || []).map(d=>Object.fromEntries(['util_percent','mem_used_mb','mem_total_mb','temp_c','power_w'].map(k=>[k,numeric(d[k])]))),
    cpu:{total_percent:numeric(value.cpu?.total_percent)},memory:{usage_percent:numeric(value.memory?.usage_percent)}};
}
export function csvCell(value){
  let text=String(Array.isArray(value)?value.join('; '):value??'');
  // Quoting alone does not stop spreadsheet applications from evaluating formulas.
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function requestAccess(req,{port,secret,pathname}){
  const allowed=['http://127.0.0.1:'+port,'http://localhost:'+port];
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return {status:403,error:'Loopback access only.'};
  const privateRoute=pathname.startsWith('/api/')||pathname.startsWith('/assets/')||['/catalog.csv','/catalog.json','/metrics.csv','/metrics.json'].includes(pathname);
  const write=!['GET','HEAD'].includes(req.method),origin=req.headers.origin,site=req.headers['sec-fetch-site'];
  if((privateRoute||write)&&((origin&&!allowed.includes(origin))||(site&&!['same-origin','none'].includes(site))))return {status:403,error:'Open Spindle locally to access this workspace.'};
  if((privateRoute&&pathname!=='/api/session'||write)&&!req.headers.cookie?.split(';').some(c=>c.trim()==='spindle='+secret))return {status:403,error:'Open Spindle locally before accessing private data or making changes.'};
  return null;
}
export function redactError(value,secrets=[]){
  let text=String(value?.message || value || 'Request failed.');
  for(const secret of secrets.filter(v=>typeof v==='string'&&v.length>0))for(const variant of new Set([secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64')]))text=text.replaceAll(variant,'[redacted]');
  return text.replace(/\b[A-Za-z]:[\\/](?:[^\s"'<>]|\\ )+/g,'[local path]').replace(/\/(?:Users|home)\/[^\s"'<>]+/g,'[local path]');
}

export function createChatTrace(){
  const duration=5*60_000,limit=100;
  let capture=null,timer=null;
  function stop(){
    if(capture?.active)capture.active=false;
    clearTimeout(timer);
    timer=null;
  }
  function start(){
    if(capture?.active)return;
    const startedAt=Date.now();
    capture={active:true,startedAt,endsAt:startedAt+duration,events:[],dropped:0};
    timer=setTimeout(stop,duration).unref();
  }
  function clear(){stop();capture=null;}
  function snapshot(redacted=false){
    if(!capture)return {active:false,events:[],dropped:0};
    if(!redacted)return capture;
    const runNumbers=new Map();
    const events=capture.events.map(({runId,origin,...event})=>{
      if(runId&&!runNumbers.has(runId))runNumbers.set(runId,runNumbers.size+1);
      return {...event,run:runNumbers.get(runId)??null,origin:['chat','check'].includes(event.kind)||event.unexpected?null:origin};
    });
    return {...capture,events};
  }
  async function request(url,options,{runId,kind,sent,expectedOrigin}){
    if(!capture?.active)return fetch(url,options);
    const recording=capture,destination=url instanceof URL?url:new URL(url);
    const event={at:Date.now(),runId,kind,sent,origin:destination.origin,protocol:destination.protocol,
      unexpected:destination.origin!==expectedOrigin,outcome:'pending'};
    const check=kind==='check';
    const record=()=>{
      if(recording.events.length===limit){recording.events.shift();recording.dropped++;}
      recording.events.push(event);
    };
    if(!check)record();
    const started=performance.now();
    let response;
    try{response=await fetch(url,options);}
    catch(error){
      if(recording.active){
        event.outcome=options.signal?.reason?.name==='TimeoutError'?'timeout':options.signal?.aborted?'aborted':'failed';
        if(check)record();
      }
      throw error;
    }
    if(recording.active){
      const type=response.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase();
      Object.assign(event,{outcome:'headers',status:response.status,headersMs:Math.round(performance.now()-started),
        setCookie:response.headers.has('set-cookie'),
        responseType:type==='text/event-stream'?'SSE':type==='application/json'?'JSON':type==='text/html'?'HTML':'Other'});
      if(check&&(!response.ok||event.responseType==='HTML'||event.setCookie||event.unexpected))record();
    }
    return response;
  }
  return {get active(){return capture?.active===true;},start,stop,clear,snapshot,request};
}
