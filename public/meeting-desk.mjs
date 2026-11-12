import {transcriptionFile} from './audio.js';

const maxSeconds=1800;
const previewSeconds=10;
import {meetingLines,meetingClock as clock} from './meeting-transcript.mjs';
import {chatMarkdown} from './chat-ui.mjs';
import {packetKinds,packetMarkdown,packetRows} from './meeting-packet.mjs';
import {artifactName,downloadArtifact} from './artifact-download.mjs';
export {meetingLines};

export function meetingMatches(lines,terms){
  const patterns=terms.split(',').map(term=>term.trim()).filter(Boolean).slice(0,20)
    .map(term=>[term,new RegExp('(?<![\\p{L}\\p{N}_])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\p{L}\\p{N}_])','iu')]);
  return lines.flatMap((line,index)=>{
    const matches=[...new Set(patterns.filter(([,pattern])=>pattern.test(line.text)).map(([term])=>term))];
    return matches.length?[{line,index,matches}]:[];
  });
}
export function meetingQuery(text,matches){
  if(matches.some(term=>term.toLowerCase()==='research')){
    const clause=text.match(/\bresearch\s+([^.!?;\n]+)/i)?.[1].trim();
    if(clause)return clause.slice(0,160);
  }
  return matches.join(' ');
}

