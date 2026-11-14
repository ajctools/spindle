import test from 'node:test';
import assert from 'node:assert/strict';
import {chatMessage,chatSampleSettings,chatSettings,readChatResponse,requestChatResponse} from '../chat.mjs';
import {chatDetails,chatMarkdown,chatMarkdownBlocks,chatRunStats,restoreChat,withResponseLimit} from '../public/chat-ui.mjs';
import {loadChatOptions,saveChatOptions,ampleResponseTokens} from '../public/chat-settings.mjs';
import {createMetric} from '../metrics.mjs';

test('chat recovery uses linked saved turns and leaves a running reply to the live renderer',()=>{
  const step={task:'chat',model:'test/chat',promptMode:'literal'};
  const attachments=[{name:'example.txt',text:'A reference.'}];
  const first={id:'first',status:'completed',keepChatModel:true,steps:[{...step,prompt:'First prompt',attachments}],outputs:[{task:'chat',text:'First reply',webSearchWarning:'No sources'}]};
  const second={id:'second',status:'running',keepChatModel:true,previousChatRunId:'first',steps:[{...step,prompt:'Follow-up'}],outputs:[],partial:{text:'Still generating'}};
  const unrelated={...first,id:'unrelated'};
  const restored=restoreChat(second,[unrelated,second,first]);
  assert.deepEqual(restored.map(item=>[item.role,item.content]),[['user','First prompt'],['assistant','First reply'],['user','Follow-up']]);
  assert.deepEqual(restored[0].attachments,attachments);
  assert.equal(restored[1].runId,'first');
  assert.equal(restored[1].webSearchWarning,'No sources');
  assert.equal(restoreChat({...second,status:'completed',outputs:[{task:'chat',text:'Second reply'}]},[first]).at(-1).content,'Second reply');
});

test('capability checks leave room for a final answer when reasoning cannot be disabled',()=>{
  assert.deepEqual(chatSampleSettings({thinking:{toggleable:true}}),{max_tokens:8192,chat_template_kwargs:{enable_thinking:false}});
  assert.deepEqual(chatSampleSettings({thinking:{supported:false}}),{max_tokens:8192});
  assert.deepEqual(chatSampleSettings({thinking:{supported:true},context:8192}),{max_tokens:4096});
  assert.deepEqual(chatSampleSettings({context:32768}),{max_tokens:8192});
});

