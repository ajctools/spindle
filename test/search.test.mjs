import test from 'node:test';
import assert from 'node:assert/strict';
import {duckResults,searchWeb,searchContext,publicSearchURL,searchQuery} from '../web-search.mjs';
import {chatDetails} from '../public/chat-ui.mjs';

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

test('weather chat reads a dated NWS forecast when the search snippet has no forecast values',async()=>{
  const date=new Date();
  const time=date.toLocaleString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
  const day=date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const calls=[];
  const search=await searchWeb({
    query:"what's todays weather in South Portland, ME",provider:'brave',key:'fixture-brave-key',
    fetcher:async (url,options)=>{
      calls.push(url.href);
      if(url.hostname==='api.search.brave.com')return Response.json({web:{results:[
        {title:'Weather site',url:'https://example.com/forecast',description:'Local weather'},
        {title:'NWS',url:'https://forecast.weather.gov/zipcity.php?inputstring=South_Portland%2C%20ME&ignored=other'},
      ]}});
      assert.equal(url.origin,'https://forecast.weather.gov');
      assert.deepEqual(options.headers,{Accept:'text/html'});
      if(url.pathname==='/zipcity.php'){
        assert.equal(options.redirect,'manual');
        assert.deepEqual([...url.searchParams],[['inputstring','South Portland, ME']]);
        return new Response(null,{status:302,headers:{Location:'//forecast.weather.gov/MapClick.php?textField1=43.6328&textField2=-70.2855&ignored=other'}});
      }
      assert.equal(options.redirect,'error');
      assert.deepEqual([...url.searchParams],[['lat','43.6328'],['lon','-70.2855'],['FcstType','text'],['TextType','1'],['unit','0']]);
      return new Response(`<b>NWS Forecast for: South Portland ME</b><br>Issued by: National Weather Service<br><a><b>Last Update: </b></a>${time} UTC ${day}</td><br><b>Today: </b>Sunny, with a high near 57. <br><b>Tonight: </b>Cloudy, with a low around 40. <br>`);
    },
  });
  assert.equal(calls.length,3);
  assert.equal(search.sources[1].forecast,undefined);
  const forecast=search.sources[0].forecast;
  assert.equal(forecast.location,'South Portland ME');
  assert.deepEqual(forecast.periods,[{name:'Today',detail:'Sunny, with a high near 57.'},{name:'Tonight',detail:'Cloudy, with a low around 40.'}]);
  assert.ok(Date.now()-Date.parse(forecast.issuedAt)<60_000);
  assert.match(searchContext(search).content,/high near 57/);
  assert.match(chatDetails({webSearch:search}),/NWS forecast for South Portland ME.*high near 57/);
});

test('weather chat handles both place-first queries and two towns without NWS search results',async()=>{
  const locations=new Map([['Saco, ME','43.5'],['South Portland, ME','43.6']]);
  const lookedUp=[];
  const date=new Date();
  const time=date.toLocaleString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'UTC'});
  const day=date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  const fetcher=async url=>{
    if(url.hostname==='html.duckduckgo.com')return new Response('<a class="result__a" href="https://example.com/forecast">Weather results</a>');
    assert.equal(url.origin,'https://forecast.weather.gov');
    if(url.pathname==='/zipcity.php'){
      const place=url.searchParams.get('inputstring');
      lookedUp.push(place);
      return new Response(null,{status:302,headers:{Location:'/MapClick.php?lat='+locations.get(place)+'&lon=-70'}});
    }
    const location=url.searchParams.get('lat')==='43.5'?'Saco ME':'South Portland ME';
    return new Response(`<b>NWS Forecast for: ${location}</b><br><a><b>Last Update: </b></a>${time} UTC ${day}</td><b>Today: </b>Sunny, with a high near 57. <br>`);
  };
  const search=await searchWeb({query:"What's the weather today in Saco, ME and South Portland, ME?",fetcher});
  assert.deepEqual(lookedUp,[...locations.keys()]);
  assert.deepEqual(search.sources.filter(s=>s.forecast).map(s=>s.forecast.location),['Saco ME','South Portland ME']);
  lookedUp.length=0;
  const placeFirst=await searchWeb({query:'Saco, me weather today',fetcher});
  assert.deepEqual(lookedUp,['Saco, ME']);
  assert.equal(placeFirst.sources[0].forecast.location,'Saco ME');
});

test('weather chat keeps snippets when the NWS page is stale or the location redirects elsewhere',async()=>{
  const calls=[];
  const search=await searchWeb({query:'weather in two towns',fetcher:async (url,options)=>{
    calls.push(url.origin);
    if(url.hostname==='html.duckduckgo.com')return new Response(
      '<a class="result__a" href="https://forecast.weather.gov/zipcity.php?inputstring=Example">First town</a>'+
      '<a class="result__a" href="https://forecast.weather.gov/MapClick.php?lat=40&amp;lon=-70">Second town</a>'+
      '<a class="result__a" href="https://forecast.weather.gov.evil.example/MapClick.php?lat=40&amp;lon=-70">Lookalike</a>');
    assert.equal(url.origin,'https://forecast.weather.gov');
    if(url.pathname==='/zipcity.php')return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/MapClick.php?lat=40&lon=-70'}});
    return new Response('<b>NWS Forecast for: Example</b><br><a><b>Last Update: </b></a>6:21 am EST Nov 11, 2020</td><b>Today: </b>Sunny, with a high near 57.<br>');
  }});
  assert.equal(calls.length,3);
  assert.equal(search.sources.length,3);
  assert.ok(search.sources.every(s=>!s.forecast));
});
