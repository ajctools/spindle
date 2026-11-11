// The built-in, reviewable image-to-film workflow. Drafts live in memory only.
const defaults={text:'Qwen/Qwen-Image-2.1-PE-T2I',edit:'Qwen/Qwen-Image-2.1-PE-I2I',image:'Qwen/Qwen-Image-2.1',video:'lightx2v/MiniMax-H3-Turbo'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const imageOf=j=>j?.outputs?.filter(o=>o.task==='image').flatMap(o=>o.assets || []).find(a=>a.mime.startsWith('image/'));
export function createStudio({api,getState,outputHTML,onQueued,toast}){
  let root=null,currentId=null,sourceAsset=null,file=null,draft='',motion='',seconds=15,switchModels=true,acknowledged=false,tools=null,lastRuns=[],signature='',finished=new Set(),choices={};
  const $=s=>root?.querySelector(s),busy=j=>j&&['queued','running'].includes(j.status);
  function selected(key){
    if(choices[key])return choices[key];
    const task=['text','edit'].includes(key)?'chat':key,models=getState()?.models || [];
    return models.find(m=>m.id.toLowerCase()===defaults[key].toLowerCase()&&m.tasks.includes(task))?.id || defaults[key];
  }
  function modelSelect(key,label){
    const task=['text','edit'].includes(key)?'chat':key,ms=(getState()?.models || []).filter(m=>m.tasks.includes(task)),id=selected(key);
    return `<label class="field"><span>${label}</span><select data-studio-model="${key}">${ms.some(m=>m.id===id)?'':`<option value="${esc(id)}">${esc(id)} · unavailable</option>`}${ms.map(m=>`<option value="${esc(m.id)}" ${m.id===id?'selected':''}>${esc(m.name)}${m.installed?m.loaded?' · loaded':' · downloaded':' · download needed'}</option>`).join('')}</select></label>`;
  }
  function mount(element,runs){
    root=element;lastRuns=runs;signature='';
    if(!currentId){
      const latest=[...runs].filter(j=>j.studio).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
      if(latest){currentId=latest.id;finished.add(latest.id);sourceAsset=imageOf(latest)?.url || latest.film?.sourceAsset || null;}
    }
    root.innerHTML=`<section class="panel creative-studio" aria-labelledby="studio-title"><div class="panel-head"><div><div class="eyebrow">BUILT-IN WORKFLOW</div><h2 id="studio-title">Idea → image → film</h2></div><span class="pill">Create · refine · animate</span></div><div class="panel-body"><p class="lead">Start with a phrase or an image. Refine the picture, then bring it into motion.</p><div class="studio-grid section-gap"><div><label class="field"><span id="studio-prompt-label">Your image idea</span><textarea id="studio-prompt" rows="4" placeholder="A tiny museum hidden inside an old lighthouse…">${esc(draft)}</textarea></label><label class="field"><span>Starting image · optional</span><input id="studio-file" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="studio-source"></div><div class="actions"><button class="button primary" id="studio-create">Create image</button><button class="button quiet" id="studio-clear">Start a new image</button></div><p class="help" id="studio-path"></p></div><div><label class="field"><span>Movement / scene direction</span><textarea id="studio-motion" rows="4" placeholder="The camera moves slowly toward the lighthouse as the light sweeps across the sea…">${esc(motion)}</textarea></label><label class="field"><span>Final video length · 1–60 seconds</span><input id="studio-seconds" type="number" min="1" max="60" step="1" value="${seconds}"></label><p class="help" id="studio-length"></p><div id="studio-long-warning" class="studio-warning" ${seconds>30?'':'hidden'}><strong>This is a long device workload.</strong><p>More than 30 seconds of video can take a very long time and may fail. Each segment depends on the one before it. Completed clips are kept so you can resume.</p><label class="checkline"><input id="studio-acknowledge" type="checkbox" ${acknowledged?'checked':''}> I understand this may take a long time and may fail.</label></div><button class="button primary" id="studio-film">Make video</button><p class="help" id="studio-tools">Checking local video tools…</p><p class="help">Each new clip starts from the previous clip’s last frame. Appearance, motion, and audio may change at joins.</p></div></div><details class="section-gap"><summary>Workflow options · models and switching</summary><div class="studio-grid section-gap"><div>${modelSelect('text','Phrase → enhanced image prompt')}${modelSelect('edit','Image + instruction → enhanced edit')}</div><div>${modelSelect('image','Image generation and editing')}${modelSelect('video','Image → video')}</div></div><label class="checkline"><input id="studio-switch" type="checkbox" ${switchModels?'checked':''}> Switch models for this workflow, then restore my loaded models</label><p class="help">Switching can affect other clients. Use an idle device; restoration can fail after a disconnect.</p></details><p class="help privacy-inline">This workflow uses local inference with web search off. Drafts stay in this tab’s memory; runs, film reference images, and outputs are saved locally.</p><div id="studio-message" role="alert"></div><div id="studio-results" aria-live="polite"></div><div id="studio-history" class="studio-history"></div></div></section>`;
    $('#studio-prompt').oninput=e=>{draft=e.target.value;};
    $('#studio-motion').oninput=e=>{motion=e.target.value;};
    $('#studio-seconds').oninput=e=>{seconds=Number(e.target.value);acknowledged=false;$('#studio-acknowledge').checked=false;lengthNotice();};
    $('#studio-acknowledge').onchange=e=>{acknowledged=e.target.checked;};
    $('#studio-switch').onchange=e=>{switchModels=e.target.checked;};
    root.querySelectorAll('[data-studio-model]').forEach(el=>el.onchange=()=>{choices[el.dataset.studioModel]=el.value;sourceNotice();});
    $('#studio-file').onchange=async e=>{
      try{
        const input=e.target.files?.[0];if(!input)return;
        if(input.size>40*1024*1024)throw new Error('Reference images must be under 40 MiB.');
        if(!['image/png','image/jpeg','image/webp'].includes(input.type))throw new Error('Choose a PNG, JPEG, or WebP image.');
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('The image could not be read.'));reader.onload=()=>resolve(reader.result);reader.readAsDataURL(input);});
        file={name:input.name,data};sourceAsset=null;sourceNotice();
      }catch(error){message(error);}
    };
    $('#studio-clear').onclick=()=>{sourceAsset=null;file=null;draft='';$('#studio-file').value='';$('#studio-prompt').value='';sourceNotice();};
    $('#studio-create').onclick=()=>run('image');$('#studio-film').onclick=()=>run('film');
    sourceNotice();lengthNotice();update(runs);
    const current=root;
    api('/api/studio/tools').then(value=>{tools=value;if(root===current&&root.isConnected){$('#studio-tools').textContent=value.available?'Local video tools ready. Segment lengths are read from the loaded model.':value.note;controls();}}).catch(error=>{if(root===current&&root.isConnected){$('#studio-tools').textContent=error.message;}});
  }
  function message(error){if($('#studio-message'))$('#studio-message').textContent=error.message || String(error);}
  function lengthNotice(){
    $('#studio-long-warning').hidden=!(seconds>30);
    $('#studio-length').textContent=Number.isInteger(seconds)&&seconds>=1&&seconds<=60?`${seconds}s final video · aims for ${Math.ceil(seconds/5)} clips of up to 5s; actual segments follow the device’s supported frame counts.`:'Choose a whole number from 1 to 60 seconds.';
  }
  function sourceNotice(){
    const has=!!(sourceAsset||file);
    $('#studio-source').innerHTML=has?`<figure class="studio-reference"><img src="${esc(sourceAsset || file.data)}" alt="Current image selected for editing or animation"><figcaption>Current image · edit this version or use it directly in video</figcaption></figure>`:'<p class="help">An uploaded image can go straight to video, or you can describe an edit first.</p>';
    $('#studio-prompt-label').textContent=has?'What would you like to change?':'Your image idea';
    $('#studio-prompt').placeholder=has?'Describe the edit. Everything else should stay consistent.':'A tiny museum hidden inside an old lighthouse…';
    $('#studio-create').textContent=has?'Edit this image':'Create image';
    $('#studio-path').textContent=(has?'I2I prompt enhancer':'T2I prompt enhancer')+' → Qwen Image · review the result before animating.';
    controls();
  }
  function controls(){
    const running=busy(lastRuns.find(j=>j.id===currentId));
    for(const id of ['studio-create','studio-clear','studio-file','studio-prompt','studio-motion','studio-seconds','studio-switch','studio-acknowledge'])if($('#'+id))$('#'+id).disabled=running;
    root?.querySelectorAll('[data-studio-model]').forEach(el=>{el.disabled=running;});
    if($('#studio-film'))$('#studio-film').disabled=running||!(sourceAsset||file)||tools?.available!==true;
  }
  async function run(kind){
    if($('#studio-message'))$('#studio-message').textContent='';
    const button=$('#studio-'+(kind==='image'?'create':'film'));button.disabled=true;
    try{
      if(kind==='image'&&!draft.trim())throw new Error(sourceAsset||file?'Describe the change you want.':'Enter an image idea.');
      if(kind==='film'&&(!Number.isInteger(seconds)||seconds<1||seconds>60))throw new Error('Choose a whole-number duration from 1 to 60 seconds.');
      if(kind==='film'&&seconds>30&&!acknowledged)throw new Error('Read and acknowledge the long-run warning before continuing.');
      const job=await api('/api/studio/'+kind,{prompt:kind==='image'?draft:motion,sourceAsset,file:sourceAsset?undefined:file,text:selected('text'),edit:selected('edit'),image:selected('image'),video:selected('video'),seconds,acknowledged,switchModels});
      currentId=job.id;signature='';lastRuns=[job,...lastRuns];onQueued(job);update(lastRuns);toast(kind==='image'?'Image workflow queued.':'Film queued. Completed segments will be saved as it runs.');
    }catch(error){message(error);}finally{controls();}
  }
  function update(runs){
    lastRuns=runs;if(!root?.isConnected)return;
    const job=runs.find(j=>j.id===currentId);controls();
    if(job?.status==='completed'&&job.studio?.kind==='image'&&!finished.has(job.id)){
      finished.add(job.id);const image=imageOf(job);if(image){sourceAsset=image.url;file=null;draft='';$('#studio-file').value='';$('#studio-prompt').value='';sourceNotice();}
    }
    const next=JSON.stringify(job);if(next!==signature){
      signature=next;
      $('#studio-results').innerHTML=job?`<div class="section-gap"><p class="help" role="status">${esc(job.name)} · ${esc(busy(job)?job.phase || job.status:job.status)}${busy(job)&&job.progress!=null?' · '+job.progress+'% of this segment':''}</p>${job.film?.plan?`<p class="help">${job.outputs.length} of ${job.steps.length} segments saved · ${job.film.seconds}s target · ${job.film.plan.width} × ${job.film.plan.height}</p>`:''}${job.finalOutput?outputHTML(job.finalOutput):''}${job.film?`<details class="section-gap" ${job.finalOutput?'':'open'}><summary>Saved segments · ${job.outputs.length}</summary>${job.outputs.map(outputHTML).join('')}</details>`:job.outputs.map(outputHTML).join('')}${job.error?`<p class="error">${esc(job.error)}</p>`:''}${job.restoreError?`<p class="error">${esc(job.restoreError)}</p>`:''}${busy(job)?'<button class="button danger" id="studio-stop">Stop run</button>':''}${job.film&&['failed','cancelled','interrupted'].includes(job.status)?'<button class="button" id="studio-resume">Resume from saved segments</button>':''}</div>`:'';
      if($('#studio-stop'))$('#studio-stop').onclick=()=>api('/api/cancel/'+job.id,{}).then(()=>toast('Stop requested. Completed clips are kept.')).catch(message);
      if(job?.partial)$('#studio-results').insertAdjacentHTML('beforeend',outputHTML(job.partial));
      if($('#studio-resume'))$('#studio-resume').onclick=async()=>{const button=$('#studio-resume');button.disabled=true;try{const resumed=await api('/api/studio/resume',{id:job.id});currentId=resumed.id;signature='';onQueued(resumed);update([resumed,...runs]);}catch(error){message(error);if(button.isConnected)button.disabled=false;}};
    }
    const images=[...runs].filter(j=>imageOf(j)&&j.status==='completed').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,8);
    const gallery=images.map(j=>`<button class="studio-thumbnail" data-studio-image="${esc(j.id)}" aria-label="Use image from ${esc(j.name)}"><img src="${esc(imageOf(j).url)}" alt="Saved image"><span>${esc(j.name)}</span></button>`).join('');
    if($('#studio-history').innerHTML!==gallery){$('#studio-history').innerHTML=gallery;root.querySelectorAll('[data-studio-image]').forEach(el=>el.onclick=()=>{if(busy(runs.find(j=>j.id===currentId)))return;const image=imageOf(runs.find(j=>j.id===el.dataset.studioImage));sourceAsset=image.url;file=null;draft='';$('#studio-file').value='';$('#studio-prompt').value='';sourceNotice();});}
  }
  function adopt(image){sourceAsset=image.url;file=null;draft='';currentId='selected-image';signature='';}
  return {mount,update,adopt};
}
