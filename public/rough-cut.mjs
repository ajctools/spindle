const downloads=await import('./artifact-download.mjs').catch(()=>null);

export function cutSheet(segments,cuts){
  const time=seconds=>{
    const ms=Math.round(seconds*1000);
    const whole=Math.floor(ms/1000);
    return [Math.floor(whole/3600),Math.floor(whole/60)%60,whole%60].map(part=>String(part).padStart(2,'0')).join(':')+'.'+String(ms%1000).padStart(3,'0');
  };
  const rows=segments.map((segment,index)=>`Take ${index+1}   ${time(segment.from)} → ${time(segment.to)}   ${cuts.has(index)?'CUT':'KEEP'}`);
  return ['Rough Cut · Cut sheet','Times are relative to the original recording.','',...rows,''].join('\n');
}

export function createRoughCut({api,escape,modelOptions,preferred,readFile,poll,toast}){
  let root,jobId,shown,source='';
  const decisions=new Map();
  const $=q=>root.querySelector(q);
  function mount(element,runs){
    root=element;shown=null;
    const assets=[...new Map(runs.flatMap(r=>[...(r.outputs||[]),r.finalOutput].flatMap(o=>o?.assets||[])).filter(a=>/\.(mp4|wav|mp3)$/.test(a.url)).map(a=>[a.url,a])).values()];
    root.innerHTML=`<details class="panel workflow-disclosure" id="rough-cut-workflow"><summary><span><small>TIIDY TIINY · KEEP THE GOOD TAKE</small><strong>Recording → rough cut</strong></span><span>Reviewable edits</span></summary><div class="panel-body"><p class="lead">Find false starts and retakes, check the suggested cuts, and export a new recording.</p><p class="help">Use an MP4, WAV or MP3 up to 2 minutes and 40 MiB. Leave a short pause before a retake so Spindle can split the attempts. FFmpeg and FFprobe are required.</p><label class="field"><span>Saved recording</span><select id="cut-source"><option value="">Choose from the library…</option>${assets.map(a=>`<option value="${escape(a.url)}" ${source===a.url?'selected':''}>${escape(a.label||'Recording')} · ${escape(a.url.slice(8,16))}</option>`).join('')}</select></label><label class="field"><span>Or upload a recording</span><input id="cut-file" type="file" accept=".mp4,.wav,.mp3"></label><div class="field-row"><label class="field"><span>Transcription model</span><select id="cut-asr">${modelOptions('asr',preferred('asr'))}</select></label><label class="field"><span>Decision model</span><select id="cut-decision">${modelOptions('decision',preferred('decision'))}</select></label></div><label class="checkline"><input id="cut-switch" type="checkbox" checked> Switch models if needed, then restore the starting models</label><button class="button primary" id="cut-analyze">Find retakes</button><p class="help" id="cut-status" role="status"></p><div id="cut-review"></div></div></details>`;
    $('#cut-analyze').onclick=async()=>{
      const button=$('#cut-analyze'),status=$('#cut-status');
      button.disabled=true;status.textContent='Preparing recording…';
      try{
        const result=await api('/api/rough-cut/analyze',{source:$('#cut-source').value,file:await readFile($('#cut-file'),'video'),asr:$('#cut-asr').value,decision:$('#cut-decision').value,switchModels:$('#cut-switch').checked});
        jobId=result.id;shown=null;$('#cut-review').replaceChildren();status.textContent='Analysis queued.';await poll();
      }catch(e){status.textContent=e.message;button.disabled=false;}
    };
    update(runs);
  }
  function open(id){
    jobId=id;shown=null;
    if(root?.isConnected)$('#rough-cut-workflow').open=true;
  }
  function update(runs){
    if(!root?.isConnected)return;
    const j=jobId?runs.find(j=>j.id===jobId):runs.find(j=>j.roughCut);
    if(!j?.roughCut)return;
    const busy=['running','queued'].includes(j.status);
    $('#cut-analyze').disabled=busy;$('#cut-status').textContent=busy?(j.phase||'Waiting in queue…'):j.error||j.restoreError||'';
    if(j.status!=='completed'||shown===j.id||!j.roughCut.segments)return;
    shown=j.id;
    const {video,segments,sourceAsset}=j.roughCut,tag=video?'video':'audio';
    const label={keep:'Keep',review:'Review suggested',replaced:'Possible retake',false_start:'Possible false start'};
    const cuts=decisions.get(j.id) || new Set(segments.flatMap((segment,index)=>segment.cut?[index]:[]));
    decisions.set(j.id,cuts);
    $('#cut-review').innerHTML=`<h3>Review ${segments.length} ${segments.length===1?'take':'takes'}</h3><p class="help">${segments.length===1?'No separate retake was found. Try pausing before each new attempt.':'Play each take and choose which ones to cut.'}</p><${tag} id="cut-player" controls preload="metadata" src="${escape(sourceAsset)}"></${tag}><ol class="cut-takes">${segments.map((s,i)=>`<li><div><button type="button" class="button quiet" data-seek="${s.from}" data-end="${s.to}">Play take ${i+1} · ${s.from.toFixed(1)}s</button><span class="pill">${label[s.choice]||'Review'}</span></div><p>${escape(s.text||'No speech recognized')}</p><label class="checkline"><input type="checkbox" data-cut="${i}" ${cuts.has(i)?'checked':''}> Cut this take</label></li>`).join('')}</ol>
      <div class="actions"><button class="button primary" id="cut-export">Export reviewed cut</button>${downloads?'<button class="button" id="cut-sheet">Download cut sheet (.txt)</button>':''}</div><p id="cut-export-status" class="help" role="status"></p><div id="cut-result"></div>`;
    const player=$('#cut-player');
    let end=null;
    player.addEventListener('timeupdate',()=>{if(end!==null&&player.currentTime>=end){player.pause();end=null;}});
    root.querySelectorAll('[data-seek]').forEach(b=>b.onclick=()=>{end=Number(b.dataset.end);player.currentTime=Number(b.dataset.seek);player.play().catch(()=>{end=null;});});
    root.querySelectorAll('[data-cut]').forEach(input=>input.onchange=()=>{
      const index=Number(input.dataset.cut);
      if(input.checked)cuts.add(index);else cuts.delete(index);
    });
    if(downloads)$('#cut-sheet').onclick=()=>{
      downloads.downloadArtifact('rough-cut-'+j.id.slice(0,8)+'.txt',cutSheet(segments,cuts));
      toast('Cut sheet downloaded.');
    };
    $('#cut-export').onclick=async()=>{
      const button=$('#cut-export'),status=$('#cut-export-status'),result=$('#cut-result');
      button.disabled=true;status.textContent='Exporting…';
      try{
        const output=await api('/api/rough-cut/export',{id:j.id,cuts:[...cuts]});
        status.textContent='Saved in Library & runs.';
        result.innerHTML=`<${tag} controls preload="metadata" src="${escape(output.url)}"></${tag}> <a class="button" href="${escape(output.url)}" download>Download reviewed cut</a>`;
        toast('Rough cut exported.');await poll();
      }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
    };
  }
  return {mount,update,open};
}
