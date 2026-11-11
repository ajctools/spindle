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
