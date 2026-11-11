import {transcriptionFile} from './audio.js';

const maxSeconds=1800;
const previewSeconds=10;
const clock=seconds=>[Math.floor(seconds/60),Math.floor(seconds%60)].map(value=>String(value).padStart(2,'0')).join(':');

export function meetingLines(run){
  return (run?.outputs||[]).flatMap((output,index)=>{
    const offset=index*run.meeting.chunkSeconds;
    const length=Math.min(run.meeting.chunkSeconds,run.meeting.duration-offset);
    const segments=Array.isArray(output.json?.segments)?output.json.segments:[];
    const timed=segments.filter(row=>Number.isFinite(row?.start)&&row.start>=0&&row.start<length&&typeof row.text==='string'&&row.text.trim());
    if(timed.length)return timed.map(row=>({at:offset+row.start,text:row.text.trim(),approximate:false}));
    const text=typeof output.text==='string'?output.text.trim():'';
    return text?[{at:offset,text,approximate:true}]:[];
  });
}

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

export function createMeetingDesk({api,escape:esc,getRuns,modelOptions,preferred,isLoaded,onModelLoaded,onQueued}){
  let root=null,recorder=null,source=null,timer=null,starting=false,busy=false,recording=null;
  let title='',model='',terms='research',selected='',revision='',status='',providerBusy=false,visible=false;
  let previewEnabled=false,preview=null,previewPending=false,loadingModel=false;
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
    el('#meeting-preview-lines').innerHTML=preview.lines.map(line=>
      `<article><small>Around ${clock(line.at)}</small><p>${esc(line.text)}</p></article>`).join('');
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
    const mode=el('#meeting-source').value,view=root;
    starting=true;syncControls();
    try{
      if(!navigator.mediaDevices||typeof MediaRecorder==='undefined')throw Error('This browser cannot record audio here. Import a recording instead.');
      source=mode==='tab'?await navigator.mediaDevices.getDisplayMedia({video:true,audio:true}):await navigator.mediaDevices.getUserMedia({audio:true});
      if(!visible||view!==root||!view.isConnected){source.getTracks().forEach(track=>track.stop());source=null;return;}
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
    const next=JSON.stringify([runs.map(item=>[item.id,item.status]),selected,run?.outputs.length,run?.phase,run?.error,run?.restoreError]);
    if(!force&&next===revision)return;
    revision=next;
    const select=el('#meeting-runs');
    select.replaceChildren(...(runs.length?runs.map(item=>new Option(item.name,item.id,item.id===selected,item.id===selected)):[new Option('No saved meetings','')]));
    const player=el('#meeting-player');
    const url=run?.meeting.recording.url||'';
    if(url!==player.getAttribute('src')){
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
    el('#meeting-transcript').innerHTML=lines.length?lines.map(line=>`<article><button class="text-button" type="button" data-meeting-seek="${line.at}">${line.approximate?'Around ':''}${clock(line.at)}</button><p>${esc(line.text)}</p></article>`).join(''):
      `<p class="help">${!run?'Choose a recording, then transcribe it to start the timeline.':done?'Tiiny returned no transcript text.':phase==='queued'||run.status==='running'?'Transcript text appears here as each audio section finishes.':'No transcript text was saved for this run.'}</p>`;
    renderMatches(run,lines);
  }
  function mount(element){
    root=element;revision='';visible=true;
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
        <div id="meeting-transcript"></div></section>
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
      renderMatches(run,meetingLines(run));
    };
    root.querySelector('.meeting-grid').onclick=event=>{
      const seek=event.target.closest('[data-meeting-seek]');
      if(seek){el('#meeting-player').currentTime=Number(seek.dataset.meetingSeek);return;}
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
  return {mount,update,leave(){visible=false;stopPreview('Preview stopped.');stop();}};
}
