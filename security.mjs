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
