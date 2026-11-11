import test from 'node:test';
import assert from 'node:assert/strict';
import {duckResults,searchWeb,searchContext,publicSearchURL,searchQuery} from '../web-search.mjs';

test('search does not turn workflow handoffs or credentials into provider queries',()=>{
  const key='fixture-device/key',options={prompt:'Private text from a previous step',usesWorkflowData:true,secrets:[key]};
  assert.throws(()=>searchQuery(options),/explicit web search query/);
  assert.equal(searchQuery({...options,query:'  public query  '}),'public query');
  assert.equal(searchQuery({prompt:'A current standalone prompt'}),'A current standalone prompt');
  for(const value of [key,encodeURIComponent(key),Buffer.from(key).toString('base64')])assert.throws(()=>searchQuery({...options,query:value}),/Remove the API key/);
});

test('keyless search extracts safe snippets and unwraps DuckDuckGo redirects',()=>{
  const result=duckResults('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F">Example &amp; title</a><a class="result__snippet">A <b>useful</b> snippet.</a><a class="result__a" href="javascript:alert(1)">Bad</a><a class="result__a" href="https://example.com/">Duplicate</a>');
  assert.equal(result.length,1);assert.equal(result[0].url,'https://example.com/');assert.equal(result[0].title,'Example & title');assert.equal(result[0].snippet,'A useful snippet.');
  for(const url of ['http://localhost/a','http://127.0.0.1','http://[::1]','http://device.local','file:///a','https://key@example.com','javascript:alert(1)'])assert.equal(publicSearchURL(url),null);
  assert.throws(()=>duckResults('<form id="challenge-form"></form>'),/verification/);
});
test('search sends only the explicit query and provider credential to fixed HTTPS services',async()=>{
  let request;
  const out=await searchWeb({query:'public test',provider:'brave',key:'fixture-search-key',fetcher:async(url,options)=>{request={url,options};return Response.json({web:{results:[{title:'Example',url:'https://example.com',description:'A snippet'}]}});}});
  assert.equal(request.url.origin,'https://api.search.brave.com');assert.equal(request.url.searchParams.get('q'),'public test');assert.equal(request.options.redirect,'error');assert.equal(request.options.headers['X-Subscription-Token'],'fixture-search-key');assert.equal(request.options.headers.Authorization,undefined);
  assert.equal(out.sources.length,1);assert.ok(!JSON.stringify(out).includes('fixture-search-key'));assert.ok(searchContext(out).content.includes('untrusted snippets'));
  const ddg=await searchWeb({query:'public test',key:'never-send-this',fetcher:async(url,options)=>{assert.equal(url.origin,'https://html.duckduckgo.com');assert.equal(options.headers['X-Subscription-Token'],undefined);return new Response('<a class="result__a" href="https://example.com">Example</a>');}});assert.equal(ddg.provider,'duckduckgo');
});
test('failed searches never silently generate an answer or echo raw provider errors',async()=>{
  await assert.rejects(searchWeb({query:'',fetcher:()=>assert.fail()}),/query/);
  await assert.rejects(searchWeb({query:'test',provider:'brave',fetcher:()=>assert.fail()}),/API key/);
  await assert.rejects(searchWeb({query:'test',provider:'unknown',fetcher:()=>assert.fail()}),/Choose/);
  await assert.rejects(searchWeb({query:'test',fetcher:async()=>new Response('secret provider error',{status:429})}),e=>e.message.includes('429')&&!e.message.includes('secret'));
  await assert.rejects(searchWeb({query:'test',fetcher:async()=>new Response('no results')}),/no usable results/);
  await assert.rejects(searchWeb({query:'test',fetcher:async()=>new Response('x'.repeat(2_000_001))}),/size limit/);
});