test('chat separates model reasoning and tagged thoughts from the answer',()=>{
  assert.deepEqual(chatMessage({content:'Answer',reasoning_content:'Consider this.'}),{text:'Answer',reasoning:'Consider this.'});
  assert.deepEqual(chatMessage({content:'<think>Consider this.</think>\nAnswer'}),{text:'Answer',reasoning:'Consider this.'});
  assert.deepEqual(chatMessage({content:'<think>Still working'}),{text:'',reasoning:'Still working'});
  assert.deepEqual(chatMessage({content:'<thi'}),{text:'',reasoning:''});
  assert.equal(chatMessage({content:[{type:'text',text:'Block answer'}]}).text,'Block answer');
});
test('thinking controls follow model capabilities and internal options never reach Tiiny',()=>{
  const settings=chatSettings({_spindleThinking:'on',_spindleEffort:'high',_spindleWebSearch:{enabled:true},chat_template_kwargs:{other:true}}, {thinking:{toggleable:true},reasoningLevels:['high']});
  assert.deepEqual(settings.chat_template_kwargs,{other:true,enable_thinking:true});assert.equal(settings.reasoning_effort,'high');assert.equal(settings.stream,true);assert.equal(settings.stream_options.include_usage,true);assert.ok(!JSON.stringify(settings).includes('_spindle'));
  assert.throws(()=>chatSettings({_spindleThinking:'off'},{}),/toggle/);
  assert.throws(()=>chatSettings({_spindleEffort:'high'},{}),/reported/);
  assert.equal(chatSettings({_spindleStream:false}).stream,false);
  assert.equal(chatSettings({_spindleThinking:'auto'}).chat_template_kwargs,undefined);
  const metric=createMetric({job:{id:'test',createdAt:'2026-01-01'},step:{task:'chat',model:'test',params:{_spindleThinking:'on',_spindleWebSearch:{enabled:true,query:'private-query'}}},index:0});
  assert.deepEqual(metric.profile.chat,{thinkingMode:'on',thinkingEnabled:null,reasoningEffort:'auto',stream:null,webSearch:true});assert.ok(!JSON.stringify(metric).includes('private-query'));
});
test('ample response allowance respects small contexts and explicit runtime defaults remain available',()=>{
  const defaults=chatSettings(withResponseLimit({temperature:0.6}));
  assert.equal(defaults.max_tokens,32768);assert.equal(defaults.max_completion_tokens,undefined);
  assert.equal(withResponseLimit({max_tokens:7200},'default').max_tokens,7200);
  assert.equal(chatSettings(withResponseLimit({},'default')).max_tokens,undefined);
  assert.equal(ampleResponseTokens({context:16384}),8192);
  assert.equal(ampleResponseTokens({context:65536}),32768);
  assert.equal(ampleResponseTokens({context:131072}),65536);
  assert.equal(ampleResponseTokens({context:262144}),65536);
  assert.equal(ampleResponseTokens({context:'unknown'}),32768);
  assert.equal(chatSettings({}, {context:8192}).max_tokens,4096);
  assert.equal(chatSettings({}, {context:262144}).max_tokens,65536);
  const ample=withResponseLimit({},'ample','',{context:262144});
  assert.equal(chatSettings(ample,{context:65536}).max_tokens,32768);
  assert.deepEqual(withResponseLimit({temperature:0.6,max_completion_tokens:4000},'16384'),{temperature:0.6,_spindleResponseMode:'explicit',max_tokens:16384});
  assert.equal(withResponseLimit({},'custom','24000').max_tokens,24000);
  assert.equal(chatSettings({max_tokens:null}).max_tokens,32768);
  assert.equal(chatSettings({max_completion_tokens:8192}).max_completion_tokens,8192);
  for(const invalid of [0,-1,2.5,'8192',Infinity])assert.throws(()=>chatSettings({max_tokens:invalid}),/positive whole number/);
  for(const invalid of ['',0,-1,2.5,'bad'])assert.throws(()=>withResponseLimit({},'custom',invalid),/positive whole number/);
  assert.throws(()=>withResponseLimit({},'unknown'),/valid/);
  assert.throws(()=>chatSettings({max_tokens:4000,max_completion_tokens:4000}),/only one/);
});
test('chat preferences retain web search and response settings without storing secrets or queries',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value)};
  const fresh=loadChatOptions(storage);assert.equal(fresh.search,true);assert.equal(fresh.responseLimit,'ample');
  assert.equal(saveChatOptions(storage,{...fresh,search:false,provider:'brave',responseLimit:'custom',customTokens:'48000',query:'private-query',key:'private-key'}),true);
  const saved=loadChatOptions(storage);assert.equal(saved.search,false);assert.equal(saved.provider,'brave');assert.equal(saved.customTokens,48000);assert.equal(saved.query,'');
  assert.ok(![...values.values()].join('').includes('private-query'));assert.ok(![...values.values()].join('').includes('private-key'));
  saveChatOptions(storage,{...saved,search:true});assert.equal(loadChatOptions(storage).search,true);
  storage.getItem=()=>'{invalid';assert.equal(loadChatOptions(storage).search,true);
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};assert.equal(loadChatOptions(blocked).responseLimit,'ample');assert.equal(saveChatOptions(blocked,fresh),false);
});
test('stream decoder handles split UTF-8, CRLF boundaries, reasoning, usage and completion',async()=>{
  const events=[{choices:[{delta:{reasoning_content:'A thought 🌟'}}],usage:{prompt_tokens:5,prompt_tokens_details:{cached_tokens:0}}}, {choices:[{delta:{content:'An answer.'}}],usage:null}, {choices:[{delta:{},finish_reason:'length'}]}, {choices:[],usage:{completion_tokens:9,total_tokens:14},timings:{predicted_per_second:12}}];
  const data=Buffer.from(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n');let cursor=0;const updates=[];
  const response=new Response(new ReadableStream({pull(controller){if(cursor>=data.length){controller.close();return;}controller.enqueue(data.subarray(cursor,cursor+1));cursor++;}}),{headers:{'content-type':'text/event-stream'}});
  const result=await readChatResponse(response,{onUpdate:(out,json)=>updates.push({out,usage:json.usage})});
  assert.equal(result.streamed,true);assert.equal(result.reasoning,'A thought 🌟');assert.equal(result.text,'An answer.');assert.equal(result.finishReason,'length');assert.equal(result.json.usage.total_tokens,14);assert.equal(result.json.timings.predicted_per_second,12);
  assert.ok(updates.some(({out,usage})=>out.reasoning&&!out.text&&usage.prompt_tokens===5));
  assert.equal(result.json.usage.prompt_tokens_details.cached_tokens,0);
});
test('chat context shows live text estimates and replaces them with reported usage',()=>{
  const live=chatRunStats({chatProgress:{context:65536,estimatedInput:19000,estimatedOutput:100,estimatedOutputTps:2}},{context:32768});
  assert.equal(live.context,65536);
  assert.equal(live.used,19100);
  assert.equal(live.ratio,19100/65536);
  assert.equal(live.estimated,true);
  assert.equal(live.rate,'≈2 t/s (estimate)');
  assert.equal(live.cache,'—');
  const final=chatRunStats({outputs:[{task:'chat',context:65536,metrics:{inputTokens:19000,outputTokens:124,cachedTokens:0,decodeTps:2}}]});
  assert.equal(final.used,19124);
  assert.equal(final.estimated,false);
  assert.equal(final.cache,'0 (0%)');
  assert.equal(final.rate,'2 t/s (Tiiny decode)');
  assert.equal(chatRunStats({chatProgress:{cachedTokens:80,inputTokens:100}}).cache,'80 (80%)');
  assert.equal(chatRunStats({chatProgress:{decodeTps:24}}).rate,'24 t/s (Tiiny decode)');
  assert.equal(chatRunStats({chatProgress:{estimatedInput:20}}).rate,'—');
  const timing={durationMs:1000,estimatedOutput:150};
  assert.equal(chatRunStats({outputs:[{task:'chat',chatTiming:timing,metrics:{outputTokens:100}}]}).rate,'100 t/s (response avg)');
  assert.equal(chatRunStats({outputs:[{task:'chat',chatTiming:timing}]}).rate,'≈150 t/s (estimate)');
  assert.equal(chatRunStats({chatProgress:{context:65536,estimatedOutput:30}}).ratio,null);
});
test('chat handles JSON responses and fails visibly on interrupted or invalid streams',async()=>{
  const result=await readChatResponse(Response.json({choices:[{message:{content:'Final',reasoning:'Reasoning'},finish_reason:'stop'}]}));assert.equal(result.streamed,false);assert.equal(result.text,'Final');assert.equal(result.reasoning,'Reasoning');
  const stream=value=>new Response(value,{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(readChatResponse(stream('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n')),/ended before/);
  await assert.rejects(readChatResponse(stream('data: broken\n\n')),/invalid/);
  await assert.rejects(readChatResponse(stream('data: {"error":{"message":"bad model"}}\n\n')),/bad model/);
  await assert.rejects(readChatResponse(Response.json({choices:[]})),/no chat message/);
  await assert.rejects(readChatResponse(stream('data: [DONE]\n\n')),/empty/);
});
test('chat stays connected while data arrives and retains partial output on a stall',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const encoder=new TextEncoder();
  let stream,requestSignal,update;
  const request=signal=>{
    requestSignal=signal;
    const body=new ReadableStream({start(controller){
      stream=controller;
      signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});
    }});
    return new Response(body,{headers:{'content-type':'text/event-stream'}});
  };
  const start=()=>requestChatResponse(request,{startupTimeout:100,idleTimeout:100,onUpdate:partial=>update.resolve(partial)});
  const send=async delta=>{
    update=Promise.withResolvers();
    stream.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta}]})+'\n\n'));
    return update.promise;
  };

  const finished=start();
  await send({reasoning_content:'Thinking.'});
  t.mock.timers.tick(75);
  await send({content:'An answer'});
  t.mock.timers.tick(75);
  assert.equal(requestSignal.aborted,false);
  await send({content:' that took longer than the startup timeout.'});
  stream.enqueue(encoder.encode('data: [DONE]\n\n'));
  const {result}=await finished;
  assert.equal(result.text,'An answer that took longer than the startup timeout.');
  assert.equal(result.reasoning,'Thinking.');
  t.mock.timers.tick(100);
  assert.equal(requestSignal.aborted,false);

  const stalled=start();
  const rejection=assert.rejects(stalled,{name:'TimeoutError',message:/stream stopped sending data/});
  const partial=await send({content:'A partial answer'});
  t.mock.timers.tick(100);
  await rejection;
  assert.equal(partial.text,'A partial answer');
});
test('reasoning and source cards render inert text and safe links',()=>{
  const html=chatDetails({reasoning:'<script>alert(1)</script>',webSearch:{provider:'brave',query:'<img>',searchedAt:'2026-01-01',sources:[{url:'javascript:alert(1)',title:'unsafe'},{url:'https://example.com',title:'<img onerror=bad>',snippet:'<script>bad</script>'}]},finishReason:'length'});
  assert.ok(html.includes('data-reasoning'));assert.ok(!html.includes('<details class="thinking-panel" open'));assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('noopener noreferrer'));assert.ok(html.includes('token or context limit'));
  assert.ok(chatDetails({finishReason:'length',responseLimit:16384}).includes('16,384-token limit'));
  const uncapped=chatDetails({finishReason:'length',responseLimit:null});assert.ok(uncapped.includes('Spindle did not set a token cap'));assert.ok(uncapped.includes('Maximum response tokens'));
  const exhausted=chatDetails({finishReason:'length',responseLimit:4096,reasoning:'Thinking only',text:''});assert.ok(exhausted.includes('before an answer arrived'));assert.ok(exhausted.includes('resend your prompt'));assert.ok(!exhausted.includes('ask the model to continue'));
});

