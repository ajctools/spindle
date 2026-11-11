import test from 'node:test';
import assert from 'node:assert/strict';
import {chatMessage,chatSettings,readChatResponse} from '../chat.mjs';
import {chatDetails,chatMarkdown,withResponseLimit} from '../public/chat-ui.mjs';
import {loadChatOptions,saveChatOptions,ampleResponseTokens} from '../public/chat-settings.mjs';
import {createMetric} from '../metrics.mjs';

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
  assert.equal(ampleResponseTokens({context:16384}),8192);assert.equal(ampleResponseTokens({context:131072}),32768);assert.equal(ampleResponseTokens({context:'unknown'}),32768);
  assert.equal(chatSettings({}, {context:8192}).max_tokens,4096);
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
  const events=[{choices:[{delta:{reasoning_content:'A thought 🌟'}}]}, {choices:[{delta:{content:'An answer.'}}]}, {choices:[{delta:{},finish_reason:'length'}]}, {choices:[],usage:{prompt_tokens:5,completion_tokens:9,total_tokens:14},timings:{predicted_per_second:12}}];
  const data=Buffer.from(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n');let cursor=0;const updates=[];
  const response=new Response(new ReadableStream({pull(controller){if(cursor>=data.length){controller.close();return;}controller.enqueue(data.subarray(cursor,cursor+1));cursor++;}}),{headers:{'content-type':'text/event-stream'}});
  const result=await readChatResponse(response,{onUpdate:out=>updates.push(out)});
  assert.equal(result.streamed,true);assert.equal(result.reasoning,'A thought 🌟');assert.equal(result.text,'An answer.');assert.equal(result.finishReason,'length');assert.equal(result.json.usage.total_tokens,14);assert.equal(result.json.timings.predicted_per_second,12);
  assert.ok(updates.some(out=>out.reasoning&&!out.text));
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
  assert.ok(html.includes('<pre><code>&lt;b&gt;literal&lt;/b&gt;</code></pre>'));
  assert.ok(html.includes('caption'));
  assert.doesNotMatch(html,/<img|<a |remote\.png|javascript:/);
});
