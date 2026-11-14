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
      const {result,exceptionDetails}=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      assert.ok(!exceptionDetails,exceptionDetails?.exception?.description??expression);
      return result.value;
    };
    const $=selector=>`document.querySelector(${JSON.stringify(selector)})`;
    const waitForElement=selector=>waitFor(selector,()=>evaluate(`!!${$(selector)}`));
    const click=selector=>evaluate(`${$(selector)}.click()`);
    const navigate=page=>click(`#nav [data-page="${page}"]`);
    const fit=label=>evaluate('document.documentElement.scrollWidth <= innerWidth+1').then(value=>assert.ok(value,`${label} overflows the viewport`));
    await call('Runtime.enable');
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
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
      const run={id:${JSON.stringify(runId)},name:'Synthetic chat reply',status:'running',keepChatModel:true,
        startedAt:new Date().toISOString(),steps:[{task:'chat',promptMode:'literal',model:'demo/chat',prompt:'Summarize the pickup.'}],outputs:[]};
      const initial=${JSON.stringify(formatted)},final=initial+'\\n'+${JSON.stringify(sections)};
      localStorage.setItem('spindle-last-chat-run',run.id);
      window.advanceSyntheticReply=phase=>{
        if(phase===2){run.status='completed';run.outputs=[{task:'chat',model:'demo/chat',text:final}];delete run.partial;}
        else run.partial={task:'chat',model:'demo/chat',text:phase?initial+'\\nSECTION B — Timing':initial,reasoning:'Synthetic reasoning '+phase};
      };
      window.advanceSyntheticReply(0);
      const fetchFromServer=window.fetch.bind(window);
      window.fetch=(url,...args)=>url==='/api/runs'?Promise.resolve(Response.json([run])):fetchFromServer(url,...args);
    }`});
    await call('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});
    await call('Page.reload',{ignoreCache:true});
    await waitForElement('[data-chat-live] .chat-code').catch(async error=>{
      const status=await evaluate(`({fixture:typeof window.advanceSyntheticReply,restored:!!document.querySelector('#chat-history .from-user'),status:document.querySelector('#output-status')?.textContent})`);
      throw Error(`${error.message}: ${JSON.stringify(status)} ${errors.join(' ')}`);
    });
    await evaluate(`window.firstChatBlock=${$('[data-chat-live] h2')}; window.advanceSyntheticReply(1);`);
    await waitFor('formatted streaming update',()=>evaluate(`document.querySelectorAll('[data-chat-live] h2').length===2`));
    assert.ok(await evaluate(`window.firstChatBlock===${$('[data-chat-live] h2')}`),'Streaming replaced an unchanged heading');
    await evaluate('window.advanceSyntheticReply(2)');
    await waitForElement('#chat-history .chat-outline');
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
    assert.deepEqual(errors,[],'Browser exceptions');
    console.log('Browser smoke passed: 11 creation modes at 4 viewport sizes, navigation, device settings, dialogs, cost filters, meeting drafts, and streaming chat formatting and copy.');
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