test('assistant replies format a forecast table, paragraphs, emphasis, and lists',()=>{
  const html=chatMarkdown([
    'Here is the **National Weather Service** forecast.',
    '',
    '| Day | Forecast |',
    '|-----|----------|',
    '| **Tonight** | Mostly cloudy, low around 36°F. |',
    '| **Thursday** | Chance of rain. |',
    '',
    '**Summary:**',
    '- **Thursday:** A chance of rain.',
    '- Check the [official forecast](https://example.com/forecast).',
  ].join('\n'));
  assert.match(html,/<p>Here is the <strong>National Weather Service<\/strong> forecast\.<\/p>/);
  assert.match(html,/<th scope="col">Day<\/th><th scope="col">Forecast<\/th>/);
  assert.match(html,/<td><strong>Tonight<\/strong><\/td><td>Mostly cloudy, low around 36°F\.<\/td>/);
  assert.match(html,/<ul><li><strong>Thursday:<\/strong> A chance of rain\.<\/li>/);
  assert.match(html,/<a href="https:\/\/example\.com\/forecast"[^>]*>official forecast<\/a>/);
});

test('assistant Markdown leaves raw HTML and code inert and never embeds remote images',()=>{
  const html=chatMarkdown('<img src="https://example.com/html.png">\n[unsafe](javascript:bad)\n![caption](https://example.com/remote.png)\n\n```html\n<b>literal</b>\n```');
  assert.ok(html.includes('&lt;img'));
  assert.match(html,/<pre[^>]+><code>&lt;b&gt;literal&lt;\/b&gt;\n<\/code><\/pre>/);
  assert.ok(html.includes('caption'));
  assert.doesNotMatch(html,/<img|<a |remote\.png|javascript:/);
});

