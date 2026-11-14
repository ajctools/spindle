import http from 'node:http';
import https from 'node:https';
import {Readable} from 'node:stream';

// Music can stay silent until generation finishes. Use the caller's deadline
// across headers and body, without fetch's shorter default headers timeout.
export function requestMusicAudio(url,{method,headers,body,signal}){
  const target=new URL(url),transport=target.protocol==='https:'?https:http;
  return new Promise((resolve,reject)=>{
    const req=transport.request(target,{method,headers:{...headers,'Content-Length':Buffer.byteLength(body)},signal},incoming=>{
      const status=incoming.statusCode;
      if([301,302,303,307,308].includes(status)){
        incoming.destroy();reject(new Error('The Tiiny music endpoint redirected the request.'));return;
      }
      const responseHeaders=new Headers();
      for(const [key,value] of Object.entries(incoming.headers)){
        if(value!==undefined)responseHeaders.set(key,Array.isArray(value)?value.join(', '):value);
      }
      const hasBody=![204,205,304].includes(status);
      if(!hasBody)incoming.resume();
      resolve(new Response(hasBody?Readable.toWeb(incoming):null,{status,headers:responseHeaders}));
    });
    req.once('error',reject);
    req.end(body);
  });
}

// Tiiny music families expose different request envelopes. No cloud service.
export function musicRequest(model,prompt,params={},info={},forceTopLevel=false){
  const family=[model.id,info.family,info.api_schema,info.model_info?.model?.family,info.model_info?.model?.model_type].filter(Boolean).join(' '),{lyrics,lyric_text,caption,generation_type,...rest}=params,text=String(lyric_text ?? lyrics ?? '').trim();
  if(forceTopLevel||/foundation/i.test(family)){
    if(text&&text!=='[instrumental]')throw new Error('This music runtime accepts an instrumental description. Choose a lyric-capable model for lyrics.');
    return {model:model.id,prompt:caption || prompt,config:rest};
  }
  const supported=info.model_info?.model?.supported_generation_types || [],proposed=generation_type || (text?'mixed':'bgm');let type=proposed;
  if(supported.length&&!supported.includes(type))type=info.default_config?.generation_type || supported[0];
  else if(!supported.length&&!generation_type&&/ace.?step/i.test(family))type='mixed';
  return {model:model.id,config:{caption:caption || prompt,generation_type:type,...rest,...(type==='mixed'?{lyric_text:text || '[instrumental]'}:text?{lyric_text:text}:{})}};
}
export function musicNeedsTopLevel(error){const message=String(error?.message || error);return /^Tiiny 422:/.test(message)&&/\[\s*"body"\s*,\s*"prompt"\s*\]/.test(message)&&/\[\s*"body"\s*,\s*"config"\s*,\s*"caption"\s*\]/.test(message);}

export function musicSchemaFallback(body,error,info={}){
  const message=String(error?.message||error);
  if(typeof body?.config?.lyric_text!=='string'||!/^Tiiny (?:400|422):\s+Extra inputs are not permitted in config:\s*lyric_text\s*$/i.test(message))return null;
  const defaults=info.default_config||{};
  if(!Object.hasOwn(defaults,'lyrics')||Object.hasOwn(defaults,'lyric_text'))return null;
  const {lyric_text,...config}=body.config;
  return {...body,config:{...config,lyrics:lyric_text}};
}
