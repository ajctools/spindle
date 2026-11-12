export const CHAT_PREFERENCES_KEY='spindle-chat-preferences-v1';
export const AMPLE_RESPONSE_TOKENS=65_536;
export const DEFAULT_CHAT_OPTIONS=Object.freeze({responseLimit:'ample',customTokens:32768,thinking:'auto',effort:'auto',stream:true,search:true,provider:'duckduckgo',query:''});
const limits=['ample','default','4096','8192','16384','32768','custom'];
export function ampleResponseTokens(model={}){
  const context=Number(model.context);
  // Leave half of a smaller reported context for input; this is not tokenization.
  return Number.isSafeInteger(context)&&context>1?Math.min(AMPLE_RESPONSE_TOKENS,Math.floor(context/2)):32_768;
}
export function loadChatOptions(storage){
  const options={...DEFAULT_CHAT_OPTIONS};
  try{
    const saved=JSON.parse(storage.getItem(CHAT_PREFERENCES_KEY));
    if(!saved||typeof saved!=='object'||Array.isArray(saved))return options;
    if(limits.includes(saved.responseLimit))options.responseLimit=saved.responseLimit;
    if(Number.isSafeInteger(saved.customTokens)&&saved.customTokens>0)options.customTokens=saved.customTokens;
    if(typeof saved.search==='boolean')options.search=saved.search;
    if(typeof saved.stream==='boolean')options.stream=saved.stream;
    if(['duckduckgo','brave'].includes(saved.provider))options.provider=saved.provider;
  }catch{/* Storage can be blocked; defaults still work for this page. */}
  return options;
}
export function saveChatOptions(storage,options){
  const safe={responseLimit:options.responseLimit,customTokens:Number(options.customTokens),search:options.search,stream:options.stream,provider:options.provider};
  try{storage.setItem(CHAT_PREFERENCES_KEY,JSON.stringify(safe));return true;}catch{return false;}
}
export function withResponseLimit(params,selection='ample',custom='',model={}){
  if(selection==='default')return {...params,_spindleResponseMode:'model'};
  if(!limits.includes(selection))throw new Error('Choose a valid maximum response length.');
  const value=selection==='ample'?ampleResponseTokens(model):Number(selection==='custom'?custom:selection);
  if(!Number.isSafeInteger(value)||value<1)throw new Error('Enter a positive whole number for maximum response tokens.');
  const {max_tokens,max_completion_tokens,...rest}=params;
  return {...rest,_spindleResponseMode:selection==='ample'?'ample':'explicit',max_tokens:value};
}