test('long replies outline section headings and preserve the exact contents of fenced blocks',()=>{
  const text=[
    'SECTION A — Overview','══════','**A.1** First line','continues here.','',
    '| Item | Count |','|---|---:|','| Kit | 4 |','',
    '══════','SECTION B — Details','══════','> A quoted note','',
    '```python','  <b>literal</b>','SECTION C — inside code','══════','','```','',
    '---','Outside the code.','',
  ].join('\r\n');
  const html=chatMarkdown(text);
  assert.match(html,/<nav class="chat-outline"/);
  assert.match(html,/<h2 data-chat-heading="0"[^>]*>Section A — Overview<\/h2>/);
  assert.match(html,/<h2 data-chat-heading="1"[^>]*>Section B — Details<\/h2>/);
  assert.equal((html.match(/data-chat-jump/g)||[]).length,2);
  assert.match(html,/<strong>A\.1<\/strong> First line continues here\./);
  assert.match(html,/<th scope="col" data-align="end">Count<\/th>/);
  assert.match(html,/<blockquote>A quoted note<\/blockquote>/);
  assert.match(html,/<code>  &lt;b&gt;literal&lt;\/b&gt;&#13;\nSECTION C — inside code&#13;\n══════&#13;\n&#13;\n<\/code>/);
  assert.equal((html.match(/══════/g)||[]).length,1);
  assert.equal((html.match(/<hr>/g)||[]).length,1);
});

test('streamed code becomes copyable once closed and untrusted labels cannot inject markup',()=>{
  const text='## <img src=x onerror=alert(1)>\n\n```js" onclick="alert(1)\nalert(1)';
  const live=chatMarkdownBlocks(text,{partial:true}).join('');
  assert.match(live,/aria-label="Text block"/);
  assert.match(live,/&lt;img/);
  assert.doesNotMatch(live,/<img|data-copy-code| onclick="/);
  assert.match(chatMarkdownBlocks(text+'\n```',{partial:true}).join(''),/data-copy-code/);
  assert.match(chatMarkdown(text),/data-copy-code/);
});
