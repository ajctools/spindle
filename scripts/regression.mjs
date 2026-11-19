import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {appCheckBrowser} from '../museum-app-check.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!['--browser','--browser-only','--help'].includes(arg))){
  console.error('Usage: node scripts/regression.mjs [--browser | --browser-only]');
  process.exit(1);
}
if(args.includes('--help')){
  console.log('Usage: node scripts/regression.mjs [--browser | --browser-only]');
  process.exit(0);
}

const spawnOptions={cwd:root,windowsHide:true};
function runNode(args){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{...spawnOptions,stdio:'inherit'});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`${args[0]} failed (${signal??code})`)));
  });
}

async function waitFor(label,check,timeout=15000){
  const deadline=Date.now()+timeout;
  do{const value=await check();if(value)return value;await delay(100);}while(Date.now()<deadline);
  throw Error(`Timed out waiting for ${label}`);
}

async function freePort(){
  const socket=net.createServer();
  await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const {port}=socket.address();
  await new Promise(resolve=>socket.close(resolve));
  return port;
}

function browserSession(ws,errors){
  let sequence=0;
  const pending=new Map();
  ws.onmessage=({data})=>{
    const message=JSON.parse(data);
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
    const finish=pending.get(message.id);
    if(finish){pending.delete(message.id);finish(message);}
  };
  ws.onclose=()=>{
    for(const finish of pending.values())finish({error:{message:'Browser connection closed'}});
    pending.clear();
  };
  return (method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command timed out: ${method}`));},10000);
    pending.set(id,({error,result})=>{clearTimeout(timer);if(error)reject(Error(error.message));else resolve(result);});
    ws.send(JSON.stringify({id,method,params}));
  });
}

async function stopTree(child){
  if(!child?.pid||child.exitCode!==null||child.signalCode!==null)return;
  if(process.platform==='win32'){
    await new Promise(resolve=>{
      const task=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      task.once('error',resolve);task.once('exit',resolve);
    });
  }else{
    const exited=new Promise(resolve=>child.once('exit',resolve));
    try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
    await Promise.race([exited,delay(2000,undefined,{ref:false})]);
    if(child.exitCode===null&&child.signalCode===null){
      try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
      await exited;
    }
  }
}

async function smokeBrowser(profile){
  const browser=await appCheckBrowser();
  assert.ok(browser,'Install Chrome or Edge, or set SPINDLE_BROWSER to run browser checks.');
  const port=await freePort(),origin=`http://127.0.0.1:${port}`;
  const detached=process.platform!=='win32';
  const temp=path.dirname(profile);
  const demo=spawn(process.execPath,['scripts/preview-demo.mjs'],{...spawnOptions,detached,env:{...process.env,TMPDIR:temp,TMP:temp,TEMP:temp,SPINDLE_DEMO_PORT:String(port)},stdio:'inherit'});
  let demoError;
  demo.once('error',error=>{demoError=error;});
  let chrome,ws,closeBrowser;
  try{
    await waitFor('synthetic preview',async()=>{
      if(demoError)throw demoError;
      assert.equal(demo.exitCode,null,'Synthetic preview exited early');
      try{const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});await response.body?.cancel();return response.ok;}catch{return false;}
    });
    chrome=spawn(browser,['--headless=new','--mute-audio','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{...spawnOptions,detached,stdio:'ignore'});
    let browserError;
    chrome.once('error',error=>{browserError=error;});
    const devPort=await waitFor('browser debug port',async()=>{
      if(browserError)throw browserError;
      try{return Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch(error){if(error.code!=='ENOENT')throw error;}
    });
    const tabs=await (await fetch(`http://127.0.0.1:${devPort}/json/list`,{signal:AbortSignal.timeout(5000)})).json();
    const page=tabs.find(tab=>tab.type==='page');
    assert.ok(page?.webSocketDebuggerUrl,'The browser did not provide a page to test');
    ws=new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    const errors=[],call=browserSession(ws,errors);
    // Edge on Windows can re-launch itself under a different PID.
    closeBrowser=()=>call('Browser.close');
    const evaluate=async expression=>{
      const {result,exceptionDetails}=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
        .catch(error=>{throw Error(`${error.message} while evaluating ${expression.slice(0,180)}`,{cause:error});});
      assert.ok(!exceptionDetails,exceptionDetails?.exception?.description??expression);
      return result.value;
    };
    const $=selector=>`document.querySelector(${JSON.stringify(selector)})`;
    const waitForElement=selector=>waitFor(selector,()=>evaluate(`!!${$(selector)}`));
    const click=selector=>evaluate(`${$(selector)}.click()`);
    const visible=selector=>evaluate(`!!${$(selector)}?.getClientRects().length`);
    const navigate=page=>click(`#nav [data-page="${page}"]`);
    const fit=label=>evaluate('document.documentElement.scrollWidth <= innerWidth+1').then(value=>assert.ok(value,`${label} overflows the viewport`));
    await call('Runtime.enable');
    await call('Page.enable');
    const projectFixture=await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
      localStorage.removeItem('spindle-last-chat-run');
      window.syntheticProjectFixture=true;
      const previousFetch=window.fetch.bind(window);
      const checkpoint={id:'saved-gpu',title:'GPU shortlist',brief:'Keep cooling below the limit.',result:'Longer GPU reply',sources:[],savedAt:'2026-01-01'};
      const project={id:'fixture-project',name:'Personal graphics hardware research',checkpoints:[checkpoint]};
      window.fetch=async (url,options)=>{
        if(url==='/api/state')return Response.json({...await (await previousFetch(url,options)).json(),demo:false});
        if(url==='/api/projects')return Response.json([{id:project.id,name:project.name,count:1}]);
        if(url==='/api/projects?id='+project.id)return Response.json(project);
        return previousFetch(url,options);
      };
    }`});
    await call('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:origin});
    await waitForElement('#chat-project').catch(async error=>{
      const status=await evaluate(`(async()=>({banner:document.querySelector('#banner')?.textContent,view:document.querySelector('#breadcrumb')?.textContent,
        error:await import('/project-memory.mjs').then(()=>null,error=>String(error)),fixture:!!window.syntheticProjectFixture,
        demo:(await (await fetch('/api/state')).json()).demo,mode:!!document.querySelector('#workspace-mode')}))()`);
      throw Error(`${error.message}: ${JSON.stringify(status)} ${errors.join(' ')}`);
    });
    await click('#chat-project');
    await waitForElement('[data-project-action="view"]');
    await click('[data-project-action="view"]');
    await waitForElement('[data-project-action="latest"]');
    await fit('Project picker at 320px');
    await click('[data-project-action="latest"]');
    await waitFor('checkpoint resume',()=>evaluate(`${$('#project-memory-label')}?.textContent.includes('GPU shortlist') && !${$('#project-dialog')}.open`));
    await fit('Project composer at 320px');
    await click('#toggle-project-memory');
    await click('#toggle-project-memory');
    assert.equal(await evaluate(`${$('#project-memory-label')}.textContent`),'Project recall paused');
    console.log('Project browser checks passed at 320px.');
    await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:projectFixture.identifier});
    await call('Emulation.clearDeviceMetricsOverride');
    await call('Page.navigate',{url:origin});
    await waitForElement('#workspace-mode');
    assert.ok(await evaluate(`${$('#demo-notice')}.textContent.includes('SYNTHETIC MODELS')`),'Synthetic preview is required');
    const modes=await evaluate("[...document.querySelector('#workspace-mode').options].map(option=>option.value)");
    assert.equal(modes.length,11);
    for(const [width,height] of [[320,568],[390,844],[768,1024],[1440,900]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(const mode of modes){
        await evaluate(`(()=>{const select=${$('#workspace-mode')};select.value=${JSON.stringify(mode)};select.dispatchEvent(new Event('change'));})()`);
        assert.ok(await evaluate(`!!${$('#run-task')}?.getClientRects().length`),`Primary action missing for ${mode}`);
        assert.ok(await evaluate(`${$('#task-form > details.chat-options')}?.open === false`),`Options missing or open for ${mode}`);
        await fit(`${mode} at ${width}px`);
      }
    }
    await evaluate(`(()=>{const select=${$('#workspace-mode')};select.value='chat';select.dispatchEvent(new Event('change'));})()`);
    await call('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});
    await click('#mobile-wordmark');
    assert.ok(await visible('.focus-wordmark .focus-label'),'The mobile wordmark should show the Focus label');
    assert.ok(await evaluate(`(()=>{
      const readings=[...document.querySelectorAll('.pulse-metric b')];
      const previous=readings.map(reading=>reading.textContent);
      for(const reading of readings)reading.textContent='100%';
      const fits=${$('.focus-label')}.getBoundingClientRect().right <= ${$('.pulse-metrics')}.getBoundingClientRect().left;
      readings.forEach((reading,i)=>{reading.textContent=previous[i];});
      return fits;
    })()`),'The Focus label should fit beside the gauges at 320px with full readings');
    await click('#exit-focus');
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate(`${$('#desktop-wordmark')}.dispatchEvent(new MouseEvent('click',{detail:2,bubbles:true,cancelable:true}));`);
    assert.ok(await visible('.focus-mode .focus-wordmark'),'Desktop wordmark should open Focus');
    assert.ok(await visible('.focus-wordmark .focus-label'),'The desktop wordmark should show the Focus label');
    assert.ok(!await visible('.sidebar'),'Focus should hide the desktop sidebar');
    assert.ok(await evaluate(`(()=>{
      const title=${$('.focus-wordmark')}.getBoundingClientRect();
      const metrics=${$('.pulse-metrics')}.getBoundingClientRect();
      const status=${$('#pulse-job')}.getBoundingClientRect();
      const privacy=${$('.privacy-strip')}.getBoundingClientRect();
      return metrics.left>=title.right && metrics.top<title.bottom && status.top>=title.bottom &&
        status.bottom<=privacy.top && ${$('#view')}.clientWidth<=1024;
    })()`),'Focus should put the gauges beside the title, with status on the next row');
    assert.ok(!await visible('#workspace-welcome')&&!await visible('#prompt'),'Empty Focus should hide the welcome panel and composer');
    assert.ok(await visible('#focus-compose'),'Empty Focus should let you start writing');
    await evaluate('window.focusStorageBefore=JSON.stringify(Object.entries(localStorage));');
    await click('#focus-compose');
    await evaluate(`(()=>{
      const prompt=${$('#prompt')};prompt.focus();prompt.value='Keep this draft.';
      prompt.dispatchEvent(new Event('input'));
    })()`);
    await waitFor('the desktop prompt to expand',()=>evaluate(`${$('#prompt')}.clientHeight>innerHeight*.35`));
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");
    assert.ok(!await visible('.focus-mode .focus-wordmark'),'Escape should exit Focus');
    assert.ok(!await visible('.focus-wordmark .focus-label'),'The Focus label should disappear on exit');
    assert.equal(await evaluate(`${$('#prompt')}.value`),'Keep this draft.');
    assert.ok(await evaluate('window.focusStorageBefore===JSON.stringify(Object.entries(localStorage))'),'Focus and its unsent draft should stay out of browser storage');
    await click('#enter-focus');
    await click('#pulse-job');
    await waitForElement('#cost-coverage');
    assert.ok(!await visible('.focus-mode .focus-wordmark'),'Navigating from Focus should restore regular layout');
    assert.ok(await evaluate(`${$('#desktop-wordmark')}.matches('a[href="/"]:not([role])')`),'The desktop wordmark should remain a regular home link outside chat');
    for(const [page,selector] of [['dashboard','#cost-coverage'],['workflows','#rough-cut-workflow'],['meeting','#meeting-preview-settings'],['library','#runs'],['device','#readiness']]){
      await navigate(page);await waitForElement(selector);await fit(page);
    }
    for(const section of ['models','connection','security']){
      await click(`[data-device-section="${section}"]`);
      await waitForElement(`[data-device-section="${section}"][aria-current="page"]`);
    }
    for(const [button,dialog] of [['#open-guide','#guide-dialog'],['#open-global-search','#global-search'],['#nav [data-open-prompt-dex]','.prompt-dex']]){
      await click(button);await waitForElement(`${dialog}[open]`);await evaluate(`${$(dialog)}.close()`);
    }
    await navigate('dashboard');
    await waitFor('dashboard totals',()=>evaluate(`${$('#cost-coverage')}?.textContent.includes('completed chat steps')`));
    await click('[data-days="0"]');
    await waitFor('all-time cost',()=>evaluate(`${$('#cost-period')}?.textContent.startsWith('All time')`));
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await click('#open-navigation');await waitForElement('#navigation-dialog[open]');
    await click('#mobile-navigation [data-page="meeting"]');await waitForElement('#meeting-file');
    await evaluate(`(async()=>{
      const response=await fetch('/samples/voice-reference.wav');
      if(!response.ok)throw Error('Could not load the synthetic recording');
      const file=new File([await response.blob()],'Meeting sample.wav',{type:'audio/wav'});
      const input=${$('#meeting-file')},transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    await waitFor('decoded meeting draft',()=>evaluate(`${$('#meeting-draft-player')}?.duration>0`));
    assert.equal(await evaluate(`${$('#meeting-download')}.download`),'Meeting sample.wav');
    await fit('Meeting Desk with draft at 390px');
    await navigate('workbench');await navigate('meeting');await waitForElement('#meeting-draft-player');
    assert.equal(await evaluate(`${$('#meeting-download')}.download`),'Meeting sample.wav');
    const runId='9c45ccb7-9c44-4196-89df-b2d2097b37f5';
    const diagram='  '+('├── Ready → confirm pickup '.repeat(5));
    const formatted=[
      'SECTION A — Summary','══════','Keep **18 units** for pickup.','',
      '| Item | Count |','|---|---:|','| Kit | 24 |','',
      '```text',diagram,'```','',
    ].join('\r\n');
    const sections='SECTION B — Timing\n\nSaturday.\n\nSECTION C — Storage\n\nUse the shelf.\n\nSECTION D — Follow-up\n\nSend a note.';
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
      const run={id:${JSON.stringify(runId)},name:'Chat & vision',status:'running',phase:'Thinking',keepChatModel:true,
        startedAt:new Date().toISOString(),steps:[{task:'chat',promptMode:'literal',model:'demo/chat',prompt:'Summarize the pickup.'}],outputs:[]};
      const initial=${JSON.stringify(formatted)},final=initial+'\\n'+${JSON.stringify(sections)};
      const reasoning=Array.from({length:75},(_,i)=>'Synthetic reasoning line '+i).join('\\n');
      localStorage.setItem('spindle-last-chat-run',run.id);
      window.advanceSyntheticReply=phase=>{
        if(phase===2){run.status='completed';run.outputs=[{task:'chat',model:'demo/chat',text:final,reasoning}];delete run.partial;}
        else run.partial={task:'chat',model:'demo/chat',text:phase?initial+'\\nSECTION B — Timing':initial,reasoning:reasoning+(phase?'\\nAdditional thought':'')};
      };
      window.advanceSyntheticReply(0);
      const fetchFromServer=window.fetch.bind(window);
      let nextRun;
      window.fetch=(url,...args)=>{
        if(url==='/api/endpoints')return Promise.resolve(Response.json([{id:'fixture-endpoint',name:'Fixture provider',url:'https://example.test/v1',models:['demo/chat'],keyPresent:true}]));
        if(url==='/api/run'){
          if(window.rejectNextFocusSend){
            window.rejectNextFocusSend=false;
            return Promise.resolve(Response.json({error:'Synthetic send rejected.'},{status:409}));
          }
          window.submittedFixture=JSON.parse(args[0].body);
          nextRun={...run,id:'29c68a10-70e4-49b5-a532-c90699b941da',status:'queued',outputs:[]};
          return Promise.resolve(Response.json(nextRun));
        }
        if(url==='/api/cancel/'+nextRun?.id){
          window.stoppedFocusRun=nextRun.id;
          return Promise.resolve(Response.json({ok:true}));
        }
        if(url==='/api/runs')return Promise.resolve(Response.json(nextRun?[nextRun,run]:[run]));
        return fetchFromServer(url,...args);
      };
    }`});
    await call('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});
    await call('Page.reload',{ignoreCache:true});
    await waitForElement('[data-chat-live] .chat-code').catch(async error=>{
      const status=await evaluate(`({fixture:typeof window.advanceSyntheticReply,restored:!!document.querySelector('#chat-history .from-user'),status:document.querySelector('#output-status')?.textContent})`);
      throw Error(`${error.message}: ${JSON.stringify(status)} ${errors.join(' ')}`);
    });
    assert.ok(await visible('#mobile-wordmark'),'The mobile wordmark should remain visible at 320px');
    await click('#mobile-wordmark');
    assert.ok(await visible('.focus-mode .focus-wordmark'),'The mobile wordmark should open Focus');
    assert.equal(await evaluate(`${$('#pulse-detail')}.textContent`),'Thinking');
    assert.ok(await visible('.focus-run-bar #focus-stop'),'A live run should keep Stop run accessible');
    assert.ok(await visible('#chat-search-notice'),'Focus should keep the search notice visible during a run');
    assert.ok(!await visible('#prompt'),'The Focus composer should collapse during a run');
    assert.equal(await evaluate(`${$('#focus-read')}.getAttribute('aria-pressed')`),'true');
    assert.ok(!await visible('#chat-history .from-user'),'Read should hide the earlier conversation');
    assert.ok(await visible('[data-chat-live] .chat-code'),'Read should display the streaming response');
    await fit('Focus with a streaming reply at 320px');
    await click('#output [data-reasoning] summary');
    await evaluate(`window.firstChatBlock=${$('[data-chat-live] h2')};window.firstThinking=${$('#output [data-reasoning]')};
      ${$('#conversation')}.scrollTop=800;window.readingTop=${$('#conversation')}.scrollTop;window.advanceSyntheticReply(1);`);
    await waitFor('formatted streaming update',()=>evaluate(`document.querySelectorAll('[data-chat-live] h2').length===2`));
    assert.ok(await evaluate(`window.firstChatBlock===${$('[data-chat-live] h2')}`),'Streaming replaced an unchanged heading');
    assert.ok(await evaluate(`window.firstThinking===${$('#output [data-reasoning]')} && window.firstThinking.open &&
      window.readingTop>=800 && Math.abs(${$('#conversation')}.scrollTop-window.readingTop)<10`),'Streaming reset the open Thinking panel or reading position');
    await evaluate('window.advanceSyntheticReply(2)');
    await waitForElement('#chat-history .chat-outline');
    assert.ok(await visible('#chat-history .chat-outline'),'Read should display the completed response');
    assert.ok(await evaluate(`${$('#chat-history [data-reasoning]')}.open && ${$('#conversation')}.scrollTop>700`),'Completing a stream reset the open Thinking panel');
    assert.ok(!await visible('.focus-run-bar'),'The compact run bar should clear when the response completes');
    assert.ok(!await visible('#task-form')&&!await visible('#chat-run-stats'),'Completed replies should have the reading space to themselves');
    await click('#focus-chat');
    assert.ok(!await visible('#prompt'),'Showing the transcript should leave the composer tucked away');
    assert.ok(await visible('#chat-history .from-user'),'Chat should restore the conversation');
    await click('#focus-compose');
    assert.ok(await visible('#chat-search-notice'),'The search warning should be visible while writing');
    await waitFor('the mobile prompt to expand with Send in view',()=>evaluate(`(()=>{
      const prompt=${$('#prompt')}.getBoundingClientRect(),send=${$('#run-task')}.getBoundingClientRect();
      const form=${$('#task-form')}.getBoundingClientRect();
      return prompt.height>innerHeight*.35 && send.bottom<=form.bottom;
    })()`));
    await click('#exit-focus');
    assert.equal(await evaluate(`getComputedStyle(${$('#chat-history .chat-markdown strong')}).display`),'inline');
    assert.ok(await evaluate(`(()=>{const code=${$('#chat-history .chat-code pre')};return code.scrollWidth>code.clientWidth;})()`),'Wide code should scroll within the reply');
    await fit('Formatted reply at 320px');
    await click('#chat-history [data-chat-jump="3"]');
    assert.match(await evaluate('document.activeElement.textContent'),/Follow-up/);
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedReply=text;}}});`);
    await click('#chat-history [data-copy-code]');
    assert.equal(await evaluate('window.copiedReply'),diagram+'\r\n');
    await click('#chat-history [data-copy-kind="reply"]');
    assert.equal(await evaluate('window.copiedReply'),formatted+'\n'+sections);
    await click('#mobile-wordmark');
    await click('#focus-chat');
    await click('#focus-compose');
    await evaluate(`${$('#prompt')}.value='Check the pickup time again.';`);
    await click('#focus-compose');
    assert.ok(!await visible('#prompt'),'Hide composer should tuck the editor away');
    await click('#focus-compose');
    assert.equal(await evaluate(`${$('#prompt')}.value`),'Check the pickup time again.');
    await evaluate('window.rejectNextFocusSend=true;');
    await click('#run-task');
    await waitFor('rejected Send to restore the Focus composer',()=>evaluate(`${$('#action-error')}.textContent.includes('Synthetic send rejected.') && !!${$('#prompt')}.getClientRects().length`));
    assert.equal(await evaluate(`${$('#prompt')}.value`),'Check the pickup time again.');
    await evaluate(`${$('#prompt')}.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));`);
    await waitForElement('.focus-reading #stop-current');
    assert.ok(!await visible('#focus-compose')&&!await visible('#prompt'),'Sending should return to reading and hide the editor');
    await click('#focus-stop');
    assert.equal(await evaluate('window.stoppedFocusRun'),'29c68a10-70e4-49b5-a532-c90699b941da');
    await click('#exit-focus');
    await navigate('device');
    assert.match(await evaluate(`${$('#breadcrumb')}.textContent`),/^Settings/);
    await click('[data-device-section="endpoints"]');
    assert.ok(await visible('[data-endpoint-form]'));
    await click('#open-endpoint-chat');
    await evaluate(`${$('#model')}.querySelector('[data-endpoint]').selected=true; ${$('#model')}.dispatchEvent(new Event('change'));`);
    assert.match(await evaluate(`${$('#chat-endpoint-notice')}.textContent`),/Fixture provider/);
    assert.ok(!await visible('#send-tiiny-only')&&!await visible('#attach-image'));
    await evaluate(`${$('#prompt')}.value='Test external chat'; ${$('#prompt')}.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true,cancelable:true}));`);
    await waitFor('a custom endpoint submission',()=>evaluate('window.submittedFixture?.endpointId==="fixture-endpoint"'));
    assert.equal(await evaluate('window.submittedFixture.steps[0].model'),'demo/chat');

    assert.deepEqual(errors,[],'Browser exceptions');
    console.log('Browser smoke passed: 11 creation modes at 4 viewport sizes, project resume and pause, navigation, device settings, dialogs, cost filters, meeting drafts, Focus, and streaming chat formatting and copy.');
  }finally{
    if(ws?.readyState===WebSocket.OPEN)await closeBrowser?.().catch(()=>{});
    ws?.close();
    await stopTree(chrome);
    await stopTree(demo);
  }
}

const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-regression-'));
try{
  if(!args.includes('--browser-only')){
    await runNode(['--test','--test-reporter=spec','test/*.test.mjs']);
    await runNode(['scripts/release.mjs','--out',path.join(scratch,'release')]);
  }
  if(args.some(arg=>arg.startsWith('--browser')))await smokeBrowser(path.join(scratch,'browser'));
}finally{
  await fs.rm(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
