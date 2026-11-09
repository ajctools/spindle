// Tiiny chat responses may separate reasoning or wrap it in <think> tags.
const text=value=>typeof value==='string'?value:Array.isArray(value)?value.map(v=>v.text || '').join(''):'';
export function splitThinking(content='',reasoning=''){
  let answer='',thoughts=text(reasoning),cursor=0,inside=false;
  const pattern=/<\/?think>/gi;let match;
  while((match=pattern.exec(content))){
    if(inside)thoughts+=content.slice(cursor,match.index);else answer+=content.slice(cursor,match.index);
    inside=!match[0].startsWith('</');cursor=pattern.lastIndex;
  }
  if(inside)thoughts+=content.slice(cursor);else answer+=content.slice(cursor);
  // Do not flash a tag split across stream frames into the answer.
  answer=answer.replace(/<\/?t(?:h(?:i(?:n(?:k)?)?)?)?$/i,'');
  return {text:answer.trim(),reasoning:thoughts.trim()};
}
export function chatMessage(message={}){
  return splitThinking(text(message.content),text(message.reasoning_content)||text(message.reasoning)||text(message.thinking));
}
export function chatSettings(params={},model={}){
  const {_spindleThinking,_spindleEffort,_spindleStream,_spindleWebSearch,...wire}=params;
  if(_spindleThinking!==undefined&&_spindleThinking!=='auto'){
    if(!['on','off'].includes(_spindleThinking))throw new Error('Choose a valid thinking mode.');
    if(!model.thinking?.toggleable)throw new Error('This model does not report a thinking toggle. Choose Model default.');
    wire.chat_template_kwargs={...wire.chat_template_kwargs,enable_thinking:_spindleThinking==='on'};
  }
  if(_spindleEffort&&_spindleEffort!=='auto'){
    if(!(model.reasoningLevels || []).includes(_spindleEffort))throw new Error('Choose a reasoning effort reported by this model.');
    wire.reasoning_effort=_spindleEffort;
  }
  return {...wire,stream:_spindleStream!==false,...(_spindleStream!==false?{stream_options:{...wire.stream_options,include_usage:true}}:{})};
}
export async function readChatResponse(response,{onUpdate=()=>{},signal}={}){
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
    const json=await response.json();
    if(json.error||json.success===false)throw new Error('Chat response failed: '+(json.error?.message || 'runtime error'));
    const message=json.choices?.[0]?.message;
    if(!message)throw new Error('Tiiny returned no chat message.');
    const result={...chatMessage(message),finishReason:json.choices[0].finish_reason || null,json,streamed:false};
    if(!result.text&&!result.reasoning)throw new Error('Tiiny returned an empty chat response.');
    onUpdate(result);return result;
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='',content='',reasoning='',json={choices:[]},finishReason=null,done=false;
  const update=()=>({...splitThinking(content,reasoning),finishReason});
  const frame=event=>{
    const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data)return;
    if(data.trim()==='[DONE]'){done=true;return;}
    let value;try{value=JSON.parse(data);}catch{throw new Error('Tiiny returned an invalid chat stream frame.');}
    if(value.error)throw new Error('Chat stream failed: '+(value.error.message || 'runtime error'));
    json={...json,...value};const choice=value.choices?.[0],delta=choice?.delta || choice?.message || {};
    content+=text(delta.content);reasoning+=text(delta.reasoning_content)||text(delta.reasoning)||text(delta.thinking);
    if(choice?.finish_reason)finishReason=choice.finish_reason;
    if(content.length+reasoning.length>2_000_000)throw new Error('Chat response exceeded the local size limit.');
    onUpdate(update());
  };
  try{
    while(!done){
      signal?.throwIfAborted();const chunk=await reader.read();
      buffer=(buffer+(chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true}))).replaceAll('\r\n','\n');
      if(buffer.length>2_000_000)throw new Error('Chat stream frame exceeded the local size limit.');
      let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);frame(event);if(done)break;}
      if(chunk.done){if(buffer.trim())frame(buffer);break;}
    }
    if(!done&&!finishReason)throw new Error('The chat stream ended before completion. Partial output is shown; retry explicitly.');
    const result=update();
    if(!result.text&&!result.reasoning)throw new Error('Tiiny returned an empty chat response.');
    json.choices=[{message:{role:'assistant',content:result.text,reasoning_content:result.reasoning},finish_reason:finishReason}];
    return {...result,json,streamed:true};
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
