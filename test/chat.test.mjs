import test from 'node:test';
import assert from 'node:assert/strict';
import {chatMessage,chatSettings,readChatResponse} from '../chat.mjs';
import {chatDetails} from '../public/chat-ui.mjs';
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
  assert.ok(html.includes('data-reasoning'));assert.ok(!html.includes('<details class="thinking-panel" open'));assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('noopener noreferrer'));assert.ok(html.includes('token limit'));
});
