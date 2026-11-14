import {mountDashboard,stopDashboard,refreshDashboard} from './dashboard.js';
import {transcriptionFile} from './audio.js';
import {guides,essentials,workflowTips,workspaceTips,recovery,workflowWarnings,voiceCloneModel,voiceReferenceSample} from './guidance.mjs';
import {chatAppSource,chatDetails,chatMarkdown,chatReply,chatRunStats,isChatRun,restoreChat,updateLiveChat} from './chat-ui.mjs';
import {chatAttachmentText,maxTextBytes,maxTextFiles,pasteThreshold,readTextAttachments,validateTextAttachments} from './chat-attachments.mjs';
import {downloadArtifact} from './artifact-download.mjs';
import {meshPreviewHTML,installMeshPreviews} from './mesh-preview.mjs';
import {startDevicePulse} from './activity.mjs';
import {createRoughCut} from './rough-cut.mjs';
import {loadChatOptions,saveChatOptions,withResponseLimit,ampleResponseTokens,AMPLE_RESPONSE_TOKENS} from './chat-settings.mjs';
// Source upgrades can reach a browser before its helper has been restarted.
// Keep existing workspaces usable until the helper can serve the new module.
const globalSearch=await import('./global-search.mjs').catch(()=>null);
const vaultAttachment=await import('./vault-attachment.mjs').catch(()=>null);
const facsimileModule=await import('./facsimile-book.mjs').catch(()=>null);
const {createStudio}=await import('./studio.mjs').catch(()=>({createStudio:()=>({
  mount(element){element.innerHTML='<section class="panel"><div class="panel-head"><h2>Idea → image → film</h2><span class="pill">Helper restart needed</span></div><div class="panel-body"><p>The new workflow is installed. Restart the local helper with <code>node server.mjs</code>, then reload Spindle.</p><p class="help section-gap">Wait for active runs to finish first. Saved runs are kept. If your Tiiny key is session-only, enter it again after restarting.</p></div></section>';},
  update(){},adopt(){}
})}));
const {createWorkshops}=await import('./workshops.mjs').catch(()=>({createWorkshops:()=>({mount(element){element.innerHTML='<p class="help">Restart the helper to load the soundtrack and museum workflows.</p>';},update(){},adoptVideo(){}})}));
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,page='workbench',task='chat',selectedModel='',currentJob=null,chat=[],runs=[],saved=[],workflow={name:'Untitled workflow',steps:[]};
let chatModel='',chatRunId=null;
let filters={q:'',type:'all',status:'all'},connectionInfo=null,sampleInput=null,exampleUndo=null;
let chatStorage;try{chatStorage=window.localStorage;}catch{}
const chatRunKey='spindle-last-chat-run';
let pendingChatRestore;try{pendingChatRestore=chatStorage?.getItem(chatRunKey);}catch{}
let chatOptions=loadChatOptions(chatStorage);
let warmingChatModel='';
let warmChatError=null;
let promptDex=null;
let meetingDesk=null;
let runsTag='',pollPromise=null,librarySelection='';
const deviceSections={device:'Overview',models:'Models',connection:'Connection',security:'Security & Privacy'};
const searchPages=[...document.querySelectorAll('#nav [data-page],#nav [data-open-prompt-dex]')].map(button=>({
  type:'page',id:button.dataset.page||'prompt-dex',title:button.querySelector('span').textContent,
}));
searchPages.push(...Object.entries(deviceSections).filter(([id])=>id!=='device').map(([id,title])=>({type:'page',id,title})));
const icons={chat:'◈',image:'▧',asr:'≋',speech:'◖',music:'♫',video:'▷',ocr:'▤',mesh:'⬡',decision:'⑂',embed:'∷',rerank:'↕'};
const descriptions={chat:'Think, write, code, and understand images.',image:'Generate an image or work from a reference.',asr:'Turn a recording into text.',speech:'Give your words a voice.',music:'Compose from a description and optional lyrics.',video:'Create a clip from a prompt or animate an image.',ocr:'Extract text and document layout from an image.',mesh:'Turn an image into a 3D shape.',decision:'Evaluate structured questions and route a request.',embed:'Turn text into vectors for retrieval.',rerank:'Sort candidate documents by relevance.'};
async function api(url,body,{signal}={}){
  const options=body===undefined?{signal}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal};
  let r=await fetch(url,options);
  if(r.status===403){await fetch('/api/session',{signal});r=await fetch(url,options);}
  const j=await r.json();if(!r.ok)throw new Error(j.error || 'Request failed');return j;
}
installMeshPreviews();
startDevicePulse({api,getState:()=>state,navigate:target=>{page=target;show();}});
function toast(msg){$('#toast').textContent=msg;$('#toast').hidden=false;clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('#toast').hidden=true,6000);}
function copyButton(value,kind){
  if(typeof value!=='string'||!value.trim())return '';
  return `<button type="button" class="button quiet copy-button" data-copy-text="${esc(JSON.stringify(value))}" data-copy-kind="${esc(kind)}">Copy ${esc(kind)}</button>`;
}
async function copyText(value,kind){
  if(!value||(kind!=='block'&&!value.trim()))return;
  try{
    await navigator.clipboard.writeText(value);
    toast(kind[0].toUpperCase()+kind.slice(1)+' copied.');
  }catch{
    const dialog=$('#copy-dialog'),field=$('#copy-content');
    field.value=value;
    if(!dialog.open)dialog.showModal();
    field.focus();
    field.select();
  }
}
bind('#copy-dialog','close',()=>{$('#copy-content').value='';});
function appPreviewButton(output,runId,step){
  if(!runId||!chatAppSource(output))return '';
  const url='/api/chat/preview?'+new URLSearchParams({id:runId,step});
  return `<button type="button" class="button" data-preview-app="${esc(url)}" aria-controls="chat-app-preview">Open app preview</button>`;
}
let previewTrigger;
function closeAppPreview(restoreFocus=false){
  $('#chat-app-preview').hidden=true;
  document.body.classList.remove('chat-app-open');
  $('#chat-app-preview-content').replaceChildren();
  if(restoreFocus)previewTrigger?.focus();
  previewTrigger=null;
}
function openAppPreview(button){
  const frame=document.createElement('iframe');
  frame.title='Generated app';
  frame.setAttribute('sandbox','allow-scripts');
  frame.referrerPolicy='no-referrer';
  frame.src=button.dataset.previewApp;
  previewTrigger=button;
  $('#chat-app-preview').hidden=false;
  document.body.classList.add('chat-app-open');
  $('#chat-app-preview-content').replaceChildren(frame);
  $('#close-chat-app-preview').focus();
}
bind('#close-chat-app-preview','click',()=>closeAppPreview(true));
function fail(e){const tip=recovery(e.message);toast(tip.title);const slot=$('#action-error') || $('#workflow-feedback');if(slot){slot.innerHTML=recoveryHTML(e.message);slot.scrollIntoView({block:'nearest',behavior:'smooth'});}}
function bind(s,event,fn){const el=$(s);if(el)el.addEventListener(event,fn);}
function fmtSize(n){return n?(n/1073741824).toFixed(1)+' GiB':'Size not reported';}
function compatible(t,installed=false){return (state?.models || []).filter(m=>m.tasks.includes(t)&&(!installed||m.installed));}
function modelLabel(model,status=model.loaded?'loaded':model.installed?'downloaded':'download needed'){return model.name+' · '+status;}
function modelOptions(t,id,all=false){const ms=compatible(t,!all);return '<option value="">Choose a model…</option>'+ms.map(m=>`<option value="${esc(m.id)}" ${id===m.id?'selected':''}>${esc(modelLabel(m))}</option>`).join('');}
function preferred(t){return compatible(t,true).find(m=>m.loaded)?.id || compatible(t,true)[0]?.id || '';}
function preferredChatModel(){
  const models=compatible('chat',true);
  if(chatRunId&&chatModel&&!models.some(m=>m.id===chatModel))return '';
  return models.find(m=>m.id===chatModel)?.id || models.find(m=>m.loaded)?.id || models.find(m=>m.id===state.defaultChatModel)?.id || models[0]?.id || '';
}
function rememberChatRun(id){
  chatRunId=id;pendingChatRestore=null;
  try{if(id)chatStorage?.setItem(chatRunKey,id);else chatStorage?.removeItem(chatRunKey);}catch{}
}
function openChatRun(run){
  rememberChatRun(run.id);
  chatModel=run.steps[0].model;
  chat=restoreChat(run,runs);
  chatOptions.query='';
  task='chat';page='workbench';sampleInput=null;exampleUndo=null;
  show();scrollConversation();
}
function taskOptions(id){return Object.entries(state.tasks).map(([k,t])=>`<option value="${k}" ${id===k?'selected':''}>${esc(t.label)}</option>`).join('');}
const studio=createStudio({api,getState:()=>state,outputHTML,onQueued:j=>{currentJob=j.id;void poll();},toast});
const roughCut=createRoughCut({api,escape:esc,modelOptions,preferred,readFile,poll,toast});
const facsimileBook=facsimileModule?.createFacsimileBook({api,getState:()=>state,modelOptions,preferred,poll});
const workshops=createWorkshops({api,getState:()=>state,outputHTML,onQueued:j=>{currentJob=j.id;void poll();},toast});
function heading(eyebrow,title,lead,actions=''){return `<div class="title-row"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="lead">${lead}</p></div><div class="actions">${actions}</div></div>`;}
async function refresh(render=true){
  const b=$('#refresh');b.disabled=true;
  try{state=await api('/api/state');if(state.demo){$('#demo-notice').hidden=false;$('#demo-notice').className='demo-strip';$('#demo-notice').textContent='ILLUSTRATIVE DEMO · SYNTHETIC MODELS, USAGE AND PERFORMANCE · NO LIVE DEVICE';}$('#connection').textContent=state.offline?'Device unavailable':'Tiiny connected';$('#dot').classList.toggle('online',!state.offline);
    const loaded=state.models.filter(m=>m.loaded);const total=loaded.reduce((a,m)=>a+(m.npu || 0),0);$('#resident').textContent=loaded.length?loaded.map(m=>m.name).join(', ')+' · '+total+'% NPU reserved':'No models loaded';$('#capacity').style.width=total+'%';
    $('#sync-time').textContent='Synced '+new Date(state.syncedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const message=state.offline?'Showing your last inventory. '+state.error:state.storeError?'Installed models refreshed; store refresh failed. '+state.storeError:'';$('#banner').hidden=!message;$('#banner').textContent=message;
    if(render)show();
  }catch(e){$('#connection').textContent='Connection needed';$('#banner').hidden=false;$('#banner').textContent=e.message;if(!state){page='connection';connectionPage();}}
  finally{b.disabled=false;}
}
function renderNavigation(){
  const inDevice=Object.hasOwn(deviceSections,page);
  document.querySelectorAll('#nav button').forEach(button=>{
    const selected=button.dataset.page===(inDevice?'device':page);
    button.classList.toggle('selected',selected);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  if(!inDevice)return;
  $('#breadcrumb').textContent=page==='device'?'Device':'Device / '+deviceSections[page];
  $('#view').insertAdjacentHTML('afterbegin',`<nav class="device-navigation" aria-label="Device sections">${Object.entries(deviceSections).map(([id,label])=>`<button type="button" data-device-section="${id}" ${page===id?'aria-current="page"':''} ${!state&&['device','models'].includes(id)?'disabled':''}>${esc(label)}</button>`).join('')}</nav>`);
  document.querySelectorAll('[data-device-section]').forEach(button=>button.onclick=()=>{page=button.dataset.deviceSection;show();});
}
function show(){
  if(!$('#chat-app-preview').hidden)closeAppPreview();
  if(page!=='meeting')meetingDesk?.leave();
  if(page!=='library')librarySelection='';
  stopDashboard();
  closeNavigation();
  document.body.classList.toggle('creating',page==='workbench');
  window.dispatchEvent(new Event('spindle:workspace'));
  if(page==='connection'){connectionPage();return;}
  if(page==='meeting'){
    $('#breadcrumb').textContent='Meeting Desk';
    renderNavigation();
    void openMeetingDesk();return;
  }
  if(page==='security'){
    securityPage();renderNavigation();return;
  }
  if(page==='library'){
    $('#breadcrumb').textContent='Library & runs';
    renderNavigation();
    libraryPage();return;
  }
  if(!state){page='connection';connectionPage();return;}$('#breadcrumb').textContent=({dashboard:'Dashboard',workbench:'Chat & create',workflows:'Workflows',library:'Library & runs',models:'Models',device:'Device'})[page];
  ({dashboard:dashboardPage,workbench:workbench,workflows:workflowPage,library:libraryPage,models:modelsPage,device:devicePage})[page]();
  renderNavigation();
}
async function openMeetingDesk(result){
  if(!meetingDesk){
    try{
      const {createMeetingDesk}=await import('./meeting-desk.mjs');
      meetingDesk??=createMeetingDesk({
        api,escape:esc,getRuns:()=>runs,modelOptions,preferred,copyButton,
        isLoaded:id=>state?.models.some(model=>model.id===id&&model.loaded),onModelLoaded:()=>refresh(false),
        onQueued:run=>{runs=[run,...runs.filter(item=>item.id!==run.id)];void poll();},
        onRunChanged:poll,
      });
    }catch{
      if(page==='meeting')$('#view').innerHTML='<p class="help">Restart the Spindle helper after active runs finish, then reload to open Meeting Desk.</p>';
      return;
    }
  }
  if(page==='meeting'){
    if(!$('#view .meeting-desk'))meetingDesk.mount($('#view'));
    else meetingDesk.update();
    if(result)meetingDesk.openRun(result.id,result.at);
  }
}
function dashboardPage(){mountDashboard($('#view'),{api,getState:()=>state,navigate:next=>{page=next;show();},toast});}
const traceNames={chat:'Tiiny inference',search:'Web search',forecast:'Weather forecast',page:'Source page',check:'Device API check'};
const traceProviders={'https://html.duckduckgo.com':'DuckDuckGo','https://api.search.brave.com':'Brave Search','https://forecast.weather.gov':'National Weather Service','https://feeds.bbci.co.uk':'BBC News','https://www.cbsnews.com':'CBS News'};
const traceCount=(n,singular,plural=singular+'s')=>n+' '+(n===1?singular:plural);
function traceOverview(events){
  const external=events.filter(event=>['search','forecast','page'].includes(event.kind));
  const device=events.filter(event=>['chat','check'].includes(event.kind));
  const plaintext=device.filter(event=>event.protocol==='http:');
  const responses=events.filter(event=>event.outcome==='headers');
  const inspected=responses.filter(event=>typeof event.setCookie==='boolean');
  const cookies=inspected.filter(event=>event.setCookie);
  const unexpected=events.filter(event=>event.unexpected);
  const data=events=>[...new Set(events.flatMap(event=>event.sent))];
  const providers=[...new Set(external.map(event=>traceProviders[event.origin]||event.origin))];
  const externalData=data(external),usesPrompt=externalData.includes('Current prompt as query');
  const cards=[
    ['External data',usesPrompt?'Prompt used for search':external.length?'Data shared with providers':events.length?'No external requests observed':'Awaiting a trace',
      external.length?providers.join(' · ')+'. '+externalData.join(', ')+'. '+(usesPrompt?'Use an explicit query or turn off web search to keep the prompt out of search.':'Requests are listed below.'):
        'Web search can send the current prompt as a query. Weather lookups can share location.',external.length?'external':'quiet'],
    ['Device encryption',plaintext.length?'Unencrypted HTTP':device.length?'HTTPS requested':'No device request observed',
      plaintext.length?data(plaintext).join(', ')+'. Someone with access to the network path could read this traffic.':
        device.length?'The captured device requests used HTTPS URLs.':'This check needs a captured request to your configured Tiiny.',plaintext.length?'warning':'quiet'],
    ['Upstream cookies',cookies.length?traceCount(cookies.length,'response offered','responses offered')+' a cookie':inspected.length?'None observed':'No headers inspected',
      inspected.length?traceCount(inspected.length,'response')+' checked for Set-Cookie. Spindle’s local session cookie is separate.':
        'The trace can check for cookies when response headers arrive.',cookies.length?'warning':'quiet'],
    ['Unexpected destinations',unexpected.length?traceCount(unexpected.length,'unexpected request'):events.length?'None observed':'Awaiting a trace',
      unexpected.length?'A request targeted an origin outside the expected route. Inspect its destination below.':
        'Checks the origins used by Spindle. Traffic initiated by the Tiiny is outside this view.',unexpected.length?'warning':'quiet'],
  ];
  return cards.map(([label,value,detail,tone])=>`<article class="trace-card trace-${tone}">
    <h3>${esc(label)}</h3><p class="trace-card-value">${esc(value)}</p><p>${esc(detail)}</p>
  </article>`).join('');
}
function traceTimeline(events,active){
  if(!events.length)return '<p class="trace-empty">'+(active?'Send a chat, then return here and refresh the trace.':'Start a trace before sending a chat to see its requests here.')+'</p>';
  return `<ol class="trace-list">${[...events].sort((a,b)=>a.at-b.at).map(event=>{
    const hasHeaders=event.outcome==='headers';
    const format=event.responseType==='SSE'?'Model stream':event.responseType==='HTML'&&event.kind==='search'?'Search results page':event.responseType;
    const apiHTML=event.responseType==='HTML'&&['chat','check'].includes(event.kind);
    const result=hasHeaders?`HTTP ${event.status} · ${format} · headers in ${event.headersMs} ms`
      :event.kind==='page'?'Public HTTPS request attempted'
      :event.outcome==='pending'?(active?'Waiting for response headers':'No response headers captured')
      :({aborted:'Request canceled',timeout:'Request timed out'})[event.outcome]||'Request failed before response headers';
    const external=['search','forecast','page'].includes(event.kind);
    const transport=event.protocol==='http:'?'Plaintext HTTP':'HTTPS';
    const tags=[
      event.unexpected?'Unexpected origin':'',
      apiHTML?'Web page returned by API':'',
      hasHeaders&&event.setCookie?'Set-Cookie offered':'',
    ].filter(Boolean);
    return `<li class="trace-hop">
      <span class="trace-hop-marker ${external?'external':''}" aria-hidden="true"></span>
      <div class="trace-hop-content">
        <div class="trace-hop-heading"><h3>${esc(traceNames[event.kind]||'Request')}</h3>
          <span class="pill ${event.protocol==='http:'?'warn':''}">${transport}</span></div>
        <p class="trace-destination"><span>${external?'External provider':'Device endpoint'}</span> ${esc(event.origin)}</p>
        <ul class="trace-data" aria-label="Request data">${event.sent.map(value=>`<li>${esc(value)}</li>`).join('')}</ul>
        <div class="trace-hop-result">${esc(result)}${tags.map(tag=>` <span class="pill warn">${esc(tag)}</span>`).join('')}</div>
      </div><div class="trace-hop-time"><time datetime="${new Date(event.at).toISOString()}">${esc(new Date(event.at).toLocaleTimeString())}</time>
        ${event.runId?'<br>Run '+esc(event.runId.slice(0,8)):''}</div>
    </li>`;
  }).join('')}</ol>`;
}
function securityPage(){
  const endpoint='/api/security/chat-trace';
  $('#view').innerHTML=`<div class="security-workspace">
    <header class="trace-header"><div><h1>Security &amp; Privacy</h1>
      <p class="lead">See where your chat data went and what each service returned.</p></div>
      <span class="pill trace-status" id="trace-status" role="status">Checking trace…</span></header>
    <div class="panel trace-toolbar"><div class="actions">
      <button class="button primary" type="button" id="trace-toggle" disabled>Start trace</button>
      <button class="button" type="button" id="trace-refresh">Refresh trace</button>
      <button class="button quiet" type="button" id="trace-clear" disabled>Clear</button>
      <a class="button quiet" id="trace-download" href="${endpoint}?export=1" download hidden>Download full trace (redacted)</a>
    </div><p>Captures up to 100 requests in memory and stops after five minutes.</p>
    <p class="error" id="trace-error" role="alert"></p></div>
    <section class="trace-cards" id="trace-overview" aria-label="Privacy findings"></section>
    <section class="panel trace-evidence" aria-labelledby="trace-evidence-title">
      <div class="panel-head"><div><h2 id="trace-evidence-title">Request timeline</h2><p id="trace-count" class="muted"></p></div>
        <label class="trace-filter" id="trace-filter" hidden><span>Show</span><select id="trace-scope"></select></label></div>
      <div id="trace-entries"></div>
    </section>
    <details class="trace-coverage"><summary>What this trace can see</summary>
      <p>Spindle captures metadata from chat, search, forecasts, and failed model API checks. The trace omits message text, query text, credential values, and response bodies. The JSON download also omits device addresses.</p>
      <p>A Set-Cookie header is an offer from an upstream server. This check does not determine whether a link contains tracking or whether the device connects to other services.</p>
      <p>Spindle still saves run history locally. Remembering a Tiiny connection stores its key in plaintext on this computer.</p>
    </details></div>`;
  const status=$('#trace-status'),toggle=$('#trace-toggle'),clear=$('#trace-clear'),refreshButton=$('#trace-refresh');
  const download=$('#trace-download'),error=$('#trace-error'),entries=$('#trace-entries');
  const overview=$('#trace-overview'),scope=$('#trace-scope'),filter=$('#trace-filter'),count=$('#trace-count');
  let trace=null;
  const time=at=>new Date(at).toLocaleTimeString();
  function render(){
    const all=trace.events,chosen=scope.value;
    const selected=chosen==='device-checks'?all.filter(e=>!e.runId):chosen?all.filter(e=>e.runId===chosen):all;
    count.textContent=traceCount(selected.length,'captured request')+(trace.dropped?' · '+traceCount(trace.dropped,'older request')+' dropped':'');
    overview.innerHTML=traceOverview(selected);
    entries.innerHTML=traceTimeline(selected,trace.active);
  }
  async function update(action){
    toggle.disabled=clear.disabled=refreshButton.disabled=true;
    error.textContent='';
    try{
      trace=await api(endpoint,action?{action}:undefined);
      const {active,endsAt,events}=trace;
      status.textContent=active?'Recording until '+time(endsAt):events.length?'Recording stopped':'Trace off';
      status.classList.toggle('live',active);
      toggle.textContent=active?'Stop trace':events.length?'Start new trace':'Start trace';
      download.hidden=!events.length;
      const chosen=scope.value;
      const runIds=[...new Set([...events].reverse().map(e=>e.runId).filter(Boolean))];
      const checks=events.some(e=>!e.runId);
      scope.replaceChildren(new Option('All captured requests',''),
        ...runIds.map(id=>new Option('Run '+id.slice(0,8),id)),
        ...(checks?[new Option('Device API checks','device-checks')]:[]));
      if(runIds.includes(chosen)||checks&&chosen==='device-checks')scope.value=chosen;
      filter.hidden=runIds.length+Number(checks)<2;
      render();
    }catch(e){error.textContent=e.message;status.textContent='Trace unavailable';}
    finally{refreshButton.disabled=false;toggle.disabled=!trace;clear.disabled=!trace?.startedAt;}
  }
  toggle.onclick=()=>void update(trace?.active?'stop':'start');
  clear.onclick=()=>void update('clear');
  refreshButton.onclick=()=>void update();
  scope.onchange=render;
  void update();
}
function fileField(label='Reference image',accept='image/*'){return `<label class="field"><span>${label}</span><input id="input-file" type="file" accept="${accept}"></label>`;}
function extraFields(){
  if(task==='image')return fileField('Reference image · optional')+'<p class="help">Reference-image support varies by model. Inspect runtime defaults before choosing settings.</p>';
  if(task==='chat')return `<div class="chat-controls"><label class="field"><span>Maximum response tokens</span><select id="response-limit">${[['ample','Ample · up to '+AMPLE_RESPONSE_TOKENS.toLocaleString()+' tokens'],['default','Runtime default / Advanced JSON'],['4096','4,096 tokens'],['8192','8,192 tokens'],['16384','16,384 tokens · more room for thinking'],['32768','32,768 tokens'],['custom','Custom limit…']].map(([value,label])=>`<option value="${value}" ${chatOptions.responseLimit===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field" id="custom-token-field" ${chatOptions.responseLimit==='custom'?'':'hidden'}><span>Custom maximum response tokens</span><input id="custom-tokens" ${chatOptions.responseLimit==='custom'?'':'disabled'} type="number" min="1" step="1" value="${esc(chatOptions.customTokens)}"></label><p class="help">Ample requests up to ${AMPLE_RESPONSE_TOKENS.toLocaleString()} output tokens, capped at half the reported context to leave room for input. With no reported context, Ample requests 32,768. Thinking can share this allowance. Runtime default / Advanced JSON leaves the choice to your device or your JSON settings. Other selections override JSON token limits. Device output and context limits still apply.</p><p class="help" id="response-context"></p><div class="field-row"><label class="field"><span>Thinking mode</span><select id="thinking-mode"></select></label><label class="field"><span>Reasoning effort</span><select id="reasoning-effort"></select></label></div><p class="help" id="thinking-note"></p><label class="checkline"><input id="stream-chat" type="checkbox" ${chatOptions.stream?'checked':''}> Show the response as it arrives</label><label class="checkline"><input id="web-search" type="checkbox" ${chatOptions.search?'checked':''}> Search the web when useful</label><div id="web-options" ${chatOptions.search?'':'hidden'}><p class="notice">WEB SEARCH LEAVES YOUR LOCAL SETUP. The selected provider receives your explicit query or a short query Tiiny creates from your current message. With text files attached, enter a separate query to use search. Conversation history, attachments, and your Tiiny key stay within your local setup. Queries and results are saved in your local run history.</p><label class="field"><span>Search provider</span><select id="search-provider"><option value="duckduckgo" ${chatOptions.provider==='duckduckgo'?'selected':''}>DuckDuckGo · no key · best effort</option><option value="brave" ${chatOptions.provider==='brave'?'selected':''}>Brave Search · API key required</option></select></label><label class="field"><span>Search query · optional, up to 500 characters</span><input id="web-query" maxlength="500" value="${esc(chatOptions.query)}" placeholder="Leave blank to let Tiiny decide when to search"></label><p class="help">Search supplies up to five results. For U.S. weather, Spindle can send a city and state or ZIP code to the National Weather Service to get a recent forecast. If search is unavailable or the query is too long, Tiiny can still reply. Spindle labels replies without web sources.</p><details><summary>Brave Search API key · session only</summary><label class="field"><span>Separate from your Tiiny API key</span><input id="search-key" type="password" autocomplete="off" placeholder="Paste a Brave Search API key"></label><div class="actions"><button class="button" type="button" id="save-search-key">Use key for this server session</button><button class="button quiet" type="button" id="clear-search-key">Forget search key</button></div><p class="help" id="search-key-status">The key stays in server memory until forgotten or the helper restarts. It is never saved in runs, workflows, or browser storage.</p></details></div></div>`+fileField('Attach an image · optional');
  if(task==='asr')return fileField('Recording · WAV, MP3, M4A, WebM, and more','audio/*')+'<p class="help">Converted locally for Tiiny. Use a clear recording under 40 MiB and up to 15 minutes.</p>';
  if(task==='video')return fileField('Starting image · optional')+'<label class="checkline"><input type="checkbox" id="video-preview" checked> Short preview · overrides duration and size on supported models</label>'+'<div class="field-row"><label class="field"><span>Duration · seconds, optional</span><input id="seconds" type="number" min="1" placeholder="Model default"></label><label class="field"><span>Size · optional</span><input id="size" placeholder="Model default"></label></div>';
  if(task==='speech')return `<label class="field"><span>Voice ID · optional, model-specific</span><input id="voice" placeholder="Use the model’s default voice"></label>
    <section id="voice-reference" hidden><h3>Voice reference</h3>
    <p class="help">Use your own voice, a recording you have permission to use, or the synthetic sample. The clip and transcript go to Tiiny. The generated audio and reference text are saved locally.</p>
    ${fileField('Reference recording · up to 30 seconds','audio/*')}
    <audio id="voice-sample-preview" controls preload="none" aria-label="Listen to the synthetic reference voice" src="/samples/${voiceReferenceSample.sample}" hidden></audio>
    <label class="field"><span>Exact words spoken in the reference</span><textarea id="ref-text" rows="2" maxlength="2000"></textarea></label></section>`;
  if(task==='music')return '<label class="field"><span>Lyrics · optional</span><textarea id="lyrics" placeholder="[verse]…"></textarea></label>';
  if(task==='ocr'||task==='mesh')return fileField(task==='mesh'?'Object image · transparent PNG recommended':'Document image');
  if(task==='rerank')return '<label class="field"><span>Candidate documents · one per line</span><textarea id="documents" placeholder="First candidate document\nSecond candidate document"></textarea></label>';
  if(task==='decision')return '<p class="help">The default question routes text to general, technical, or billing. Edit questions in advanced settings to define your own choices and scores.</p>';
  return '';
}
function workbench(){
  const isChat=task==='chat',fileOnly=['asr','ocr','mesh'].includes(task),label=state.tasks[task].label;
  let textAttachments=[],readingAttachments=false,pasteCount=0,renderAttachments;
  if(isChat&&chatRunId)currentJob=chatRunId;
  if(isChat)selectedModel=preferredChatModel();
  else if(!compatible(task,true).some(m=>m.id===selectedModel))selectedModel=preferred(task);
  const hasVault=isChat&&!state.demo&&vaultAttachment;
  const titles={chat:'What’s on your mind?',image:'Picture something new.',asr:'Make every word useful.',speech:'Give your words a voice.',music:'Find your next sound.',video:'Set your ideas in motion.',ocr:'A clearer view of your documents.',mesh:'Give an image a new dimension.',decision:'Find the right direction.',embed:'Find meaning in your text.',rerank:'Bring the best match forward.'};
  const action=isChat?'Send':({image:'Create image',asr:'Transcribe',speech:'Create speech',music:'Create music',video:'Create video',ocr:'Read document',mesh:'Create 3D object',decision:'Evaluate',embed:'Create embeddings',rerank:'Rank documents'})[task];
  $('#view').innerHTML=`<section class="creation-workspace${isChat?' chat-workspace':''}" aria-label="${esc(label)} workspace">
    <div class="workspace-toolbar"><label class="mode-picker"><span class="sr-only">What do you want to create?</span><select id="workspace-mode">${taskOptions(task)}</select></label><div class="actions"><button class="button quiet" data-guide="task" aria-label="Tips and examples for ${esc(label)}">? <span class="toolbar-label">Tips & examples</span></button>${isChat?'<button class="button quiet" type="button" data-open-prompt-dex>PromptDex</button><button class="button quiet" id="new-chat" type="button">＋ New chat</button>':''}</div></div>
    <div class="conversation" id="conversation"><div class="workspace-welcome" id="workspace-welcome"><span class="welcome-spark" aria-hidden="true">✳</span><h1>${titles[task]}</h1><p>${esc(descriptions[task])}</p><div class="starter-prompts">${guides[task].examples.slice(0,4).map((e,i)=>`<button type="button" class="example-chip" data-example="${i}">${esc(e.label)} <span aria-hidden="true">↗</span></button>`).join('')}</div></div>
    <div id="chat-history" class="chat-history" role="log" aria-label="Conversation"></div>
    <section class="workspace-result" id="workspace-result" aria-label="Result" hidden><div class="result-status"><span id="output-status" role="status">Ready</span></div><div class="output-area" id="output" aria-live="polite"></div></section></div>
    ${isChat?`<section id="chat-run-stats" class="chat-run-stats" aria-label="Chat run statistics" hidden>
      <span class="chat-run-clock"><span class="spinner" aria-hidden="true" hidden></span><span data-chat-time></span></span>
      <span class="chat-context"><span data-chat-context>Context —</span><progress aria-label="Context window used" max="100" hidden></progress><span data-chat-percent></span></span>
      <span data-chat-rate></span><span data-chat-cache></span>
    </section>`:''}
    <form id="task-form" class="creation-composer"><div id="action-error" role="alert"></div><div class="composer-surface">
    <div class="composer-top"><label class="composer-model"><span class="sr-only">Model</span><select id="model" aria-label="Model">${modelOptions(task,selectedModel)}</select><span class="composer-model-progress" aria-hidden="true" hidden></span></label>${['chat','image','video'].includes(task)?'<button class="button quiet" id="attach-image" type="button" aria-label="Attach an image">＋ <span>Image</span></button>':''}${hasVault?'<button class="button quiet" id="attach-vault" type="button" aria-haspopup="dialog"><span class="chat-wide-label">Attach from </span>Vault</button>':''}</div>
    ${isChat?'<input id="chat-text-files" type="file" multiple hidden><ul id="chat-text-attachments" aria-label="Attached text files" hidden></ul><div id="chat-attachment-status" class="sr-only" role="status"></div>':''}
    <div id="model-load-status" class="model-load-status" role="status"><span class="spinner" aria-hidden="true" hidden></span><span></span></div>
    ${hasVault?'<div id="vault-attached" hidden><span></span><button class="button quiet" type="button" aria-label="Remove Vault excerpt">×</button></div>':''}
    ${!fileOnly?`<div class="prompt-row"><label class="field prompt-field"><span class="sr-only">${task==='speech'?'Text to speak':task==='rerank'?'Search query':task==='decision'?'State to evaluate':'Prompt'}</span><textarea id="prompt" rows="${isChat?1:2}" placeholder="${esc(isChat?'Ask anything…':descriptions[task])}" ${isChat?'':'required'}></textarea></label><button class="button quiet copy-button" id="copy-draft" type="button" disabled>Copy prompt</button></div>`:'<details class="input-disclosure" open><summary>Choose the input file</summary>'+extraFields()+'</details>'}
    ${task==='rerank'?extraFields():''}<div id="sample-status" class="sample-status" role="status"></div><div id="example-undo"></div>
    <div class="chat-send-row"><button class="button primary" id="run-task" type="submit">${action} <span aria-hidden="true">↑</span></button>${isChat?'<button class="button quiet" id="send-tiiny-only" type="submit" aria-label="Send to Tiiny only"><span class="chat-wide-label">Send to </span>Tiiny only</button><span class="small muted" id="chat-quick-status"></span>':'<span class="small muted">Model defaults · saved locally</span>'}</div></div>
    ${isChat?'<p id="chat-search-notice" class="chat-search-notice" role="note"></p>':''}
    <details id="${isChat?'chat':'creation'}-options" class="chat-options"><summary><span>${isChat?'Chat':esc(label)} options</span><span class="small muted">${isChat?'Search, thinking & more':'Fine-tune your result'}</span></summary><div class="chat-options-body"><div class="model-note" id="model-note"></div><button class="text-button model-help" type="button" data-guide="essentials">About this model →</button>
    ${isChat?`<label class="field"><span>Default chat model</span><select id="default-chat-model"><option value="">No default</option>${compatible('chat',true).map(m=>`<option value="${esc(m.id)}" ${m.id===state.defaultChatModel?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><p class="help" id="default-chat-status" role="status">Loads when Chat opens on an idle, empty device.</p>`:''}
    ${isChat||!fileOnly&&task!=='rerank'?extraFields():''}
    <details><summary>Advanced settings</summary><p class="help">Optional. Leave {} for model defaults. Add settings only when the selected model supports them.</p><textarea id="params" aria-label="Advanced JSON parameters">${task==='decision'?JSON.stringify({questions:{route:{type:'choice',instructions:'Which team should handle this?',criteria:{general:null,technical:null,billing:null}}}},null,2):'{}'}</textarea></details>
    ${isChat?'<p id="chat-device-notice" class="help privacy-inline"></p>':''}<p class="help privacy-inline">${isChat?'Model switching can affect other clients.':'Runs save prompts and outputs locally. Model switching can affect other clients; use an idle device.'}</p><label class="checkline"><input id="auto-model" type="checkbox" checked> ${isChat?'Switch models if needed and keep the chat model loaded.':'Switch models if needed, then restore my loaded models.'}</label><div class="actions"><button class="button" id="add-workflow" type="button">＋ Add to workflow</button><button class="button quiet" id="check-model" type="button">Test capability</button>${['image','video','music','mesh'].includes(task)?'<button class="button quiet" id="runtime" type="button">Runtime info</button>':''}</div>
    </div></details></form>${hasVault?vaultAttachment.vaultDialogHTML:''}</section>`;
  const vault=hasVault?vaultAttachment.bindVaultAttachment({api,dialog:$('#vault-dialog'),open:$('#attach-vault'),attached:$('#vault-attached'),onChange:chatOptionsStatus}):null;
  $('#breadcrumb').textContent='Chat & create';
  bind('#workspace-mode','change',e=>{task=e.target.value;sampleInput=null;exampleUndo=null;selectedModel=preferred(task);currentJob=null;workbench();});
  bind('#prompt','input',resizePrompt);
  bind('#copy-draft','click',()=>copyText($('#prompt').value,'prompt'));
  bind('#attach-image','click',()=>$('#input-file').click());
  if(isChat){
    const form=$('#task-form'),prompt=$('#prompt'),picker=$('#chat-text-files');
    const list=$('#chat-text-attachments'),status=$('#chat-attachment-status');
    const attachButton=document.createElement('button');
    attachButton.className='button quiet';
    attachButton.type='button';
    attachButton.id='attach-text';
    attachButton.textContent='＋ Text files';
    attachButton.title='Attach UTF-8 text files such as TXT, Markdown, CSV, or source code';
    $('#attach-image').before(attachButton);
    attachButton.onclick=()=>picker.click();
    renderAttachments=message=>{
      list.hidden=!textAttachments.length;
      list.innerHTML=textAttachments.map((file,i)=>`<li><span>${esc(file.name)}</span><button type="button" class="text-button" data-remove-text="${i}" aria-label="Remove ${esc(file.name)}">×</button></li>`).join('');
      status.textContent=message;
      chatOptionsStatus();
    };
    list.onclick=e=>{
      const button=e.target.closest('[data-remove-text]');
      if(!button)return;
      const [removed]=textAttachments.splice(Number(button.dataset.removeText),1);
      renderAttachments(removed.name+' removed.');
      attachButton.focus();
    };
    picker.onchange=async()=>{
      const files=[...picker.files];
      picker.value='';
      if(!files.length||readingAttachments)return;
      readingAttachments=true;
      attachButton.disabled=true;
      try{
        if(textAttachments.length+files.length>maxTextFiles)throw Error('Attach up to '+maxTextFiles+' text files.');
        if(files.reduce((sum,file)=>sum+file.size,0)>maxTextBytes)throw Error('Text attachments can total up to 256 KiB.');
        const added=await readTextAttachments(files);
        if(!form.isConnected)return;
        validateTextAttachments([...textAttachments,...added]);
        textAttachments.push(...added);
        $('#action-error').textContent='';
        renderAttachments(added.length===1?added[0].name+' attached.':added.length+' text files attached.');
      }catch(error){if(form.isConnected)fail(error);}
      finally{readingAttachments=false;attachButton.disabled=false;}
    };
    prompt.onpaste=e=>{
      const pasted=e.clipboardData?.getData('text/plain') || '';
      if(pasted.length<=pasteThreshold)return;
      e.preventDefault();
      const name=pasteCount?'Pasted text '+(pasteCount+1)+'.txt':'Pasted text.txt';
      const file={name,text:pasted};
      try{
        validateTextAttachments([...textAttachments,file]);
        textAttachments.push(file);
        pasteCount++;
        $('#action-error').textContent='';
        renderAttachments(name+' attached.');
      }catch(error){fail(error);}
    };
  }
  renderSampleStatus();
  bind('#model','change',e=>{selectedModel=e.target.value;if(task==='chat'){chatModel=selectedModel;chat=[];vault?.clear();rememberChatRun(null);currentJob=null;renderChatStats(null);$('#workspace-result').hidden=true;$('#output').innerHTML='';disableSend($('#task-form'),false);}renderChat();modelNote();renderModelLoad();});modelNote();renderChat();renderModelLoad();
  bind('#input-file','change',()=>{sampleInput=null;renderSampleStatus();});
  if(task==='chat')bindChatControls();
  bind('#new-chat','click',()=>{chat=[];chatOptions.query='';rememberChatRun(null);currentJob=null;workbench();});
  bind('#task-form','submit',async e=>{
    e.preventDefault();const form=e.currentTarget,button=form.querySelector('#run-task');if(button.disabled)return;
    const tiinyOnly=e.submitter?.id==='send-tiiny-only';
    const vaultReference=vault?.reference;
    const prompt=form.querySelector('#prompt'),input=prompt?.value || '',attachments=[...textAttachments];
    const conversation=chat,previousChatRunId=chatRunId;
    const messages=isChat?chat.map(({role,content,attachments})=>({role,content:chatAttachmentText(content,attachments)})):[],switchModels=form.querySelector('#auto-model').checked;
    disableSend(form,true);
    try{
      if(readingAttachments)throw Error('Wait for the text files to finish attaching.');
      const s=await getStep(true,tiinyOnly),chatStep=s.task==='chat';
      if(chatStep&&!input.trim()&&!attachments.length)throw Error('Enter a prompt or attach a text file.');
      const j=await api('/api/run',{name:state.tasks[s.task].label,input:chatStep?'':input,steps:[{...s,...(chatStep?{prompt:input,promptMode:'literal',messages,...(attachments.length?{attachments}:{})}:{prompt:'{{input}}'})}],switchModels,keepChatModel:chatStep,...(chatStep&&previousChatRunId?{previousChatRunId}:{}),...(tiinyOnly?{tiinyOnly:true}:{}),...(vaultReference?{vaultReference}:{})});
      if(chatStep&&conversation===chat){
        rememberChatRun(j.id);chatModel=s.model;
        chat.push({role:'user',content:input,attachments,vaultSource:vaultReference?.name});
      }
      if(form!==$('#task-form')){toast('Your run is queued. Follow it in Library & runs.');return;}
      currentJob=j.id;$('#action-error').innerHTML='';$('#workspace-result').hidden=false;$('#workspace-welcome').hidden=true;$('#output-status').textContent='Queued';$('#output').innerHTML='<div class="working-message"><span class="spinner"></span><p>Waiting for your Tiiny…</p></div>';
      if(chatStep){
        if(vaultReference&&vault?.reference===vaultReference)vault.clear();
        if(prompt.value===input)prompt.value='';
        textAttachments=textAttachments.filter(file=>!attachments.includes(file));
        renderAttachments('');
        resizePrompt();
      }
      if(fileOnly){const inputBox=$('.input-disclosure');if(inputBox){inputBox.open=false;inputBox.querySelector('summary').textContent='Input · '+($('#input-file')?.files[0]?.name || sampleInput?.name || 'Selected file');}}renderChat();renderCurrent(runs.find(run=>run.id===j.id)??j);scrollConversation();poll();
    }catch(e){disableSend(form,false);if(form===$('#task-form'))fail(e);else toast(e.message);}
  });
  const checkModel=async speechMode=>{
    const form=$('#task-form');
    try{
      if(!selectedModel)throw Error('Choose a downloaded model.');
      const run=await api('/api/check',{task,model:selectedModel,switchModels:$('#auto-model').checked,speechMode});
      if(form===$('#task-form')){currentJob=run.id;renderCurrent(runs.find(item=>item.id===run.id)??run);}
      toast('A sample check is queued. Its result will be recorded in Device readiness.');void poll();
    }catch(error){if(form===$('#task-form'))fail(error);else toast(error.message);}
  };
  bind('#check-model','click',()=>checkModel());
  if(task==='speech'){
    const plainCheck=document.createElement('button');plainCheck.type='button';plainCheck.className='button quiet';plainCheck.textContent='Test plain speech';
    plainCheck.onclick=()=>checkModel('plain');
    $('#check-model').after(plainCheck);
  }
  bind('#add-workflow','click',async()=>{try{const s=await getStep(false),needsVoiceReference=s.task==='speech'&&!!s.file;workflow.steps.push({...s,file:undefined,fileFrom:needsVoiceReference||['asr','ocr','mesh'].includes(s.task)?'input':'none',prompt:$('#prompt')?.value || '{{input}}'});toast(needsVoiceReference?'Speech step added. Supply its reference recording as the workflow’s starting file.':textAttachments.length?'Chat step added. Text attachments are available when you send from Chat.':'Added a '+state.tasks[s.task].label.toLowerCase()+' step. Open Workflows to connect it.');}catch(e){fail(e);}});
  if(task==='video'){const preview=()=>{for(const id of ['seconds','size']){const e=$('#'+id);if(e)e.disabled=$('#video-preview').checked;}};bind('#video-preview','change',preview);preview();}
  bind('#runtime','click',async()=>{try{const j=await api('/api/runtime?task='+task+'&model='+encodeURIComponent(selectedModel));$('#workspace-result').hidden=false;$('#workspace-welcome').hidden=true;$('#output').innerHTML='<div class="output-meta">RUNTIME DEFAULTS · READ FROM DEVICE</div><pre>'+esc(JSON.stringify(j,null,2))+'</pre>';$('#output-status').textContent='Runtime info';}catch(e){fail(e);}});
  if(currentJob){const j=runs.find(r=>r.id===currentJob);if(j)renderCurrent(j);}
  if(isChat)void warmDefaultChat();
}
function disableSend(form,disabled){form?.querySelectorAll('button[type="submit"]').forEach(button=>{button.disabled=disabled;});}
async function warmDefaultChat(){
  const id=state.defaultChatModel;
  if(!id||selectedModel!==id||warmingChatModel||state.offline||state.models.some(m=>m.loaded)||!compatible('chat',true).some(m=>m.id===id)||runs.some(r=>['queued','running'].includes(r.status)))return;
  warmingChatModel=id;
  warmChatError=null;
  renderModelLoad();
  const status=$('#default-chat-status');
  if(status)status.textContent='Loading the default chat model…';
  try{
    const result=await api('/api/chat/default/load',{});
    if(result.status==='ready')await refresh(false);
    if(status)status.textContent=result.status==='ready'?'Default chat model loaded.':'Loads when Chat opens on an idle, empty device.';
  }catch(e){warmChatError={id,message:e.message};if(status)status.textContent='Default model could not preload. '+e.message;}
  finally{warmingChatModel='';if(page==='workbench'&&task==='chat')renderModelLoad();}
}
function renderModelLoad(){
  const picker=$('#model');
  if(!picker)return;
  const load=runs.find(run=>run.status==='running'&&run.modelLoad)?.modelLoad || (warmingChatModel?{id:warmingChatModel,ready:false}:null);
  const models=new Map(compatible(task,true).map(model=>[model.id,model]));
  for(const option of picker.options){
    const model=models.get(option.value);
    if(!model)continue;
    const status=load?.id===model.id?(load.ready?'loaded':'loading…'):undefined;
    const label=modelLabel(model,status);
    if(option.textContent!==label)option.textContent=label;
  }
  const model=state.models.find(model=>model.id===load?.id);
  $('.composer-model-progress').hidden=!load||load.ready||picker.value!==load.id;
  const status=$('#model-load-status');
  const name=model?.name||load?.id;
  const error=task==='chat'&&warmChatError?.id===picker.value?warmChatError:null;
  const announcement=load?(load.ready?name+' loaded.':'Loading '+name+'…'):error?'Default model could not load. See Chat options.':'';
  status.querySelector('.spinner').hidden=!load||load.ready;
  if(status.lastElementChild.textContent!==announcement)status.lastElementChild.textContent=announcement;
  status.title=error?.message||'';
}
function modelNote(){const m=state.models.find(m=>m.id===selectedModel);$('#model-note').innerHTML=m?`${m.loaded?'<span class="pill live">Loaded</span>':'<span class="pill warn">Will load for this run</span>'} &nbsp; ${esc(m.npu??'?')}% NPU · ${fmtSize(m.size)}${m.thinking?.supported?' · reasoning supported':''}`:'No compatible downloaded model. Explore Device → Models to download one.';if(task==='chat'){thinkingControls();chatOptionsStatus();}if(task==='speech'){$('#voice-reference').hidden=!voiceCloneModel(m);renderSampleStatus();}}
function thinkingControls(){
  const mode=$('#thinking-mode'),effort=$('#reasoning-effort');if(!mode||!effort)return;
  const m=state.models.find(m=>m.id===selectedModel),toggle=m?.thinking?.toggleable,levels=m?.reasoningLevels || [];
  $('#response-context').textContent=m?.context?'Reported context window: '+m.context+' tokens, shared by conversation, input, and output. This is not a measurement of remaining space.':'This model has not reported a context window. Spindle cannot calculate its remaining output space.';
  if(!toggle)chatOptions.thinking='auto';if(!levels.includes(chatOptions.effort))chatOptions.effort='auto';
  mode.innerHTML='<option value="auto">Model default</option>'+(toggle?'<option value="on">Thinking on</option><option value="off">Thinking off</option>':'');mode.value=chatOptions.thinking;mode.disabled=!toggle;
  effort.innerHTML='<option value="auto">Model default</option>'+levels.map(level=>`<option value="${esc(level)}">${esc(level)}</option>`).join('');effort.value=chatOptions.effort;effort.disabled=!levels.length;
  $('#thinking-note').textContent=(toggle?'Choose how this model reasons. ':m?.thinking?.supported?'This model reports reasoning with no switch. ':'No thinking toggle reported by this model. ')+'Any reasoning returned by the runtime appears in a collapsible Thinking panel. Some models return only an answer.';
}
function chatOptionsStatus(){
  const model=state.models.find(m=>m.id===selectedModel),budget=chatOptions.responseLimit==='ample'?ampleResponseTokens(model).toLocaleString():chatOptions.responseLimit==='default'?'runtime default':Number(chatOptions.responseLimit==='custom'?chatOptions.customTokens:chatOptions.responseLimit).toLocaleString();
  const attachedText=$('#chat-text-attachments')?.hidden===false;
  const explicitQuery=!!chatOptions.query.trim();
  const paused=chatOptions.search&&attachedText&&!explicitQuery;
  if($('#chat-quick-status'))$('#chat-quick-status').textContent=(paused?'Web search paused':chatOptions.search?'Web search on':'Web search off')+' · '+budget+(chatOptions.responseLimit==='default'?'':' output tokens');
  const searchNotice=$('#chat-search-notice'),deviceNotice=$('#chat-device-notice'),localSend=$('#send-tiiny-only');
  if(!searchNotice)return;
  localSend.hidden=!chatOptions.search;
  const provider=chatOptions.provider==='brave'?'Brave Search':'DuckDuckGo';
  searchNotice.classList.toggle('search-enabled',chatOptions.search);
  searchNotice.hidden=!chatOptions.search;
  searchNotice.textContent=paused?'Search is paused for this message. Enter a separate search query in Chat options to use the web with text attachments.':chatOptions.search?`Send ${explicitQuery?'shares your search query':'may share a query Tiiny generates from this message'} with ${provider} over HTTPS. Weather lookups may share a location with the National Weather Service.${explicitQuery?'':' Headline lookups may fetch public publisher feeds.'}`:'';
  const deviceData=['this prompt',...(chat.length?['earlier turns']:[]),...(attachedText?['the attached text']:[]),...($('#input-file')?.files.length||sampleInput?.task==='chat'?['the attached image']:[]),...($('#vault-attached')?.hidden===false?['the Vault excerpt']:[]),'the Tiiny API key'];
  const transport=connectionInfo?.endpoint?.startsWith('http:')?' over unencrypted HTTP':connectionInfo?.endpoint?.startsWith('https:')?' over HTTPS':'';
  deviceNotice.textContent=`Tiiny gets ${deviceData.slice(0,-1).join(', ')} and ${deviceData.at(-1)}${transport}. ${chatOptions.search&&!paused?'Search results go to Tiiny when used. ':''}Runs save locally.`;
}
function rememberChatOptions(){if(!saveChatOptions(chatStorage,chatOptions))toast('Browser storage is unavailable. These settings apply until this page closes.');chatOptionsStatus();}
function bindChatControls(){
  bind('#default-chat-model','change',async e=>{
    const select=e.currentTarget,model=select.value,status=$('#default-chat-status');
    select.disabled=true;
    try{
      await api('/api/chat/default',{model});state.defaultChatModel=model;
      if(page==='workbench'&&task==='chat'&&select===$('#default-chat-model')&&!chat.length&&!currentJob){
        selectedModel=preferredChatModel();$('#model').value=selectedModel;modelNote();renderModelLoad();
      }
      status.textContent=model?'Default model saved.':'Default model cleared.';
      if(model&&page==='workbench'&&task==='chat')void warmDefaultChat();
    }catch(e){select.value=state.defaultChatModel||'';status.textContent=e.message;}
    finally{select.disabled=false;}
  });
  bind('#response-limit','change',e=>{chatOptions.responseLimit=e.target.value;$('#custom-token-field').hidden=e.target.value!=='custom';$('#custom-tokens').disabled=e.target.value!=='custom';rememberChatOptions();});
  bind('#custom-tokens','input',e=>{chatOptions.customTokens=e.target.value;rememberChatOptions();});
  bind('#thinking-mode','change',e=>chatOptions.thinking=e.target.value);bind('#reasoning-effort','change',e=>chatOptions.effort=e.target.value);
  bind('#stream-chat','change',e=>{chatOptions.stream=e.target.checked;rememberChatOptions();});
  bind('#web-search','change',e=>{chatOptions.search=e.target.checked;$('#web-options').hidden=!e.target.checked;rememberChatOptions();});
  bind('#search-provider','change',e=>{chatOptions.provider=e.target.value;rememberChatOptions();});bind('#web-query','input',e=>{chatOptions.query=e.target.value;chatOptionsStatus();});
  const keyStatus=j=>{const target=$('#search-key-status');if(target)target.textContent=j.braveKeyPresent?'Brave key is available in server memory. Restarting the helper clears it.':'No Brave key configured. DuckDuckGo needs no key.';};
  chatOptionsStatus();
  api('/api/search/settings').then(keyStatus).catch(fail);
  bind('#save-search-key','click',async()=>{try{if(!$('#search-key').value.trim())throw new Error('Enter a Brave Search API key first.');const result=await api('/api/search/settings',{key:$('#search-key').value});$('#search-key').value='';keyStatus(result);toast('Search key set for this server session.');}catch(e){fail(e);}});
  bind('#clear-search-key','click',async()=>{try{keyStatus(await api('/api/search/settings',{key:''}));$('#search-key').value='';}catch(e){fail(e);}});
}
function resizePrompt(){
  const prompt=$('#prompt');
  if(!prompt)return;
  prompt.style.height=task==='chat'?'0px':'auto';
  prompt.style.height=Math.min(prompt.scrollHeight,108)+'px';
  $('#copy-draft').disabled=!prompt.value.trim();
}
function scrollConversation(){const el=$('#conversation');if(el)el.scrollTop=el.scrollHeight;}
function textAttachmentDetails(files=[]){
  return files.map(({name,text})=>`<details class="chat-text-detail"><summary>${esc(name)}</summary><pre><code>${esc(text).replaceAll('\r','&#13;')}</code></pre><button class="button quiet" type="button" data-download-text="${esc(name)}">Download text</button></details>`).join('');
}
function renderChat(){
  const history=$('#chat-history');
  if(!history)return;
  history.innerHTML=task==='chat'?chat.map(message=>{
    const user=message.role==='user';
    return `<article class="chat-message ${user?'from-user':'from-assistant'}"><strong>${user?'You':'Spindle'}</strong>${message.vaultSource?'<div class="small muted">Vault · '+esc(message.vaultSource)+'</div>':''}
      ${user?(message.content?'<div class="output-text">'+esc(typeof message.content==='string'?message.content:'[Image message]')+'</div>':'')+textAttachmentDetails(message.attachments):chatDetails(message,'before')+chatMarkdown(message.content)+chatDetails(message,'sources')}
      ${copyButton(message.content,user?'prompt':'reply')}${user?'':appPreviewButton({task:'chat',text:message.content,finishReason:message.finishReason},message.runId,message.step)}</article>`;
  }).join(''):'';
  if(task==='chat')$('#workspace-welcome').hidden=chat.length>0||!$('#workspace-result').hidden;
}
let statsJob=null;
function renderChatClock(){
  const clock=$('[data-chat-time]');
  if(!clock||statsJob?.id!==currentJob||!statsJob)return;
  const {status,startedAt,finishedAt}=statsJob;
  const start=Date.parse(startedAt),end=Date.parse(finishedAt);
  const seconds=Number.isFinite(start)?Math.max(0,Math.floor(((Number.isFinite(end)?end:Date.now())-start)/1000)):null;
  const time=seconds==null?'':Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
  const label=({queued:'Queued',running:'Running',completed:'Completed',failed:'Failed',cancelled:'Stopped'})[status]||status;
  const text=[label,time].filter(Boolean).join(' ');
  if(clock.textContent!==text)clock.textContent=text;
}
setInterval(renderChatClock,500);
function renderChatStats(job){
  const panel=$('#chat-run-stats');
  if(!panel)return;
  statsJob=job?.steps?.length===1&&job.steps[0].task==='chat'?job:null;
  panel.hidden=!statsJob;
  if(!statsJob)return;
  const {tokens,percent,ratio,estimated,context,used,rate,cache}=chatRunStats(job,state.models.find(m=>m.id===job.steps[0].model));
  const meter=panel.querySelector('progress');
  meter.hidden=ratio==null;
  if(!meter.hidden){
    meter.value=Math.min(100,ratio*100);
    meter.setAttribute('aria-valuetext',`${estimated?'Estimated ':''}${used.toLocaleString()} of ${context.toLocaleString()} tokens, ${percent}`);
  }
  panel.querySelector('[data-chat-context]').textContent='Context '+tokens;
  panel.querySelector('[data-chat-context]').title=estimated?'Estimated from request and response text. Tiiny can report exact usage later.':'Context use and capacity reported by Tiiny';
  panel.querySelector('[data-chat-percent]').textContent=ratio==null?'':percent;
  panel.querySelector('[data-chat-rate]').textContent='Speed '+rate;
  const cacheStat=panel.querySelector('[data-chat-cache]');
  cacheStat.textContent='Cache hit '+cache;
  cacheStat.title=cache!=='—'?'Prompt tokens Tiiny reports reusing from its cache.'
    :['queued','running'].includes(job.status)?'Waiting for cache usage from Tiiny. Some firmware only reports it at the end.'
    :'Tiiny did not report prompt-cache usage for this run.';
  panel.querySelector('.spinner').hidden=!['queued','running'].includes(job.status);
  renderChatClock();
}
async function readFile(input,forTask=task){const f=input?.files?.[0];if(!f)return null;if(f.size>40*1024*1024)throw new Error('Files must be under 40 MiB.');if(forTask==='asr')return transcriptionFile(f);return {name:f.name,data:await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);})};}
async function getStep(requireFile=true,tiinyOnly=false){
  const stepTask=task,model=selectedModel,useFile=stepTask!=='speech'||!$('#voice-reference').hidden;
  const fileInput=useFile?$('#input-file'):null,sample=useFile&&sampleInput?.task===stepTask?sampleInput.file:null;
  if(!model)throw new Error('Choose a downloaded model first.');let params;try{params=JSON.parse($('#params')?.value || '{}');}catch{throw new Error('Advanced settings must be valid JSON.');}
  if(!params||Array.isArray(params)||typeof params!=='object')throw new Error('Advanced settings need a JSON object.');
  if(stepTask==='speech'){
    if(sample||fileInput?.files.length){
      params.ref_text=$('#ref-text').value.trim();
      if(!params.ref_text)throw new Error('Enter the exact words spoken in the voice reference.');
    }else if($('#voice').value)params.voice=$('#voice').value;
  }
  if(stepTask==='music'&&$('#lyrics')?.value)params.lyrics=$('#lyrics').value;
  if(stepTask==='video'){if($('#video-preview')?.checked)params._spindlePreview=true;if($('#seconds')?.value)params.seconds=Number($('#seconds').value);if($('#size')?.value)params.size=$('#size').value;}
  if(stepTask==='chat'){
    params=withResponseLimit(params,chatOptions.responseLimit,chatOptions.customTokens,state.models.find(m=>m.id===model));
    params._spindleThinking=chatOptions.thinking;params._spindleEffort=chatOptions.effort;params._spindleStream=chatOptions.stream;
    params._spindleWebSearch=tiinyOnly?{enabled:false}:{enabled:chatOptions.search,provider:chatOptions.provider,query:chatOptions.query};
  }
  const documents=$('#documents')?.value.split('\n').filter(Boolean);
  const reference=stepTask==='speech'?fileInput?.files[0]:null;
  const file=sample || (reference?await transcriptionFile(reference,30):await readFile(fileInput,stepTask));
  if(requireFile&&['asr','ocr','mesh'].includes(stepTask)&&!file)throw new Error('Choose an input file.');
  return {task:stepTask,model,params,file,documents};
}
function structuredOutput(out){
  const j=out.json;
  if(out.task==='embed'&&j?.data?.length){const vectors=j.data,vector=vectors[0].embedding || [],values=vector.slice(0,72),min=Math.min(...values),max=Math.max(...values),points=values.map((v,i)=>`${i/(values.length-1)*360},${52-(v-min)/(max-min || 1)*45}`).join(' ');return `<div class="result-title">A new way to find meaning.</div><div class="result-metrics"><span><b>${vectors.length}</b> vector${vectors.length===1?'':'s'}</span><span><b>${vector.length}</b> dimensions</span></div><svg class="vector-spark" viewBox="0 0 360 60" role="img" aria-label="First ${values.length} embedding dimensions"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><p class="help">Preview of the first ${values.length} dimensions. Full vectors are available below.</p>`;}
  if(out.task==='decision'&&j?.answers){return Object.entries(j.answers).map(([key,a])=>`<div class="decision-result"><div class="result-title">${esc(key)} <span class="pill live">${esc(a.choice ?? a.score ?? a.probability ?? 'Evaluated')}</span></div>${Object.entries(a.probabilities || {}).map(([label,value])=>`<div class="probability"><span>${esc(label)}</span><meter min="0" max="1" value="${Number(value)}">${Math.round(value*100)}%</meter><span>${(value*100).toFixed(1)}%</span></div>`).join('')}</div>`).join('');}
  if(out.task==='rerank'&&j?.results){return `<div class="result-title">The most relevant, first.</div>${j.results.map((r,i)=>`<div class="ranked-result"><span class="rank-number">${i+1}</span><div><p>${esc(r.document?.text || r.text || out.documents?.[r.index] || 'Candidate '+(r.index+1))}</p><span class="small muted">Relevance ${Number(r.relevance_score ?? r.score ?? 0).toFixed(4)}</span></div></div>`).join('')}`;}
  return null;
}
function meshTextureAction(job,out,index){
  if(!out.canApplyTexture||!state||state.offline||state.demo||job.connectionId!==state.connectionId||
     !state.models.some(m=>m.id===out.model&&m.installed))return '';
  return `<button type="button" class="button" data-texture-run="${esc(job.id)}" data-texture-step="${index}">Apply texture →</button>`;
}
function libraryOutput(out,action=''){
  return outputHTML(out)+action+(out.assets||[]).map((a,i)=>`<button type="button" class="button quiet library-delete" data-delete-asset="${esc(a.url)}">Delete ${esc(a.mime.startsWith('image/')?'image':a.mime.startsWith('audio/')?'audio':a.mime.startsWith('video/')?'video':'artifact')}${out.assets.length>1?' '+(i+1):''}</button>`).join('');
}
function outputHTML(out,{partial=false}={}) {
  if(out.authorKind){const label=({plan:'Application design',code:'Complete application source',continue:'Continued native application source',part:'Application source section',audit:'Application code review',repair:'Repaired application source',review:'Visual review'})[out.authorKind] || 'Application author';return '<div class="output-block author-output"><div class="output-meta">TIINY · '+label+'</div><p class="help">'+(out.text?.length || 0).toLocaleString()+' characters returned by the local model. Source is saved with the run.</p><details><summary>Inspect the Tiiny response</summary><pre>'+esc(out.text || out.reasoning || '')+'</pre>'+copyButton(out.text,'result')+'</details></div>';}
  const structured=structuredOutput(out);
  const museum=out.assets?.find(a=>a.mime==='text/html');
  if(museum)return `<div class="output-block"><div class="output-meta">YOUR OFFLINE MUSEUM</div><p>${esc(out.text)}</p>${out.appAuthor==='tiiny'?'<p class="help">Application code authored by your Tiiny. Data capture, testing and packaging by Spindle.</p>':''}<div class="actions section-gap"><a class="button primary" href="${esc(museum.previewUrl)}" target="_blank" rel="noopener noreferrer">Enter the 3D museum ↗</a><a class="button" href="${esc(museum.url)}" download="tiinyverse-museum.html">Download self-contained HTML</a>${(out.assets || []).filter(a=>a!==museum).map(a=>'<a class="button" href="'+esc(a.url)+'" download>'+esc(a.label || 'Download source')+' ↗</a>').join('')}</div><p class="help">WASD / arrows to walk, drag to look, E to inspect. Includes a readable collection view.</p></div>`;
  const json=structured?JSON.stringify(out.json,null,2):null;
  const liveChat=out.task==='chat'&&partial;
  const body=liveChat?'<div data-chat-live-details></div><div class="output-text chat-markdown" data-chat-live></div><div data-chat-live-sources></div>':out.text?(out.task==='chat'?chatMarkdown(out.text):`<div class="output-text">${esc(out.text)}</div>`):'';
  const copy=out.assets?.length||liveChat?'':copyButton(json??out.text,structured?'JSON':out.task==='chat'?'reply':'result');
  return `<div class="output-block"><div class="output-meta">${esc(state?.tasks[out.task]?.label || out.task || '')} ${out.model?' / '+esc(out.model):''}</div>${(out.assets || []).map(a=>a.mime.startsWith('image/')?`<div class="image-result"><img src="${esc(a.url)}" alt="Generated image"></div><a class="download-link" href="${esc(a.url)}" download>Save image ↗</a>`:a.mime.startsWith('audio/')?`<div class="audio-result"><span class="audio-glyph">≋</span><div><span class="small muted">YOUR SOUND, MADE LOCAL</span><audio controls src="${esc(a.url)}"></audio></div></div><a class="download-link" href="${esc(a.url)}" download>Save audio ↗</a>`:a.mime.startsWith('video/')?`<video controls src="${esc(a.url)}"></video><a class="download-link" href="${esc(a.url)}" download>Save video ↗</a><button class="button quiet" type="button" data-soundtrack="${esc(a.url)}">Repair soundtrack →</button>`:`${meshPreviewHTML(a)}<div class="mesh-result"><span>⬡</span><p>${esc(a.label || '3D artifact')}</p><a class="button primary" href="${esc(a.url)}" download="${esc(a.label || 'artifact')}">Download artifact ↗</a></div>`).join('')}${out.task==='chat'?chatDetails(out,'before'):''}${structured || body}${out.task==='chat'?chatDetails(out,'sources'):''}${copy}${structured?`<details class="section-gap"><summary>Full structured response</summary><pre>${esc(json)}</pre></details>`:''}</div>`;
}
function renderCurrent(j){
  if(!$('#output'))return;disableSend($('#task-form'),['queued','running'].includes(j.status));$('#output-status').textContent=(j.status==='running'&&j.phase?j.phase:j.status)+(j.progress!=null?' · '+j.progress+'%':'');
  renderChatStats(j);
  let completedAnswer=false;const conversation=$('#conversation'),follow=conversation&&conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<100;
  $('#workspace-welcome').hidden=true;$('#workspace-result').hidden=task==='chat'&&j.id===chatRunId&&j.status==='completed';
  const output=$('#output');
  const livePartial=j.partial?.task==='chat';
  const partial=livePartial?outputHTML({task:'chat',model:j.partial.model},{partial:true}):j.partial?outputHTML(j.partial,{partial:true}):'';
  const shell=j.outputs.map((out,i)=>outputHTML(out)+meshTextureAction(j,out,i)).join('')+partial+(j.error?recoveryHTML(j.error,j.audioFailure):'')+(['queued','running'].includes(j.status)?'<div class="working-message"><span class="spinner"></span><p>Your Tiiny is working…</p><button class="button danger" id="stop-current">Stop run</button></div>':'');
  const previous=liveOutputShells.get(output);
  const hasLiveReply=previous?.id===j.id&&!!output.querySelector('[data-chat-live]')?.childElementCount;
  if(previous?.id!==j.id||previous.html!==shell){
    const thinkingOpen=previous?.id===j.id?[...output.querySelectorAll('[data-chat-panel]')].map(el=>el.open):[];
    output.innerHTML=shell;
    liveOutputShells.set(output,{id:j.id,html:shell,thinkingOpen});
    output.querySelectorAll('[data-chat-panel]').forEach((el,i)=>el.open=thinkingOpen[i]||false);
    bind('#stop-current','click',()=>api('/api/cancel/'+j.id,{}).then(()=>toast('Stop requested.')).catch(fail));
  }
  const live=output.querySelector('[data-chat-live]');
  if(live){
    updateLiveChat(live,j.partial.text);
    const details=output.querySelector('[data-chat-live-details]');
    const markup=chatDetails(j.partial,'before');
    const current=liveOutputShells.get(output);
    if(current.details!==markup){
      const open=details.querySelector('[data-reasoning]')?.open??current.thinkingOpen[0]??false;
      details.innerHTML=markup;
      const reasoning=details.querySelector('[data-reasoning]');
      if(reasoning)reasoning.open=open;
      current.details=markup;
    }
    const sources=output.querySelector('[data-chat-live-sources]');
    const sourceMarkup=chatDetails(j.partial,'sources');
    if(current.sources!==sourceMarkup){
      const open=sources.querySelector('details')?.open;
      sources.innerHTML=sourceMarkup;
      const sourcePanel=sources.querySelector('details');
      if(sourcePanel)sourcePanel.open=!!open;
      current.sources=sourceMarkup;
    }
  }
  if(j.status==='completed'){
    const out=j.outputs.at(-1);
    if(task==='chat'&&j.id===chatRunId&&!chat.some(message=>message.runId===j.id)){
      const reply=chatReply(j);
      if(reply){chat.push(reply);renderChat();chatOptionsStatus();completedAnswer=true;}
    }
    if(out?.assets?.some(a=>a.mime.startsWith('image/'))&&!output.querySelector('[data-animate-current]')){const btn=document.createElement('button');btn.className='button';btn.dataset.animateCurrent='';btn.textContent='Animate this image →';btn.onclick=()=>makeImageVideo(j);output.append(btn);}
  }
  if(follow){if(completedAnswer&&!hasLiveReply)$('#chat-history').lastElementChild?.scrollIntoView({block:'start'});else scrollConversation();}
}
const liveOutputShells=new WeakMap();
function makeImageVideo(j){
  const image=j.outputs.filter(o=>o.task==='image').flatMap(o=>o.assets || []).find(a=>a.mime.startsWith('image/'));
  if(!image)return;studio.adopt(image);page='workflows';show();$('#creative-workflow').open=true;toast('Your saved image is selected. Refine it or make a video.');
}
function poll(){
  return pollPromise??=pollRuns().finally(()=>{pollPromise=null;});
}
async function pollRuns(){try{
  const options={cache:'no-store',headers:runsTag?{'If-None-Match':runsTag}:{}};
  let response=await fetch('/api/runs',options);
  if(response.status===403){await fetch('/api/session');response=await fetch('/api/runs',options);}
  if(response.status===304)return;
  const next=await response.json();
  if(!response.ok)throw Error(next.error||'Run history could not be loaded.');
  const tag=response.headers.get('ETag');
  const changed=tag?tag!==runsTag:JSON.stringify(next)!==JSON.stringify(runs);
  runsTag=tag||'';const ended=runs.some(r=>r.status==='running')&&!next.some(r=>r.status==='running');runs=next;const busy=runs.find(r=>r.status==='running'||r.status==='queued');if($('#activity-status'))$('#activity-status').textContent=busy?busy.name+' · '+(busy.phase || busy.status):'';if(busy?.phase)$('#resident').textContent=busy.phase;window.dispatchEvent(new CustomEvent('spindle:activity',{detail:!!busy}));window.dispatchEvent(new CustomEvent('spindle:run',{detail:busy?{name:busy.name,status:busy.status,phase:busy.phase,progress:busy.progress}:null}));
  if(pendingChatRestore&&state&&page==='workbench'&&task==='chat'&&!$('#prompt')?.value){
    const run=runs.find(item=>item.id===pendingChatRestore);
    if(isChatRun(run))openChatRun(run);else rememberChatRun(null);
  }
  if(changed&&page==='workbench')renderModelLoad();
  if(changed){promptDex?.update();if(page==='meeting')meetingDesk?.update();if(page==='dashboard')refreshDashboard();if(page==='workbench'&&currentJob){const j=runs.find(r=>r.id===currentJob);if(j)renderCurrent(j);}if(page==='library')renderRuns();if(page==='workflows')renderWorkflowStatus();}if(ended){await refresh(false);if(page==='workbench')renderModelLoad();}}catch(e){console.warn(e.message);}}
function modelsPage(){
  const ms=state.models,installed=ms.filter(m=>m.installed),store=ms.filter(m=>m.available);
  $('#view').innerHTML=heading('YOUR MODEL COLLECTION','Many minds. One shelf.','A live catalog from your device, with availability, inputs, outputs, and NPU requirements.',`<a class="button" href="/catalog.csv" download>Export CSV ↗</a><a class="button quiet" href="/catalog.json" download>JSON</a>`)+
  `<div class="stats"><div class="stat"><strong>${store.length}</strong><span>in the store</span></div><div class="stat"><strong>${installed.length}</strong><span>downloaded</span></div><div class="stat"><strong>${ms.filter(m=>m.loaded).length}</strong><span>loaded now</span></div><div class="stat"><strong>${new Set(ms.map(m=>m.type)).size}</strong><span>model categories</span></div></div>
  <div class="filters"><input type="search" id="search" placeholder="Search models, capabilities, or IDs…" value="${esc(filters.q)}" aria-label="Search models"><select id="filter-type" aria-label="Model type"><option value="all">All categories</option>${[...new Set(ms.map(m=>m.type))].sort().map(t=>`<option ${filters.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select><select id="filter-status" aria-label="Availability">${[['all','All models'],['installed','Downloaded'],['loaded','Loaded'],['available','Store catalog'],['missing','Not downloaded']].map(([k,v])=>`<option value="${k}" ${filters.status===k?'selected':''}>${v}</option>`).join('')}</select></div><details class="model-explainer"><summary>Understand your model shelf</summary><div class="model-terms"><p><strong>Available</strong>Listed in the store; download it before running.</p><p><strong>Downloaded</strong>Files are on the device; the model still needs to load.</p><p><strong>Loaded</strong>Ready to receive requests and holding NPU capacity.</p></div><p class="help">Choose a task first, then compare models using the same input. Parameter count and NPU reservation do not measure quality.</p><button class="text-button" data-guide="essentials">More about capacity, context, and model choice →</button></details><div id="model-count" class="small muted"></div><div id="model-grid" class="model-grid section-gap"></div>`;
  bind('#search','input',e=>{filters.q=e.target.value;renderModels();});bind('#filter-type','change',e=>{filters.type=e.target.value;renderModels();});bind('#filter-status','change',e=>{filters.status=e.target.value;renderModels();});renderModels();
}
function renderModels(){
  const ms=state.models.filter(m=>(filters.type==='all'||m.type===filters.type)&&(filters.status==='all'||(filters.status==='missing'?!m.installed:m[filters.status]))&&(!filters.q||JSON.stringify([m.name,m.id,m.description,m.capabilities,m.supported]).toLowerCase().includes(filters.q.toLowerCase())));
  $('#model-count').textContent=ms.length+' models · device metadata, refreshed '+new Date(state.syncedAt).toLocaleString();
  $('#model-grid').innerHTML=ms.map(m=>`<article class="panel model-card"><div class="model-top"><span class="type-icon">${icons[m.tasks[0]] || '◈'}</span><span class="pill ${m.loaded?'live':''}">${m.loaded?'Loaded':m.installed?'Downloaded':'Available'}</span></div><div><h3>${esc(m.name)}</h3><div class="id">${esc(m.id)}</div></div><span class="small muted">${esc(m.type)}</span><div class="description">${esc(m.description.split('\n')[0])}</div><div class="metrics"><span>${esc(m.params || '—')} · ${fmtSize(m.size)}</span><span>${esc(m.npu??'?')}% NPU</span></div><div class="actions"><button class="button primary model-action" data-id="${esc(m.id)}" data-action="${m.loaded?'stop':m.installed?'start':'download'}">${m.loaded?'Unload':m.installed?'Load model':'Download'}</button><button class="button detail" data-id="${esc(m.id)}">Details ↗</button></div></article>`).join('')||'<div class="empty-inline">No matching models.</div>';
  document.querySelectorAll('.model-action').forEach(b=>b.onclick=()=>modelAction(b));document.querySelectorAll('.detail').forEach(b=>b.onclick=()=>modelDetails(b.dataset.id));
}
async function modelAction(b){
  const {id,action}=b.dataset,label=b.textContent;
  b.disabled=true;b.textContent=({start:'Loading…',stop:'Unloading…',download:'Requesting…'})[action];
  try{
    await api('/api/model',{id,action});
    if(action==='start'&&compatible('chat',true).some(model=>model.id===id)){
      if(id!==chatModel){chat=[];rememberChatRun(null);if(task==='chat')currentJob=null;}
      chatModel=id;
    }
    if(action==='stop'&&id===chatModel)chatModel='';
    toast(action==='download'?'Download requested. Refresh to check its status.':'Model action completed.');
    await refresh();
  }catch(e){fail(e);}finally{b.disabled=false;b.textContent=label;}
}
function modelDetails(id){const m=state.models.find(m=>m.id===id);$('#model-detail').innerHTML=`<div class="eyebrow">${esc(m.type)}</div><h2>${esc(m.name)}</h2><p class="small muted">${esc(m.id)}</p><div class="section-gap">${[['Inputs',m.input],['Outputs',m.output],['NPU reservation',m.npu+'%'],['Store NPU estimate',m.storeNpu==null?'Not reported':m.storeNpu+'%'],['Disk size',fmtSize(m.size)],['Context window',m.context || 'Not reported'],['Capabilities',[...m.capabilities,...m.supported].join(', ') || 'Not reported'],['Reasoning levels',m.reasoningLevels.join(', ') || 'Not reported'],['Version',m.version || 'Not reported'],['Availability',m.loaded?'Loaded':m.installed?'Downloaded':m.available?'Store':'Custom']].map(([k,v])=>`<div class="metric-row"><span class="muted">${k}</span><span>${esc(v)}</span></div>`).join('')}</div><div class="model-description">${esc(m.description)}</div><p class="help section-gap">Reported by your device. A listed model or capability does not establish that every API option has been tested.</p>`;$('#model-dialog').showModal();}
const recipes=[
  {name:'Idea → image → film',note:'Enhance → create → refine → animate',studio:true},
  {name:'Repair soundtrack',note:'Review words → new voice → remix',workshop:'soundtrack-workflow'},
  {name:'TiinyVerse museum',note:'Curate → illustrate → narrate → export',workshop:'museum-workflow'},
  {name:'Meeting → brief',note:'Transcribe → summarize → speak',steps:[['asr','{{input}}','input'],['chat','Summarize this transcript into decisions and action items:\n{{previous.text}}'],['speech','{{previous.text}}']]},
  {name:'Image → motion',note:'Generate → animate a starting image',steps:[['image','{{input}}'],['video','Animate the supplied scene. {{input}}','previous']]},
  {name:'Read → explain',note:'OCR → plain-language explanation',steps:[['ocr','{{input}}','input'],['chat','Explain this document clearly, preserving key facts:\n{{previous.text}}']]},
  {name:'Idea → voice',note:'Write a script → narrate it',steps:[['chat','Write a short spoken script about: {{input}}'],['speech','{{previous.text}}']]}
];
function recipe(r){if(r.workshop){const target=$('#'+r.workshop);if(target){target.open=true;target.scrollIntoView({block:'start',behavior:'smooth'});}return;}if(r.studio){$('#creative-workflow').open=true;$('#creative-studio').scrollIntoView({block:'start',behavior:'smooth'});$('#studio-prompt').focus({preventScroll:true});return;}workflow={name:r.name,steps:r.steps.map(([task,prompt,fileFrom])=>({task,model:preferred(task),prompt,fileFrom:fileFrom || 'none',params:{}}))};workflowPage();$('#workflow-builder').open=true;}
function workflowPage(){
  $('#view').innerHTML=heading('CONNECT THE POSSIBILITIES','A good idea has a next step.','Build a sequence with typed inputs and outputs. Each step pins an exact model.',`<button class="button quiet" id="new-workflow">New workflow</button><button class="button" id="save-workflow">Save recipe</button>`)+
  `<details class="panel workflow-disclosure" id="creative-workflow"><summary><span><small>CREATE · REFINE · ANIMATE</small><strong>Idea → image → film</strong></span><span>Guided workflow</span></summary><div id="creative-studio"></div></details><div class="workflow-teach"><p><strong>A workflow is a recipe.</strong> Each step needs the right kind of input. Text goes in the instruction; images and audio go through File input.</p><button class="button quiet" data-guide="workflows">How to connect steps ↗</button></div><details class="panel workflow-disclosure" id="workflow-builder"><summary><span><small>BUILD YOUR OWN</small><strong>Sequential workflow editor</strong></span><span>Steps & saved recipes</span></summary><div class="workflow-layout"><aside class="recipes"><div class="eyebrow">START WITH A RECIPE</div>${recipes.map((r,i)=>`<button class="recipe" data-recipe="${i}"><strong>${r.name}</strong><small>${r.note}</small></button>`).join('')}<div class="eyebrow section-gap">SAVED RECIPES</div><div id="saved-recipes"></div></aside><div>
  <label class="field"><span>Workflow name</span><input id="workflow-name" value="${esc(workflow.name)}"></label><div class="notice">Spindle runs one step at a time. Keep models loaded yourself, or explicitly allow model switching below. Switching pauses for active device tasks and restores your starting models when the run ends.</div>
  <div id="steps"></div><div class="actions"><button id="add-step" class="button">＋ Add step</button></div>
  <section class="panel section-gap"><div class="panel-head"><h2>Run this workflow</h2><span class="pill">Sequential execution</span></div><div class="panel-body"><label class="field"><span>Starting text · available as {{input}}</span><textarea id="workflow-input" placeholder="Describe the idea, source, or goal…"></textarea></label>${fileField('Starting file · if needed','image/*,.wav')}<div id="workflow-preflight"></div><div id="workflow-feedback" role="alert"></div><p class="help privacy-inline">Any chat step with web search enabled sends its query (or step prompt) to DuckDuckGo or Brave over HTTPS. U.S. weather locations may go to the National Weather Service. Switching unloads models and can affect other clients. Restoration can fail after a disconnect or shutdown. Use an idle device.</p><label class="checkline"><input type="checkbox" id="switch-models"> Allow this run to unload current models, load each step’s model, and restore the starting models afterward.</label><button id="run-workflow" class="button primary">Run workflow ↗</button><div id="workflow-status" class="help section-gap"></div></div></section></div></div></details>`;
  document.querySelectorAll('[data-recipe]').forEach(b=>b.onclick=()=>recipe(recipes[Number(b.dataset.recipe)]));
  bind('#new-workflow','click',()=>{workflow={name:'Untitled workflow',steps:[]};workflowPage();$('#workflow-builder').open=true;});
  bind('#workflow-name','input',e=>workflow.name=e.target.value);
  bind('#add-step','click',()=>{syncSteps();workflow.steps.push({task:'chat',model:preferred('chat'),prompt:workflow.steps.length?'{{previous.text}}':'{{input}}',params:{},fileFrom:'none'});renderSteps();});
  bind('#save-workflow','click',async()=>{try{syncSteps();const w=await api('/api/workflows',workflow);workflow.id=w.id;toast('Recipe saved on this computer.');loadSaved();}catch(e){fail(e);}});
  bind('#run-workflow','click',async()=>{try{syncSteps();if(!workflow.steps.length)throw new Error('Add at least one step.');const issues=workflowWarnings(workflow.steps,state.tasks);if(issues.length)throw new Error('Step '+(issues[0].step+1)+': '+issues[0].text);if(workflow.steps.some(s=>s.fileFrom==='input')&&!$('#input-file').files.length)throw new Error('Choose a starting file before running this workflow.');const missing=workflow.steps.filter(s=>!state.models.find(m=>m.id===s.model)?.loaded);if(missing.length&&!$('#switch-models').checked)throw new Error('Load the required models, or enable model switching: '+[...new Set(missing.map(s=>s.model||'(choose a model)'))].join(', '));
    const j=await api('/api/run',{name:workflow.name,input:$('#workflow-input').value,file:await readFile($('#input-file'),workflow.steps[0]?.task),steps:workflow.steps,switchModels:$('#switch-models').checked});currentJob=j.id;toast('Workflow queued. Results will be saved in Library & runs.');poll();}catch(e){fail(e);}});
  const workshopRoot=document.createElement('div');workshopRoot.id='extra-workshops';$('#creative-workflow').after(workshopRoot);workshops.mount(workshopRoot,runs);const cutRoot=document.createElement('div');$('#creative-workflow').after(cutRoot);roughCut.mount(cutRoot,runs);
  if(facsimileBook){const bookRoot=document.createElement('div');workshopRoot.after(bookRoot);facsimileBook.mount(bookRoot);}
  studio.mount($('#creative-studio'),runs);renderSteps();loadSaved();renderWorkflowStatus();
}
function renderSteps(){
  $('#steps').innerHTML=workflow.steps.map((s,i)=>`<section class="panel step" data-index="${i}"><div class="step-title"><h3><span class="step-number">${i+1}</span>${esc(state.tasks[s.task].label)} <span class="small muted">→ ${state.tasks[s.task].output}</span></h3><div class="step-tools"><button data-move="${i}:up" aria-label="Move step up">↑</button><button data-move="${i}:down" aria-label="Move step down">↓</button><button data-remove="${i}" aria-label="Remove step">×</button></div></div><div class="field-row"><label class="field"><span>Task</span><select data-step-task="${i}">${taskOptions(s.task)}</select></label><label class="field"><span>Model</span><select data-step-model="${i}">${modelOptions(s.task,s.model)}</select></label></div><label class="field"><span>Instruction / text input</span><textarea data-step-prompt="${i}">${esc(s.prompt)}</textarea></label><div class="template-line">{{input}} = starting text &nbsp; {{previous.text}} = previous result</div><label class="field"><span>File input</span><select data-step-file="${i}">${[['none','No file'],['input','Starting file'],['previous','Previous step’s image or audio']].map(([k,v])=>`<option value="${k}" ${s.fileFrom===k?'selected':''}>${v}</option>`).join('')}</select></label><p class="help step-context">${esc(guides[s.task].output)}</p><details><summary>Step parameters · JSON</summary><textarea data-step-params="${i}">${esc(JSON.stringify(s.params || {},null,2))}</textarea></details></section>`).join('')||'<div class="empty-inline">Choose a recipe or add your first step.</div>';
  document.querySelectorAll('[data-step-task]').forEach(el=>el.onchange=()=>{try{syncSteps();const i=Number(el.dataset.stepTask);workflow.steps[i].task=el.value;workflow.steps[i].model=preferred(el.value);renderSteps();}catch(e){fail(e);}});
  document.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{try{syncSteps();workflow.steps.splice(Number(el.dataset.remove),1);renderSteps();}catch(e){fail(e);}});
  document.querySelectorAll('[data-move]').forEach(el=>el.onclick=()=>{try{syncSteps();const [n,d]=el.dataset.move.split(':'),i=Number(n),j=d==='up'?i-1:i+1;if(j>=0&&j<workflow.steps.length){[workflow.steps[i],workflow.steps[j]]=[workflow.steps[j],workflow.steps[i]];renderSteps();}}catch(e){fail(e);}});
  document.querySelectorAll('[data-step-file],[data-step-prompt]').forEach(el=>el.addEventListener('change',()=>{try{syncSteps();preflight();}catch(e){fail(e);}}));
  document.querySelectorAll('[data-step-model]').forEach(el=>el.onchange=()=>{workflow.steps[Number(el.dataset.stepModel)].model=el.value;preflight();});preflight();
}
function syncSteps(){workflow.name=$('#workflow-name').value;for(let i=0;i<workflow.steps.length;i++){const s=workflow.steps[i];s.model=$(`[data-step-model="${i}"]`).value;s.prompt=$(`[data-step-prompt="${i}"]`).value;s.fileFrom=$(`[data-step-file="${i}"]`).value;try{s.params=JSON.parse($(`[data-step-params="${i}"]`).value);}catch{throw new Error('Step '+(i+1)+' has invalid JSON parameters.');}}}
function preflight(){const target=$('#workflow-preflight');if(!target)return;const ids=[...new Set(workflow.steps.map(s=>s.model))];const models=ids.map(id=>state.models.find(m=>m.id===id));const cost=models.reduce((sum,m)=>sum+(m?.npu || 0),0);const warnings=workflowWarnings(workflow.steps,state.tasks);target.innerHTML=workflow.steps.length?`<p class="help">${workflow.steps.length} steps · ${ids.length} distinct models · ${cost}% estimated NPU reservation if resident together</p>${cost>100?'<p class="help error">These models exceed NPU capacity together. Enable model switching to run them one at a time.</p>':''}<div class="step-status">${models.map(m=>`<span class="pill ${m?.loaded?'live':'warn'}">${esc(m?.name || 'Choose a model')}: ${m?.loaded?'ready':'load needed'}</span>`).join('')}</div>${warnings.length?`<div class="workflow-warnings"><strong>Before you run</strong>${warnings.map(w=>`<p>Step ${w.step+1}: ${esc(w.text)}</p>`).join('')}</div>`:''}`:'';}
async function loadSaved(){try{saved=await api('/api/workflows');if(!$('#saved-recipes'))return;$('#saved-recipes').innerHTML=saved.map(w=>`<button class="recipe" data-saved="${esc(w.id)}"><strong>${esc(w.name)}</strong><small>${w.steps.length} steps</small></button>`).join('')||'<p class="help">Your saved recipes live here.</p>';document.querySelectorAll('[data-saved]').forEach(b=>b.onclick=()=>{workflow=structuredClone(saved.find(w=>w.id===b.dataset.saved));workflowPage();$('#workflow-builder').open=true;});}catch(e){fail(e);}}
function renderWorkflowStatus(){studio.update(runs);workshops.update(runs);roughCut.update(runs);facsimileBook?.update(runs);const el=$('#workflow-status');const j=runs.find(j=>j.id===currentJob);if(el&&j)el.innerHTML=`${esc(j.name)} · ${esc(j.phase || j.status)} · step ${(j.currentStep || 0)+1} of ${j.steps.length}${j.error?'<p class="error">'+esc(j.error)+'</p>':''}`;}
function libraryPage(){ $('#view').innerHTML=heading('YOUR LOCAL LIBRARY','Keep what you make.','Every run keeps its model, inputs, parameters, and outputs on this computer.')+(librarySelection?'<button type="button" class="button quiet" id="show-all-runs">← All runs</button>':'')+'<div id="runs"></div>';
  bind('#show-all-runs','click',()=>{librarySelection='';libraryPage();});renderRuns();void poll();
}
const runSignatures=new Map();
function renderRuns(){
  const target=$('#runs');if(!target)return;
  if(!runs.length){target.innerHTML='<div class="panel empty"><div class="empty-icon">▧</div><h3>Your next idea starts the collection.</h3><p>Run a task in the workbench to save your first output.</p></div>';return;}
  if(!target.querySelector('[data-run-id]'))target.innerHTML='';
  const sorted=runs.filter(run=>!librarySelection||run.id===librarySelection).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  sorted.forEach((j,index)=>{
    let card=target.querySelector(`[data-run-id="${j.id}"]`);
    const textureActions=j.outputs.map((out,i)=>meshTextureAction(j,out,i));
    const sig=JSON.stringify([j.input,j.steps,j.outputs,j.finalOutput,j.error,j.audioFailure,j.restoreError,j.persistenceError,textureActions]);
    if(!card){card=document.createElement('article');card.className='panel run-card';card.dataset.runId=j.id;}
    if(runSignatures.get(j.id)!==sig||!card.children.length){
      const [step]=j.steps;
      const single=j.steps.length===1;
      const fromInput=step?.prompt==='{{input}}'&&step.promptMode!=='literal';
      const template=step?.promptMode!=='literal'&&/\{\{(?:input|previous\.text)\}\}/.test(step?.prompt || '');
      const prompt=single?copyButton(fromInput?j.input:step.prompt,template&&!fromInput?'prompt template':'prompt'):'';
      const recipeCopies=[
        fromInput&&single?'':copyButton(j.input,'starting text'),
        ...(single?[]:j.steps.map((step,i)=>copyButton(step.prompt,'step '+(i+1)+' prompt'))),
      ].join('');
      const recipeSteps=j.steps.map(({attachments,...step})=>attachments?.length?{...step,attachments:attachments.map(file=>file.name)}:step);
      const inputAttachments=textAttachmentDetails(single?step.attachments:undefined);
      const outputs=j.outputs.map((out,i)=>libraryOutput(out,textureActions[i]+appPreviewButton(out,j.id,i))).join('');
      card.innerHTML=`<div class="panel-head"><div><h3>${esc(j.name)}</h3><div class="small muted">${new Date(j.createdAt).toLocaleString()} · ${j.steps.length} step${j.steps.length===1?'':'s'}</div></div><div class="actions run-actions"></div></div><div class="panel-body output-area">${prompt}${inputAttachments}${j.finalOutput?libraryOutput(j.finalOutput):''}${j.film?`<details><summary>Saved segments · ${j.outputs.length}</summary>${outputs}</details>`:outputs}${j.error?recoveryHTML(j.error,j.audioFailure):''}${j.restoreError?`<p class="error">${esc(j.restoreError)}</p>`:''}${j.persistenceError?`<p class="error">${esc(j.persistenceError)}</p>`:''}<details class="section-gap"><summary>Run recipe & parameters</summary>${recipeCopies?'<div class="actions">'+recipeCopies+'</div>':''}<pre>${esc(JSON.stringify({input:j.input,steps:recipeSteps},null,2))}</pre></details></div>`;
      runSignatures.set(j.id,sig);
    }
    card.querySelector('.run-actions').innerHTML=`<span class="pill ${j.status==='completed'?'live':''}">${esc(j.status==='running'?j.phase || j.status:j.status)}${j.progress!=null?' · '+j.progress+'%':''}</span>${['queued','running'].includes(j.status)?'<button class="button danger cancel-run">Stop run</button>':''}${j.status==='completed'&&j.outputs.some(o=>o.task==='image'&&o.assets?.some(a=>a.mime.startsWith('image/')))?'<button class="button use-image">Edit / animate image →</button>':''}${j.roughCut?.segments?'<button class="button review-cut">Review rough cut →</button>':''}${j.film&&['failed','cancelled','interrupted'].includes(j.status)?'<button class="button resume-film">Resume film →</button>':''}`;
    const stop=card.querySelector('.cancel-run');if(stop)stop.onclick=()=>api('/api/cancel/'+j.id,{}).then(poll).catch(fail);
    if(state&&isChatRun(j)){
      const open=document.createElement('button');open.type='button';open.className='button';open.textContent='Open in Chat';
      open.onclick=()=>openChatRun(j);card.querySelector('.run-actions').append(open);
    }
    const cut=card.querySelector('.review-cut');if(cut)cut.onclick=()=>{page='workflows';roughCut.open(j.id);show();roughCut.open(j.id);$('#rough-cut-workflow')?.scrollIntoView({block:'start'});};
    const use=card.querySelector('.use-image');if(use)use.onclick=()=>makeImageVideo(j);
    const resume=card.querySelector('.resume-film');if(resume)resume.onclick=async()=>{resume.disabled=true;try{const next=await api('/api/studio/resume',{id:j.id});currentJob=next.id;toast('Film resumed from saved segments.');await poll();}catch(e){fail(e);}finally{resume.disabled=false;}};
    if(target.children[index]!==card)target.insertBefore(card,target.children[index] || null);
  });
}
function devicePage(){
  const models=state.models.filter(m=>m.loaded),n=state.npu;
  $('#view').innerHTML=heading('THE HEART OF YOUR UNIVERSE','Small footprint. Full control.','Live device telemetry, connection health, and real capability checks.')+`<div class="device-grid"><section class="panel"><div class="panel-head"><h2>Your Tiiny</h2><span class="pill live">${state.offline?'Offline':'Connected'}</span></div><div class="panel-body">${[['Loaded models',models.length],['NPU reserved',models.reduce((a,m)=>a+(m.npu || 0),0)+'%'],['NPU activity',n?.devices?.[0]?.util_percent==null?'Unavailable':n.devices[0].util_percent+'%'],['NPU memory',n?.devices?.[0]?Math.round(n.devices[0].mem_used_mb)+' / '+Math.round(n.devices[0].mem_total_mb)+' MB':'Unavailable'],['CPU activity',n?.cpu?.total_percent==null?'Unavailable':n.cpu.total_percent+'%'],['Memory',n?.memory?.usage_percent==null?'Unavailable':n.memory.usage_percent+'%']].map(([k,v])=>`<div class="metric-row"><span class="muted">${k}</span><span>${esc(v)}</span></div>`).join('')}<p class="help section-gap">Reservation is model capacity. Activity is current compute use.</p></div></section><section class="panel"><div class="panel-head"><h2>Built for your own hardware</h2><span class="pill">Local helper</span></div><div class="panel-body"><p class="lead">The complete creative loop, close to home.</p><p class="help section-gap">Inference uses the device endpoint you connect. Optional web search sends the query to your selected provider. Runs and outputs are saved locally. No Spindle cloud account. No external fonts or animation services.</p><div class="actions section-gap"><button class="button" id="open-connection">Connection settings ↗</button><a class="button quiet" href="/catalog.csv" download>Export catalog</a></div><p class="help section-gap">Refresh discovers new store entries and downloaded models automatically. New task types need a new adapter.</p></div></section></div><div class="section-label section-gap"><span>CAPABILITY READINESS</span><span>Real device checks, with recorded evidence.</span></div><div id="readiness" class="verification-grid"></div>`;
  $('#readiness').parentElement.querySelector('.device-grid').insertAdjacentHTML('afterend',`<section class="panel section-gap"><div class="panel-head"><h2>Power & recovery</h2></div><div class="panel-body"><p class="help">Wait for device work to finish before restarting or shutting down.</p><div class="actions"><button class="button" id="tiiny-restart">Restart Tiiny</button><button class="button danger" id="tiiny-shutdown">Shut down Tiiny</button></div><label class="checkline"><input type="checkbox" id="tiiny-ac" disabled> Automatically power on when AC power returns</label><p class="help" id="tiiny-power-status" role="status"></p></div></section>`);
  const ac=$('#tiiny-ac'),powerStatus=$('#tiiny-power-status'),restart=$('#tiiny-restart'),shutdown=$('#tiiny-shutdown');
  restart.disabled=shutdown.disabled=!!state.offline;
  api('/api/device/power').then(r=>{if(typeof r.acPower==='boolean'){ac.checked=r.acPower;ac.disabled=false;}else powerStatus.textContent='AC recovery status is unavailable.';}).catch(()=>{powerStatus.textContent='AC recovery is unavailable on this connection.';});
  for(const [button,action,label] of [[restart,'restart','Restart'],[shutdown,'shutdown','Shut down']])button.onclick=async()=>{
    if(!confirm(label+' your Tiiny now? Other apps connected to the device will disconnect.'))return;
    restart.disabled=shutdown.disabled=true;powerStatus.textContent='Sending request…';
    try{await api('/api/device/power',{action,confirm:true});powerStatus.textContent=action==='restart'?'Restart requested. Reconnect when the device is ready.':'Shutdown requested. Keep power connected until the indicator turns off.';$('#connection').textContent=action==='restart'?'Tiiny restarting…':'Tiiny shutting down…';ac.disabled=true;}
    catch(e){powerStatus.textContent=e.message;restart.disabled=shutdown.disabled=false;}
  };
  ac.onchange=async()=>{const enabled=ac.checked;ac.disabled=true;try{await api('/api/device/power',{action:'ac-power',enabled,confirm:true});powerStatus.textContent='AC recovery '+(enabled?'enabled.':'disabled.');}catch(e){ac.checked=!enabled;powerStatus.textContent=e.message;}finally{ac.disabled=false;}};
  bind('#open-connection','click',()=>{page='connection';show();});
  api('/api/readiness').then(r=>{if(!$('#readiness'))return;$('#readiness').innerHTML=Object.entries(state.tasks).map(([k,t])=>{
    const checks=r.checks?.filter(c=>c.task===k)||[],c=checks.at(-1);
    const speechModes=k==='speech'&&c?.model?['plain','voice-reference'].flatMap(mode=>{
      const check=checks.findLast(item=>item.model===c.model&&item.speechMode===mode);
      return check?[`<p>${mode==='plain'?'Plain speech':'Reference voice'} · ${esc(check.status)}</p>`]:[];
    }).join(''):'';
    return `<article class="panel verification-card"><h3>${icons[k]} ${esc(t.label)}</h3><span class="pill ${c?.status==='passed'?'live':c?.status==='failed'?'warn':''}">${c?.status==='passed'?'Verified on device':c?.status==='failed'?'Needs attention':'Not checked yet'}</span><p>${esc(c?.note || 'Connect a compatible model to validate this capability.')}</p>${c?.model?`<p>${esc(c.model)}</p>`:''}${speechModes}</article>`;
  }).join('');}).catch(fail);
}
function connectionPage(){
  document.body.classList.remove('creating');window.dispatchEvent(new Event('spindle:workspace'));closeNavigation();
  const c=connectionInfo || {};
  $('#view').innerHTML=heading('BRING YOUR OWN INTELLIGENCE','Make the connection.','Your Tiiny. Your key. A whole universe of possibilities.')+`<div class="connection-layout"><section class="panel"><div class="panel-head"><h2>Connect your Tiiny</h2><span class="pill ${c.keyPresent?'live':''}">${esc(c.source || 'New connection')}</span></div><div class="panel-body"><form id="connection-form"><label class="field"><span>Tiiny endpoint</span><input id="endpoint" type="url" placeholder="http://192.0.2.10" value="${esc(c.endpoint)}" required autocomplete="off"><p class="help">Device URL or an OpenAI-compatible base URL, including /v1 if present.</p><div class="privacy-card"><strong>HTTP TRAFFIC IS UNENCRYPTED</strong><p>With an HTTP device URL, the API key, prompts and files travel without TLS. Use a trusted private network or direct connection.</p></div></label><label class="field"><span>API key</span><input id="api-key" type="password" placeholder="${c.keyPresent?'A key is configured. Leave blank to keep it.':'Paste your Tiiny API key'}" autocomplete="off" spellcheck="false"><p class="help">Find it in TiinyOS Settings → API Key. The stored key is never sent back to this page.</p><button class="text-button" type="button" data-guide="connection">First time connecting? A short checklist →</button></label><label class="checkline"><input id="remember-key" type="checkbox" ${c.remembered&&c.source==='Saved in Spindle'?'checked':''}> Remember on this computer</label><p class="help"><strong>SAVING IS NOT ENCRYPTED.</strong> Remembering writes the API key in plaintext to the ignored local data folder. Leave this off for a session-only Spindle connection. Existing CLI or environment credentials are separate.</p><details><summary>Advanced routing</summary><label class="field section-gap"><span>Native multimodal base URL · optional</span><input id="native-endpoint" value="${esc(c.nativeEndpoint)}" placeholder="http://192.0.2.10/v1"></label><label class="field"><span>Management origin · optional</span><input id="management-endpoint" value="${esc(c.managementEndpoint)}" placeholder="http://192.0.2.10"></label><label class="checkline"><input id="host-routing" type="checkbox" ${c.hostRouting!==false?'checked':''}> Use Tiiny virtual-host routing</label></details><div class="actions"><button class="button primary" type="submit" id="save-connection">Connect Tiiny ↗</button><button class="button" type="button" id="test-connection">Test connection</button>${c.keyPresent?'<button class="button quiet" type="button" id="reset-connection">Use CLI / environment</button>':''}</div><div id="connection-result" class="connection-message" role="status"></div></form></div></section><section class="panel connection-art"><span class="giant-spark" aria-hidden="true">✳</span><div class="panel-body"><div class="eyebrow">YOURS, FROM THE FIRST TOKEN.</div><h2>Powerful things<br>happen locally.</h2><p>Spindle runs beside your Tiiny. Your key goes straight to the device through this local server. The animation is generated here, too.</p><div class="hero-tags"><span>◈ Private workspace</span><span>↗ Open by design</span></div></div></section></div>`;
  renderNavigation();
  const payload=()=>({endpoint:$('#endpoint').value,key:$('#api-key').value,remember:$('#remember-key').checked,nativeEndpoint:$('#native-endpoint').value,managementEndpoint:$('#management-endpoint').value,hostRouting:$('#host-routing').checked});
  const report=(msg,error=false)=>{const e=$('#connection-result');e.textContent=msg;e.classList.toggle('error',error);};
  bind('#endpoint','input',()=>{$('#native-endpoint').value='';$('#management-endpoint').value='';});
  bind('#test-connection','click',async()=>{const b=$('#test-connection');b.disabled=true;report('Reaching your Tiiny…');try{const r=await api('/api/connection/test',payload());report('Connected successfully. '+r.loadedModels+' model'+(r.loadedModels===1?'':'s')+' currently loaded.');}catch(e){report(e.message,true);}finally{b.disabled=false;}});
  bind('#connection-form','submit',async e=>{e.preventDefault();const b=$('#save-connection');b.disabled=true;report('Connecting…');try{connectionInfo=await api('/api/connection',payload());$('#api-key').value='';page='workbench';await refresh();toast('Your Tiiny is connected. Welcome to Spindle.');}catch(e){report(e.message,true);}finally{b.disabled=false;}});
  bind('#reset-connection','click',async()=>{try{await api('/api/connection/reset',{});connectionInfo=await api('/api/connection');connectionPage();toast('Spindle settings cleared. CLI or environment settings will be used when available.');}catch(e){report(e.message,true);}});
}
function onboardingHTML(){
  if(localStorage.getItem('spindle-started')==='yes')return '';
  return `<aside id="onboarding" class="first-result"><div class="first-result-title"><span class="intro-label">YOUR FIRST GOOD RESULT</span><button type="button" class="text-button" data-guide="start">A 60-second orientation ↗</button></div><div class="first-result-steps"><p><b>01</b><span><strong>Choose the job</strong>Pick what you want to make.</span></p><p><b>02</b><span><strong>Start small</strong>Use an example or your own input.</span></p><p><b>03</b><span><strong>Run, then refine</strong>Defaults are a good first choice.</span></p></div><button type="button" class="onboarding-close" aria-label="Dismiss getting started" data-dismiss-onboarding>×</button></aside>`;
}
function renderSampleStatus(){
  const slot=$('#sample-status');if(!slot)return;
  const visible=task!=='speech'||!$('#voice-reference').hidden;
  const sample=visible&&sampleInput?.task===task?sampleInput:null;
  const file=visible?$('#input-file')?.files?.[0]:null;
  slot.innerHTML=sample?`<span>✧ Sample selected: <strong>${esc(sample.file.name)}</strong></span><button type="button" class="text-button" data-clear-sample>Use my own file</button>`:file?`<span>Attached: <strong>${esc(file.name)}</strong></span><button type="button" class="text-button" data-clear-file>Remove</button>`:'';
  if(task==='speech'){
    $('#voice').closest('label').hidden=!!(sample||file);
    const preview=$('#voice-sample-preview');
    preview.hidden=sample?.file.name!==voiceReferenceSample.sample;
    if(preview.hidden&&!preview.paused)preview.pause();
  }
  if(task==='chat')chatOptionsStatus();
}
async function useExample(index){
  const targetTask=task;
  const g=guides[task],example=g?.examples[index];if(!example)return;
  if(page!=='workbench'){page='workbench';show();}
  let exampleModel;
  if(example.refText){
    const models=compatible('speech',true).filter(voiceCloneModel);
    exampleModel=models.find(model=>model.id===selectedModel)||models[0];
    if(!exampleModel)throw new Error('Download a speech model that supports voice cloning in Device → Models to try this sample.');
  }else if(task==='chat'&&example.sample){
    const models=compatible('chat',true).filter(model=>String(model.input).includes('Image'));
    if(!models.some(model=>model.id===selectedModel))throw new Error('Choose a downloaded chat model with image input to try this sample.');
  }
  const file=example.sample?await loadSampleFile(example.sample):null;
  if(task!==targetTask||page!=='workbench')return;
  if(example.defaultVoice&&$('#input-file').files.length)throw Error('Remove your attached reference recording before trying the default voice.');
  exampleUndo={task,model:selectedModel,values:Object.fromEntries(['prompt','lyrics','documents','ref-text','voice'].map(k=>[k,$('#'+k)?.value])),sample:sampleInput};
  if(example.defaultVoice){sampleInput=null;$('#voice').value='';}
  if(file)sampleInput={task,file};
  if(exampleModel){
    selectedModel=exampleModel.id;$('#model').value=selectedModel;$('#ref-text').value=example.refText;
    $('#creation-options').open=true;modelNote();renderModelLoad();
  }
  for(const k of ['prompt','lyrics','documents'])if(example[k]!==undefined&&$('#'+k))$('#'+k).value=example[k];
  renderSampleStatus();$('#example-undo').innerHTML='<span class="small muted">Example prepared. Review it, then run when ready.</span> <button type="button" class="text-button" data-undo-example>Undo</button>';
  resizePrompt();if($('#guide-dialog').open)$('#guide-dialog').close();
  ($('#prompt') || $('#sample-status'))?.scrollIntoView({block:'nearest',behavior:'smooth'});$('#prompt')?.focus();
}
async function loadSampleFile(name){
  const response=await fetch('/samples/'+name);
  if(!response.ok)throw new Error('The sample file could not be loaded. Choose your own file instead.');
  const blob=await response.blob();
  const data=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);
  });
  return {name,data};
}
async function insertDexPrompt(text,sampleName){
  if(!state)throw Error('Connect your Tiiny to open Chat, or copy the prompt.');
  const sample=sampleName?await loadSampleFile(sampleName):null;
  if(page!=='workbench'||task!=='chat'){
    if(task!=='chat'){
      task='chat';sampleInput=null;exampleUndo=null;currentJob=null;
    }
    page='workbench';show();
  }
  const composer=$('#prompt'),hasDraft=!!composer.value.trim();
  const hasAttachment=!!($('#input-file')?.files.length||sampleInput?.task==='chat');
  composer.value=hasDraft?composer.value+'\n\n'+text:text;
  if(sample&&!hasAttachment)sampleInput={task:'chat',file:sample};
  renderSampleStatus();resizePrompt();
  requestAnimationFrame(()=>composer.focus());
  toast(sample&&hasAttachment?'Prompt inserted. Your existing attachment is still selected.':hasDraft?'Prompt added to your draft.':'Prompt inserted into Chat.');
}
function dexComparisonModels(){
  return compatible('chat',true).map(model=>({
    id:model.id,name:model.name,loaded:model.loaded,
    vision:String(model.input).includes('Image'),limit:ampleResponseTokens(model),
  }));
}
async function queueDexComparison({title,prompt,models,limit,sampleName,attachment}){
  if(!state||state.offline)throw Error('Connect to the Tiiny before comparing models.');
  if(state.demo)throw Error('Open your regular Spindle session to run a comparison on your Tiiny.');
  if(attachment&&!['image/png','image/jpeg','image/webp'].includes(attachment.type))throw Error('Choose a PNG, JPEG, or WebP image.');
  const file=attachment?await readFile({files:[attachment]},'chat'):sampleName?await loadSampleFile(sampleName):undefined;
  const selected=models.map(id=>dexComparisonModels().find(model=>model.id===id));
  if(selected.length!==2||models[0]===models[1]||selected.some(model=>!model||file&&!model.vision))throw Error('Choose two different downloaded models that accept the input.');
  if(!Number.isSafeInteger(limit)||limit<1||selected.some(model=>model.limit<limit))throw Error('Use a response allowance that fits both models.');
  const params={_spindleResponseMode:'explicit',max_tokens:limit,_spindleWebSearch:{enabled:false}};
  const steps=models.map(model=>({task:'chat',model,prompt,promptMode:'literal',params,...(file?{fileFrom:'input'}:{})}));
  const run=await api('/api/run',{name:'PromptDex comparison · '+title,steps,file,switchModels:true});
  runs=[run,...runs.filter(job=>job.id!==run.id)];
  void poll();
  return run.id;
}
async function openPromptDex(id){
  if(!promptDex){
    try{
      const {createPromptDex}=await import('./prompt-dex.mjs');
      promptDex??=createPromptDex({
        storage:chatStorage,escape:esc,onUse:insertDexPrompt,
        getModels:dexComparisonModels,getRun:id=>runs.find(run=>run.id===id),queueComparison:queueDexComparison,
      });
    }catch{toast('Restart the Spindle helper, then reload to open PromptDex.');return;}
  }
  closeNavigation();promptDex.open(id);
}
function recoveryHTML(message,audioFailure){const tip=recovery(message,audioFailure);return `<aside class="recovery-card"><span class="intro-label">A USEFUL NEXT STEP</span><h3>${esc(tip.title)}</h3><p>${esc(tip.text)}</p><button type="button" class="text-button" data-recovery="${tip.action}">${esc(tip.label)} →</button><details><summary>Original message</summary><pre>${esc(message)}</pre></details></aside>`;}
function voiceSamplesHTML(){
  const buttons=[['asr','Transcribe a synthetic voice','Transcribe this recording'],['speech','Try the default voice','Generate with the default voice'],['speech','Clone a synthetic voice','Generate with the reference voice']];
  return `<section class="guide-note"><h3>Voice samples</h3><audio controls preload="none" src="/samples/${voiceReferenceSample.sample}" aria-label="Synthetic reference recording"></audio><p>${esc(voiceReferenceSample.refText)}</p><p>Try transcription or generate the same line with the default and reference voices. Each result is saved in Library &amp; runs.</p><div class="actions">${buttons.map(([mode,example,label])=>`<button type="button" class="button" data-voice-mode="${mode}" data-voice-example="${guides[mode].examples.findIndex(item=>item.label===example)}" ${state?'':'disabled'}>${label}</button>`).join('')}</div></section>`;
}
function openGuide(tabName){
  const selected=tabName || ({device:'essentials',models:'essentials',security:'privacy'})[page] ||
    (['workflows','meeting','dashboard','library','connection'].includes(page)?page:'task');
  const dialog=$('#guide-dialog'),g=guides[task];
  const sections=items=>items.map((item,i)=>`<details class="guide-section" ${i===0?'open':''}><summary>${esc(item.title)}</summary><p>${esc(item.text)}</p></details>`).join('');
  const tabs=[['task','This task'],['start','Start here'],['meeting','Meeting Desk'],['workflows','Workflows'],['dashboard','Dashboard'],['library','Find & reuse'],['essentials','Device & models'],['connection','Connect'],['privacy','Privacy & limits']];
  let body='';
  if(Object.hasOwn(workspaceTips,selected)){
    const topic=workspaceTips[selected];
    body=`<h3 class="guide-feature-title">${esc(topic.title)}</h3>${sections(topic.items)}`;
  }
  if(selected==='task')body=`<span class="guide-category">${icons[task]} ${esc(state?.tasks?.[task]?.label || 'Chat & vision')}</span><h3 class="guide-feature-title">${esc(g.title)}</h3><p class="guide-lead">${esc(g.purpose)}</p><div class="guide-facts"><p><strong>BEST FOR</strong>${esc(g.best)}</p><p><strong>WHAT YOU GET</strong>${esc(g.output)}</p></div>${['asr','speech'].includes(task)?voiceSamplesHTML():''}<h3>Make it better</h3><ol class="guide-tips">${g.tips.map(t=>`<li>${esc(t)}</li>`).join('')}</ol><div class="guide-note"><strong>Worth knowing</strong><p>${esc(g.watch)}</p></div><h3>A useful starting point</h3><div class="guide-examples">${g.examples.map((e,i)=>`<button class="recipe" data-example="${i}" ${state?'':'disabled'}><strong>${esc(e.label)} ↗</strong><small>Prepare an example ${e.sample?'with a sample file':'prompt'}</small></button>`).join('')}</div><p class="guide-footnote">${state?'Examples prepare inputs. To generate a result, send or run the example.':'Connect your Tiiny to prepare an example.'}</p><div class="guide-next"><strong>YOUR NEXT MOVE</strong><p>${esc(g.next)}</p></div>`;
  if(selected==='start')body=`<h3 class="guide-feature-title">One small idea is enough.</h3><p class="guide-lead">Make one useful result before exploring all the controls.</p><ol class="guide-tips start-tips"><li><strong>Pick the task.</strong> Chat writes and explains. Images and Video create visuals. Transcribe reads audio; Speech makes it.</li><li><strong>Choose a compatible model.</strong> The workbench lists downloaded models for the task. Model switching can prepare the selected one for you.</li><li><strong>Try an example.</strong> Review the prepared prompt or sample file. Leave advanced settings at {} for the first run.</li><li><strong>Run and give it time.</strong> Preparing a model and generating media can take minutes. The status tells you which stage is happening.</li><li><strong>Keep and refine.</strong> Outputs are saved in Library & runs. Change one part of the input, compare, and save a workflow for repeatable work.</li></ol><div class="actions"><button class="button primary" data-guide="task">Show me examples ↗</button><button class="button quiet" data-show-onboarding>Show start strip</button></div><div class="guide-note"><strong>Keep the surface calm</strong><p>The start strip can be dismissed. This guide stays available from the top bar.</p></div>`;
  if(selected==='essentials')body=`<h3 class="guide-feature-title">A few terms. A lot less guessing.</h3><p class="guide-lead">Open the topic you need.</p>${sections(essentials)}`;
  if(selected==='workflows')body=`<h3 class="guide-feature-title">Connect the result, not just the idea.</h3><p class="guide-lead">Each step has an input and an output. Matching them is the key to a dependable recipe.</p>${sections(workflowTips)}<div class="guide-note"><strong>Two simple patterns</strong><p>Recording → Transcribe → Chat summary → Speech.<br>Image prompt → Images → Video with the previous image as its file input.</p></div>`;
  if(selected==='privacy')body=`<h3 class="guide-feature-title">Know what stays private.</h3><div class="privacy-card"><strong>HTTP DOES NOT ENCRYPT DEVICE TRAFFIC</strong><p>The API key, prompts and files travel without TLS when your device endpoint uses HTTP. Use a trusted private network or direct connection. HTTPS works only when supported and properly configured on the device.</p></div><div class="privacy-card"><strong>REMEMBERED KEYS ARE PLAINTEXT IN THIS VERSION</strong><p>Leave Remember on this computer off to keep a Spindle connection in server memory until shutdown. Saving it writes the unencrypted key to the ignored local data folder. Native keychain encryption is planned and has not been implemented. Existing CLI or environment credentials are separate.</p></div><div class="privacy-card"><strong>THIS IS A LOCAL, SINGLE-USER APP</strong><p>Keep the helper on your own trusted computer. Do not expose its port to the internet or other users. There is no multi-user login. Docker packaging is not implemented, and macOS/Linux support still needs platform validation.</p></div><h3>Before sharing</h3><p class="guide-lead">Runs, media, model inventories and exports can contain private information. Share only material you reviewed. Keep data/, actual environment files and CLI configuration out of public repositories.</p><h3>Search and share</h3><p class="guide-lead">Search Spindle stays in this browser. Chat web search sends a query to an external provider when enabled. Use Send to Tiiny only for a sensitive message. Vault excerpts go to Tiiny. A reply can quote them and be saved in run history.</p><p class="guide-lead">Device → Security &amp; Privacy offers an optional chat request trace. Review meeting minutes, cut sheets, booklets, and generated HTML before sharing.</p>`;
  if(selected==='connection')body=`<h3 class="guide-feature-title">Your device, one good connection.</h3><ol class="guide-tips start-tips"><li><strong>Find the address.</strong> Copy your Tiiny device address from TiinyOS network settings or the base URL used by your working Tiiny client.</li><li><strong>Find the key.</strong> Copy it from TiinyOS Settings → API Key. Paste it into Spindle’s Connection form.</li><li><strong>Test before connecting.</strong> A successful test confirms the model-list endpoint responds. It does not load or run a model.</li><li><strong>Choose whether to remember it.</strong> Unchecked keeps the Spindle connection in server memory until shutdown. Checked saves it in the local ignored data folder.</li></ol><div class="guide-note"><strong>If the test fails</strong><p>Check power, the USB or network connection, and the endpoint. An authorization error usually needs the current device key. Advanced routing is for owners who know their device uses a different native or management base URL.</p></div><p class="guide-footnote">Existing CLI or environment settings can supply a connection. A saved key is never sent back to the form.</p>`;
  $('#guide-content').innerHTML=`<header class="guide-header"><div><span class="intro-label">A LITTLE GUIDANCE. MORE POSSIBILITY.</span><h2 id="guide-title">The Spindle field guide</h2></div><button class="dialog-close" aria-label="Close field guide" data-close-guide>×</button></header><nav class="guide-tabs" aria-label="Guide sections">${tabs.map(([id,label])=>`<button data-guide="${id}" aria-pressed="${selected===id}">${label}</button>`).join('')}</nav><div class="guide-body">${body}</div>`;
  if(!dialog.open)dialog.showModal();
  dialog.scrollTop=0;
}
document.addEventListener('click',async e=>{
  const jump=e.target.closest('[data-chat-jump]');
  if(jump){
    const heading=jump.closest('.chat-markdown').querySelector(`[data-chat-heading="${jump.dataset.chatJump}"]`);
    heading?.focus({preventScroll:true});
    heading?.scrollIntoView({block:'start'});
    return;
  }
  const code=e.target.closest('[data-copy-code]');
  if(code){await copyText(code.closest('.chat-code').querySelector('code').textContent,'block');return;}
  const attachment=e.target.closest('[data-download-text]');
  if(attachment){
    downloadArtifact(attachment.dataset.downloadText,attachment.closest('details').querySelector('code').textContent);
    return;
  }
  const copy=e.target.closest('[data-copy-text]');
  if(copy){await copyText(JSON.parse(copy.dataset.copyText),copy.dataset.copyKind);return;}
  const preview=e.target.closest('[data-preview-app]');
  if(preview){openAppPreview(preview);return;}
  if(e.target.closest('[data-open-prompt-dex]')){void openPromptDex();return;}
  const texture=e.target.closest('[data-texture-run]');
  if(texture){
    const form=$('#task-form'),fromLibrary=page==='library';
    texture.disabled=true;
    try{
      const j=await api('/api/mesh/texture',{id:texture.dataset.textureRun,step:Number(texture.dataset.textureStep),switchModels:fromLibrary||!!$('#auto-model')?.checked});
      if(form&&form===$('#task-form')){
        currentJob=j.id;$('#action-error').innerHTML='';renderCurrent(j);scrollConversation();
      }else if(fromLibrary&&page==='library'){
        librarySelection=j.id;libraryPage();
      }
      toast('Texture run queued. Follow it in Library & runs.');
      await poll();
    }catch(err){toast(err.message);texture.disabled=false;}
    return;
  }
  const del=e.target.closest('[data-delete-asset]');
  if(del){if(!confirm('Move this output to Spindle’s local trash? The rest of the run stays in the library.'))return;del.disabled=true;try{await api('/api/library/delete',{url:del.dataset.deleteAsset});runsTag='';await poll();toast('Item moved to local trash.');}catch(err){fail(err);del.disabled=false;}return;}
  const sound=e.target.closest('[data-soundtrack]');if(sound){workshops.adoptVideo(sound.dataset.soundtrack);page='workflows';show();$('#soundtrack-workflow')?.scrollIntoView({block:'start',behavior:'smooth'});return;}
  const guide=e.target.closest('[data-guide]');if(guide){e.preventDefault();openGuide(guide.dataset.guide);return;}
  if(e.target.closest('[data-close-guide]')){$('#guide-dialog').close();return;}
  const voiceExample=e.target.closest('[data-voice-example]');
  if(voiceExample){
    const mode=voiceExample.dataset.voiceMode;
    if(task!==mode){task=mode;currentJob=null;sampleInput=null;exampleUndo=null;page='workbench';show();}
    try{await useExample(Number(voiceExample.dataset.voiceExample));}
    catch(error){$('#guide-dialog').close();fail(error);}
    return;
  }
  const example=e.target.closest('[data-example]');if(example){e.preventDefault();try{await useExample(Number(example.dataset.example));}catch(err){fail(err);}return;}
  if(e.target.closest('[data-show-onboarding]')){localStorage.removeItem('spindle-started');if($('#guide-dialog').open)$('#guide-dialog').close();if(page!=='workbench'){page='workbench';show();}$('#onboarding')?.remove();$('.workspace-toolbar')?.insertAdjacentHTML('afterend',onboardingHTML());return;}
  if(e.target.closest('[data-dismiss-onboarding]')){localStorage.setItem('spindle-started','yes');$('#onboarding')?.remove();return;}
  if(e.target.closest('[data-clear-sample]')){sampleInput=null;renderSampleStatus();return;}
  if(e.target.closest('[data-clear-file]')){$('#input-file').value='';renderSampleStatus();return;}
  if(e.target.closest('[data-undo-example]')&&exampleUndo?.task===task){for(const [k,v]of Object.entries(exampleUndo.values))if($('#'+k)&&v!==undefined)$('#'+k).value=v;sampleInput=exampleUndo.sample;if(task==='speech'){selectedModel=exampleUndo.model;$('#model').value=selectedModel;modelNote();renderModelLoad();}exampleUndo=null;renderSampleStatus();resizePrompt();$('#example-undo').innerHTML='';return;}
  const action=e.target.closest('[data-recovery]');if(action){if(action.dataset.recovery==='guide')openGuide();else{page=action.dataset.recovery;show();}}
});
bind('#open-guide','click',()=>openGuide());$('#open-guide').disabled=false;

function closeNavigation(){if($('#navigation-dialog').open)$('#navigation-dialog').close();}
bind('#open-navigation','click',()=>{const slot=$('#mobile-navigation');slot.innerHTML='<nav aria-label="Main navigation">'+$('#nav').innerHTML+'</nav><p class="mobile-connection">'+esc($('#connection').textContent)+'</p>';slot.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;librarySelection='';show();});$('#navigation-dialog').showModal();});
bind('#close-navigation','click',closeNavigation);
bind('#navigation-dialog','click',e=>{if(e.target===$('#navigation-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeNavigation();}});
const fitViewport=()=>document.documentElement.style.setProperty('--app-height',(window.visualViewport?.height || window.innerHeight)+'px');
window.visualViewport?.addEventListener('resize',fitViewport);window.addEventListener('resize',fitViewport);fitViewport();
document.querySelectorAll('#nav [data-page]').forEach(b=>b.onclick=()=>{page=b.dataset.page;librarySelection='';show();});
bind('#refresh','click',()=>refresh());bind('#close-dialog','click',()=>$('#model-dialog').close());
let searchPrompts=[];
globalSearch?.mountGlobalSearch({
  getPages:()=>searchPages,
  getItems:()=>globalSearch.searchItems({pages:searchPages,runs,workflows:saved,prompts:searchPrompts,models:state?.models}),
  onOpen:refreshSearch=>{
    void Promise.allSettled([
      poll(),api('/api/workflows').then(workflows=>{saved=workflows;}),
      import('./prompt-dex.mjs').then(module=>{searchPrompts=module.searchPromptDex(chatStorage);}),
    ]).then(refreshSearch);
  },
  async onChoose(result){
    if(result.type==='prompt'||result.id==='prompt-dex'&&result.type==='page'){await openPromptDex(result.type==='prompt'?result.id:undefined);return;}
    librarySelection='';
    if(result.type==='page'){
      if(result.id!==page){page=result.id;show();}
      else if(page==='library')libraryPage();
      return;
    }
    if(result.type==='meeting'){
      page='meeting';show();await openMeetingDesk(result);return;
    }
    if(result.type==='model'){
      if(state?.models.some(model=>model.id===result.id)){page='models';show();modelDetails(result.id);}
      return;
    }
    if(result.type==='workflow'){
      const match=saved.find(item=>item.id===result.id);
      if(state&&match){workflow=structuredClone(match);page='workflows';show();$('#workflow-builder').open=true;$('#workflow-name').focus();}
      else toast('Open Connection to load the workflow editor.');
      return;
    }
    librarySelection=result.id;page='library';show();
    const card=$('#runs .run-card');
    if(card){card.tabIndex=-1;card.focus({preventScroll:true});card.scrollIntoView({block:'start'});}
  },
});
const requestedMuseum=new URL(location.href).searchParams.get('museum');
if(/^[a-f0-9-]{36}\.html$/.test(requestedMuseum || ''))location.replace('/api/museum/preview/'+requestedMuseum);
else{
  connectionInfo=await api('/api/connection');if(connectionInfo.keyPresent)await refresh();else{$('#connection').textContent='Connect your Tiiny';$('#resident').textContent='Endpoint and key are all you need.';page='connection';show();}await poll();async function pollAgain(){await poll();setTimeout(pollAgain,runs.some(r=>['queued','running'].includes(r.status))?600:2500);}setTimeout(pollAgain,2500);
  window.addEventListener('pageshow',()=>void poll());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
}