export function createMeetingDesk({api,escape:esc,getRuns,modelOptions,preferred,isLoaded,onModelLoaded,onQueued,onRunChanged}){
  let root=null,recorder=null,source=null,timer=null,starting=false,busy=false,recording=null;
  let title='',model='',terms='research',selected='',revision='',status='',providerBusy=false,visible=false;
  let previewEnabled=false,preview=null,previewPending=false,loadingModel=false,requestingSummary=false;
  let cancellingSummary='';
  const summaryErrors=new Map();
  const packetDrafts=new Map();
  let shownPacket='';
  let captureView=0,pendingSeek=null,returnToPacket=null;
  const research=new Map();
  const el=selector=>root?.querySelector(selector);
  const tell=value=>{status=value;if(el('#meeting-status'))el('#meeting-status').textContent=value;};
  const stop=()=>{if(recorder?.state==='recording')recorder.stop();};
  function syncControls(){
    if(!visible||!root?.isConnected)return;
    el('#meeting-record').disabled=starting||!!recorder||busy||loadingModel;
    el('#meeting-stop').disabled=!recorder||recorder.state!=='recording';
    el('#meeting-transcribe').disabled=!recording||busy||starting||!!recorder||!model||loadingModel;
    el('#meeting-file').disabled=starting||busy||!!recorder;
    el('#meeting-source').disabled=starting||!!recorder;
    el('#meeting-preview-toggle').disabled=starting||!!recorder||busy;
    el('#meeting-model').disabled=starting||!!recorder||busy||loadingModel;
    el('#meeting-load-model').hidden=!previewEnabled||!model||isLoaded(model);
    el('#meeting-load-model').disabled=starting||!!recorder||busy||loadingModel;
    el('#meeting-input-name').textContent=recording?.name||'Choose an audio file or start recording.';
  }
  function renderPreview(){
    if(!visible||!root?.isConnected)return;
    el('#meeting-preview').hidden=!preview;
    if(!preview)return;
    el('#meeting-preview-status').textContent=preview.status;
    const hits=new Map(meetingMatches(preview.lines,terms).map(match=>[match.index,match.matches]));
    el('#meeting-preview-lines').innerHTML=preview.lines.map((line,index)=>
      `<article><small>Around ${clock(line.at)}</small>${hits.has(index)?' <strong class="pill live">'+esc(hits.get(index).join(', '))+'</strong>':''}<p>${esc(line.text)}</p></article>`).join('');
  }
  function stopPreview(message){
    if(!preview)return;
    clearTimeout(preview.timer);
    if(preview.recorder?.state==='recording')preview.recorder.stop();
    preview.recorder=null;
    if(preview.running){preview.running=false;preview.status=message;renderPreview();}
  }
  function previewClip(stream,session){
    if(!session.running)return;
    const at=(performance.now()-session.started)/1000;
    const clip=new MediaRecorder(stream);
    session.recorder=clip;
    const chunks=[];
    clip.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    clip.onstop=async()=>{
      if(!session.running||preview!==session||!chunks.length)return;
      if(previewPending){session.status='Preview skipped a clip while Tiiny was processing.';renderPreview();return;}
      previewPending=true;
      try{
        session.status='Transcribing audio around '+clock(at)+'…';renderPreview();
        const file=await transcriptionFile(new File(chunks,'Live preview',{type:clip.mimeType}),20);
        if(!session.running||preview!==session)return;
        const result=await api('/api/meeting/preview',{file,model:session.model});
        if(!session.running||preview!==session)return;
        if(result.status==='unloaded'){stopPreview('Load the selected transcription model, then start a new recording to preview it.');return;}
        if(result.text)session.lines.push({at,text:result.text});
        session.status=result.status==='busy'?'Tiiny is busy. Preview skipped this clip.':result.text?'Listening for the next clip…':'Tiiny returned no text for this clip. Listening…';
        renderPreview();
      }catch(error){
        if(session.running&&preview===session){session.status=error.message;renderPreview();}
      }finally{previewPending=false;}
    };
    clip.onerror=()=>{if(preview===session)stopPreview('Live preview stopped. The full recording can still be transcribed.');};
    clip.start();
    session.timer=setTimeout(()=>{
      if(!session.running)return;
      try{clip.stop();previewClip(stream,session);}
      catch(error){stopPreview(error.message);}
    },previewSeconds*1000);
  }
  async function startCapture(){
    const mode=el('#meeting-source').value,view=captureView;
    starting=true;syncControls();
    try{
      if(!navigator.mediaDevices||typeof MediaRecorder==='undefined')throw Error('This browser cannot record audio here. Import a recording instead.');
      source=mode==='tab'?await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}):await navigator.mediaDevices.getUserMedia({audio:true});
      if(!visible||view!==captureView||!root.isConnected){source.getTracks().forEach(track=>track.stop());source=null;return;}
      const audio=source.getAudioTracks();
      if(!audio.length)throw Error('The shared source has no audio. Choose a tab and enable audio sharing.');
      const stream=new MediaStream(audio);
      recorder=new MediaRecorder(stream);
      const chunks=[];
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=()=>{tell('Audio recording stopped because the browser reported an error.');stop();};
      recorder.onstop=()=>{
        stopPreview('Preview stopped. Transcribe the full recording for a saved transcript.');
        const mime=recorder.mimeType,extension=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';
        source.getTracks().forEach(track=>track.stop());
        source=null;recorder=null;clearTimeout(timer);
        if(chunks.length)recording=new File(chunks,'Meeting recording.'+extension,{type:mime});
        tell(chunks.length?'Recording ready. Choose Transcribe to send it to Tiiny.':'The browser returned no recorded audio.');
        syncControls();
      };
      for(const track of source.getTracks())track.addEventListener('ended',stop,{once:true});
      recorder.start(1000);timer=setTimeout(stop,maxSeconds*1000);
      tell('Recording '+(mode==='tab'?'shared audio':'microphone')+'…');
      preview=previewEnabled?{model,running:!!model,started:performance.now(),lines:[],status:model?'Listening for the first 10-second clip…':'Choose a transcription model for live preview.'}:null;
      renderPreview();
      if(preview){try{previewClip(stream,preview);}catch(error){stopPreview(error.message);}}
    }catch(error){
      source?.getTracks().forEach(track=>track.stop());source=null;recorder=null;
      tell(error.name==='NotAllowedError'?'Audio access was canceled or denied. You can import a recording.':error.message);
    }finally{starting=false;syncControls();}
  }
  function renderMatches(run,lines){
    const cards=el('#meeting-matches');
    const matches=meetingMatches(lines,terms);
    cards.innerHTML=matches.length?matches.map(({line,index,matches:words})=>`<article class="meeting-hit">
      <button class="text-button" type="button" data-meeting-seek="${line.at}">${line.approximate?'Around ':''}${clock(line.at)}</button>
      <strong>${esc(words.join(', '))}</strong><p>${esc(line.text)}</p>
      <button class="button quiet" type="button" data-meeting-research="${index}">Prepare research</button></article>`).join(''):
      '<p class="help">Matches appear here as the transcript arrives.</p>';
    const result=research.get(run?.id),target=el('#meeting-research-results');
    target.innerHTML=result?`<h3>Results for ${esc(result.query)}</h3><ul>${result.sources.map(item=>`<li><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a><p>${esc(item.snippet)}</p></li>`).join('')}</ul>`:'';
  }
  function update(force=false){
    if(!visible||!root?.isConnected)return;
    const runs=getRuns().filter(run=>run.meeting);
    if(!runs.some(run=>run.id===selected))selected=runs[0]?.id||'';
    const run=runs.find(item=>item.id===selected);
    const summaries=getRuns().filter(item=>item.meetingSummaryOf===selected).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const summary=summaries.find(item=>!item.meetingPacket);
    const packet=summaries.find(item=>item.meetingPacket&&item.status==='completed');
    const latest=summaries[0];
    const next=JSON.stringify([runs.map(item=>[item.id,item.status]),selected,run?.outputs.length,run?.phase,run?.error,run?.restoreError,latest?.id,latest?.status,latest?.phase,latest?.error,latest?.outputs.length,packet?.id,packet?.packetReview]);
    if(!force&&next===revision)return;
    revision=next;
    const select=el('#meeting-runs');
    select.replaceChildren(...(runs.length?runs.map(item=>new Option(item.name,item.id,item.id===selected,item.id===selected)):[new Option('No saved meetings','')]));
    const player=el('#meeting-player');
    const url=run?.meeting.recording.url||'';
    if(url!==(player.getAttribute('src')||'')){
      pendingSeek=null;
      player.pause();
      if(url)player.setAttribute('src',url);else player.removeAttribute('src');
    }
    player.hidden=!url;
    const progress=el('#meeting-progress');
    const total=run?.steps.length||0,done=run?.outputs.length||0;
    progress.hidden=!total;
    if(total){progress.max=total;progress.value=done;}
    const phase=run?.status==='running'?(run.phase||'Transcribing'):run?.status;
    el('#meeting-run-status').textContent=run?[phase,total?`${done} of ${total} audio sections processed`:null,run.error,run.restoreError].filter(Boolean).join(' · '):'';
    const lines=meetingLines(run);
    el('#meeting-transcript').innerHTML=lines.length?lines.map((line,index)=>`<article data-transcript-line="${index}"><button class="text-button" type="button" data-meeting-seek="${line.at}">${line.approximate?'Around ':''}${clock(line.at)}</button>${line.speaker?' <strong>'+esc(line.speaker)+'</strong>':''}<p>${esc(line.text)}</p></article>`).join(''):
      `<p class="help">${!run?'Choose a recording, then transcribe it to start the timeline.':done?'Tiiny returned no transcript text.':phase==='queued'||run.status==='running'?'Transcript text appears here as each audio section finishes.':'No transcript text was saved for this run.'}</p>`;
    renderMatches(run,lines);
    el('#meeting-summary').hidden=run?.status!=='completed'||!lines.length;
    const summaryActive=['queued','running'].includes(latest?.status),stopSummary=el('#meeting-summary-stop');
    const unavailable=requestingSummary||summaryActive||!el('#meeting-summary-model').value;
    el('#meeting-summary-submit').disabled=unavailable;
    el('#meeting-packet-submit').disabled=unavailable;
    stopSummary.hidden=!summaryActive||latest?.phase==='Restoring your loaded models'||!!latest?.outputs.length;
    stopSummary.disabled=!!cancellingSummary;
    stopSummary.dataset.run=summaryActive?latest.id:'';
    const output=summary?.outputs.at(-1);
    el('#meeting-summary-status').textContent=summaryErrors.get(selected)||(latest?[latest.status==='running'?latest.phase||'Drafting':latest.status,latest.error,latest.restoreError,latest.outputs.at(-1)?.finishReason==='length'?'The response reached the model’s allowance and may be incomplete.':null].filter(Boolean).join(' · '):'');
    el('#meeting-summary-output').innerHTML=output?.text?chatMarkdown(output.text):'';
    renderPacket(run,packet,lines);
  }
  function renderPacket(run,packet,lines){
    const target=el('#meeting-packet');
    if(!packet){shownPacket='';target.replaceChildren();return;}
    if(shownPacket===packet.id)return;
    shownPacket=packet.id;
    try{
      if(!packetDrafts.has(packet.id)){
        packetDrafts.set(packet.id,packetRows(packet.outputs.at(-1)?.text,lines).map((row,index)=>({...row,...packet.packetReview?.[index]})));
      }
    }catch(error){target.textContent=error.message;return;}
    const rows=packetDrafts.get(packet.id);
    if(!rows.length){target.innerHTML='<p class="help">The draft contains no supported decisions, action items, or open questions.</p>';return;}
    const title=run.name.replace(/^Meeting · /,'');
    target.innerHTML=`<h3>Review minutes</h3><p class="help">Check each item against the recording. Clear its text to omit it from the export.</p>
      <div class="meeting-packet-items">${rows.map((row,index)=>{
        const source=lines[row.line];
        const time=source?`<button class="text-button" type="button" data-packet-source="${row.line}">${source.approximate?'Around ':''}${clock(source.at)} · Check source</button>`:'<span class="help">No source line supplied</span>';
        return `<article><label class="field"><span>${packetKinds[row.kind]} ${index+1}</span><textarea rows="2" maxlength="1600" data-packet-text="${index}">${esc(row.text)}</textarea></label><div class="packet-item-actions">${time}<label><input type="checkbox" data-packet-reviewed="${index}" ${row.reviewed?'checked':''}> Reviewed</label></div></article>`;
      }).join('')}</div>
      <div class="actions"><button class="button primary" type="button" id="meeting-packet-export">Download minutes (.md)</button><button class="button" type="button" id="meeting-packet-save">Save review</button></div>
      <p class="help">Includes the visible minutes text, review status and source times. Recording audio stays in Spindle.</p><p class="help" role="status" id="meeting-packet-status"></p>`;
    const status=target.querySelector('#meeting-packet-status');
    target.oninput=event=>{
      const {packetText,packetReviewed}=event.target.dataset;
      if(packetText!==undefined){
        rows[packetText].text=event.target.value;
        rows[packetText].reviewed=false;
        target.querySelector(`[data-packet-reviewed="${packetText}"]`).checked=false;
      }
      if(packetReviewed!==undefined)rows[packetReviewed].reviewed=event.target.checked;
      status.textContent='Unsaved review changes.';
    };
    target.querySelector('#meeting-packet-export').onclick=()=>{
      if(!rows.some(row=>row.text.trim())){status.textContent='Keep at least one item to download.';return;}
      downloadArtifact(artifactName(title,'meeting')+'-minutes.md',packetMarkdown(title,rows,lines),'text/markdown;charset=utf-8');
      status.textContent='Minutes downloaded.';
    };
    target.querySelector('#meeting-packet-save').onclick=async event=>{
      const button=event.currentTarget;
      const edits=rows.map(({text,reviewed})=>({text,reviewed}));
      button.disabled=true;status.textContent='Saving review…';
      try{
        await api('/api/meeting/packet-review',{id:packet.id,edits});
        status.textContent=edits.every((edit,index)=>edit.text===rows[index].text&&edit.reviewed===rows[index].reviewed)?'Review saved.':'Unsaved review changes.';
      }catch(error){status.textContent=error.message;}
      finally{button.disabled=false;}
    };
  }
  function seekRecording(at){
    const player=el('#meeting-player');
    if(!player||player.hidden||!Number.isFinite(at)||at<0)return;
    if(!player.readyState){pendingSeek=at;return;}
    pendingSeek=null;
    player.currentTime=Number.isFinite(player.duration)?Math.min(at,player.duration):at;
  }
  function openRun(id,at){
    const run=getRuns().find(item=>item.id===id&&item.meeting);
    if(!visible||!run)return;
    selected=id;el('#meeting-search').hidden=true;update(true);
    const index=Number.isFinite(at)?meetingLines(run).findIndex(line=>line.at===at):-1;
    const button=index>=0?el('[data-transcript-line="'+index+'"] button'):el('#meeting-runs');
    if(index>=0)seekRecording(at);
    button?.focus({preventScroll:true});button?.scrollIntoView({block:'center'});
  }
  function mount(element){
    root=element;revision='';shownPacket='';visible=true;
    root.innerHTML=`<section class="meeting-desk"><div><h1>Meeting Desk</h1><p class="lead">Record or import audio, then jump from the transcript to the moments you want to research.</p></div>
      <section class="panel panel-body meeting-controls">
        <label class="field"><span>Meeting title</span><input id="meeting-title" maxlength="100" value="${esc(title)}" placeholder="Untitled meeting"></label>
        <label class="field"><span>Transcription model</span><select id="meeting-model">${modelOptions('asr',model||preferred('asr'))}</select></label>
        <label class="field"><span>Audio source</span><select id="meeting-source"><option value="mic">Microphone</option><option value="tab">Shared tab audio</option></select></label>
        <label class="field"><span>Import a recording</span><input id="meeting-file" type="file" accept="audio/*,video/webm,video/mp4"></label>
        <label class="meeting-preview-toggle"><input id="meeting-preview-toggle" type="checkbox" ${previewEnabled?'checked':''}> Preview transcript while recording</label>
        <p class="help">Live preview sends short audio clips to Tiiny using an already loaded transcription model. Use Transcribe after recording to save the full transcript.</p>
        <div class="actions"><button id="meeting-record" class="button" type="button">Start recording</button><button id="meeting-stop" class="button quiet" type="button">Stop</button>
        <button id="meeting-load-model" class="button quiet" type="button" hidden>Load model for preview</button>
        <button id="meeting-transcribe" class="button primary" type="button">Transcribe</button></div>
        <p id="meeting-input-name" class="help"></p><p id="meeting-status" role="status" class="help">${esc(status)}</p>
        <p class="help">Up to 30 minutes per recording. Shared tab audio captures the call track. Microphone captures the room or your voice. Recordings and transcripts save locally.</p>
      </section>
      <div class="meeting-grid"><section class="panel panel-body">
        <h2>Transcript</h2><section id="meeting-preview" hidden><h3>Live preview</h3><p id="meeting-preview-status" class="help" role="status"></p><div id="meeting-preview-lines"></div></section>
        <label class="field"><span>Saved meeting</span><select id="meeting-runs"></select></label>
        <audio id="meeting-player" controls preload="metadata" hidden></audio><progress id="meeting-progress" aria-label="Audio sections processed" hidden></progress><p id="meeting-run-status" class="help" role="status"></p>
        <details id="meeting-summary" class="section-gap" hidden><summary>Summary &amp; minutes</summary>
          <form id="meeting-summary-form" class="section-gap"><label class="field"><span>Chat model</span><select id="meeting-summary-model">${modelOptions('chat',preferred('chat'))}</select></label>
          <p class="help">Sends the transcript to Tiiny with web search off. Spindle may switch models and restore them afterward. Check decisions, timestamps and action items against the transcript.</p>
          <div class="actions"><button id="meeting-summary-submit" class="button" type="submit">Generate summary</button>
          <button id="meeting-packet-submit" class="button" type="submit">Draft minutes</button>
          <button id="meeting-summary-stop" class="button quiet" type="button" hidden>Stop summary</button></div></form>
          <p id="meeting-summary-status" role="status" class="help"></p><div id="meeting-summary-output"></div><div id="meeting-packet"></div>
        </details>
        <div id="meeting-transcript"></div>
        <p class="help">Voice labels appear only if Tiiny returns speaker segments. Labels are anonymous and can reset between sections.</p>
        </section>
        <aside class="panel panel-body"><h2>Research</h2>
          <label class="field"><span>Hotwords and phrases, separated by commas</span><input id="meeting-terms" maxlength="300" value="${esc(terms)}"></label>
          <div id="meeting-matches"></div><form id="meeting-search" hidden>
          <label class="field"><span>Query to send to DuckDuckGo</span><input id="meeting-query" required maxlength="500"></label>
          <button class="button" type="submit">Search the web</button><p class="help">Only this query is sent to the provider.</p></form>
          <div id="meeting-research-results"></div>
        </aside></div></section>`;
    model=el('#meeting-model').value;
    el('#meeting-title').oninput=event=>{title=event.target.value;};
    el('#meeting-model').onchange=event=>{model=event.target.value;syncControls();};
    el('#meeting-preview-toggle').onchange=event=>{previewEnabled=event.target.checked;syncControls();};
    el('#meeting-load-model').onclick=async()=>{
      const chosen=model;
      loadingModel=true;syncControls();tell('Loading the transcription model…');
      try{
        await api('/api/model',{id:chosen,action:'start'});
        await onModelLoaded();
        if(visible)el('#meeting-model').innerHTML=modelOptions('asr',model);
        tell('Transcription model loaded. Start recording to preview text.');
      }catch(error){tell(error.message);}
      finally{loadingModel=false;syncControls();}
    };
    el('#meeting-file').onchange=event=>{recording=event.target.files[0]||null;syncControls();};
    el('#meeting-record').onclick=()=>void startCapture();
    el('#meeting-stop').onclick=stop;
    el('#meeting-player').onloadedmetadata=()=>{if(pendingSeek!==null)seekRecording(pendingSeek);};
    el('#meeting-player').onplay=()=>{const button=el('[data-packet-play]');if(button)button.textContent='Pause recording';};
    el('#meeting-player').onpause=()=>{const button=el('[data-packet-play]');if(button)button.textContent='Play from here';};
    el('#meeting-transcribe').onclick=async()=>{
      if(!recording||busy)return;
      busy=true;syncControls();tell('Preparing audio for Tiiny…');
      try{
        const file=await transcriptionFile(recording,maxSeconds);
        const run=await api('/api/meeting/transcribe',{title:title||recording.name,file,model});
        selected=run.id;recording=null;preview=null;renderPreview();onQueued(run);tell('Recording submitted to Tiiny.');update(true);
      }catch(error){tell(error.message);}
      finally{busy=false;syncControls();}
    };
    el('#meeting-runs').onchange=event=>{selected=event.target.value;el('#meeting-search').hidden=true;update(true);};
    el('#meeting-terms').oninput=event=>{
      terms=event.target.value;const run=getRuns().find(item=>item.id===selected);
      renderMatches(run,meetingLines(run));renderPreview();
    };
    el('#meeting-summary-model').onchange=()=>update(true);
    el('#meeting-summary-stop').onclick=async event=>{
      const id=event.currentTarget.dataset.run,meeting=selected;
      if(!id||cancellingSummary)return;
      cancellingSummary=id;summaryErrors.delete(meeting);update(true);
      try{await api('/api/cancel/'+encodeURIComponent(id),{});}
      catch(error){summaryErrors.set(meeting,error.message);}
      finally{await onRunChanged();cancellingSummary='';update(true);}
    };
    el('#meeting-summary-form').onsubmit=async event=>{
      event.preventDefault();
      const id=selected,chosen=el('#meeting-summary-model').value;
      if(requestingSummary||!id||!chosen)return;
      requestingSummary=true;summaryErrors.delete(id);update(true);
      const packet=event.submitter?.id==='meeting-packet-submit';
      el('#meeting-summary-status').textContent=packet?'Preparing minutes…':'Preparing summary…';
      try{onQueued(await api('/api/meeting/summary',{id,model:chosen,packet}));}
      catch(error){summaryErrors.set(id,error.message);}
      finally{requestingSummary=false;update(true);}
    };
    root.querySelector('.meeting-grid').onclick=event=>{
      const packetSource=event.target.closest('[data-packet-source]');
      if(packetSource){
        const source=el(`[data-transcript-line="${packetSource.dataset.packetSource}"] button`);
        if(source){
          seekRecording(Number(source.dataset.meetingSeek));
          returnToPacket=packetSource;
          el('.packet-source-actions')?.remove();
          const actions=document.createElement('div');
          actions.className='actions packet-source-actions';
          actions.innerHTML='<button type="button" class="text-button" data-packet-play>Play from here</button><button type="button" class="text-button" data-packet-back>Back to minutes</button>';
          if(!el('#meeting-player').paused)actions.firstElementChild.textContent='Pause recording';
          source.parentElement.append(actions);
          source.focus({preventScroll:true});source.scrollIntoView({block:'center'});
        }
        return;
      }
      if(event.target.closest('[data-packet-back]')){
        if(returnToPacket?.isConnected){returnToPacket.focus({preventScroll:true});returnToPacket.scrollIntoView({block:'center'});}
        return;
      }
      const play=event.target.closest('[data-packet-play]');
      if(play){
        const player=el('#meeting-player');
        if(player.paused){
          seekRecording(Number(play.closest('article').querySelector('[data-meeting-seek]').dataset.meetingSeek));
          player.play().catch(()=>{tell('The recording could not be played.');});
        }else player.pause();
        return;
      }
      const seek=event.target.closest('[data-meeting-seek]');
      if(seek){seekRecording(Number(seek.dataset.meetingSeek));return;}
      const button=event.target.closest('[data-meeting-research]');
      if(button){
        const run=getRuns().find(item=>item.id===selected),line=meetingLines(run)[Number(button.dataset.meetingResearch)];
        const words=line&&meetingMatches([line],terms)[0]?.matches;
        if(!words)return;
        el('#meeting-search').hidden=false;el('#meeting-query').value=meetingQuery(line.text,words);el('#meeting-query').focus();
      }
    };
    el('#meeting-search').onsubmit=async event=>{
      event.preventDefault();
      if(providerBusy)return;
      const id=selected,query=el('#meeting-query').value.trim();
      if(!query)return;
      providerBusy=true;const button=event.target.querySelector('button');button.disabled=true;
      try{research.set(id,await api('/api/meeting/search',{query}));update(true);tell('Research results ready.');}
      catch(error){tell(error.message);}
      finally{providerBusy=false;button.disabled=false;}
    };
    update(true);renderPreview();syncControls();
  }
  return {mount,update,openRun,leave(){visible=false;captureView++;stopPreview('Preview stopped.');stop();}};
}
