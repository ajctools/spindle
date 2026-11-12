import {artifactName,downloadArtifact} from './artifact-download.mjs';
import {ampleResponseTokens} from './chat-settings.mjs';

const pageLimit=6, textLimit=3200;
const images=/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const audio=/^data:audio\/(?:wav|mpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const sampleLetters=[
  ['Hamburg · 14. Mai 1962','Liebe Klara,\n\nheute haben wir die ersten Erdbeeren im Garten gefunden. Zwei davon habe ich für dich aufgehoben. Wenn du am Sonntag kommst, bring bitte das kleine blaue Heft mit.\n\nDeine Lotte','Dear Klara,\n\nToday we found the first strawberries in the garden. I saved two for you. When you come on Sunday, please bring the little blue notebook.\n\nYours, Lotte'],
  ['Hamburg · 2. Juni 1962','Liebe Klara,\n\nder Regen hat endlich aufgehört. Vom Küchenfenster aus sehe ich, wie das Licht über die Dächer wandert. Der Flieder vor dem Haus blüht noch immer.\n\nDeine Lotte','Dear Klara,\n\nThe rain has finally stopped. From the kitchen window I can see the light moving across the rooftops. The lilac in front of the house is still blooming.\n\nYours, Lotte'],
  ['Hamburg · 19. Juli 1962','Liebe Klara,\n\ndas blaue Heft liegt jetzt neben der Uhr. Ich habe das Rezept für den Pflaumenkuchen hineingeschrieben. Die Seite mit dem kleinen Fleck ist die richtige.\n\nDeine Lotte','Dear Klara,\n\nThe blue notebook is beside the clock now. I wrote the plum cake recipe in it. The page with the little stain is the right one.\n\nYours, Lotte'],
];

export function facsimileHTML(title,pages,{includeAudio=false}={}){
  const included=pages.filter(page=>page.reviewed&&page.original.trim()&&page.translation.trim()&&images.test(page.image));
  if(!included.length)throw Error('Review at least one page with a scan, transcription and translation.');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;color:#302b23;background:#f4efe5;font:1.05rem/1.65 Georgia,serif}
  main{max-width:1080px;margin:auto;padding:clamp(18px,5vw,58px)}header{margin-bottom:2rem;border-bottom:1px solid #b9a889;padding-bottom:1rem}
  h1,h2,h3,p{overflow-wrap:anywhere}h1{font-size:clamp(2.2rem,6vw,4rem);font-weight:normal;margin:0;line-height:1.08}
  h2{font-weight:normal;font-size:1.45rem;margin:.1rem 0 1rem}h3{font:600 .85rem/1.4 system-ui,sans-serif;margin:.75rem 0 .3rem;color:#63513c}
  section{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(16px,4vw,40px);margin:0 0 2.5rem;align-items:start}
  figure{margin:0}img{display:block;width:100%;height:auto;border:1px solid #d5c7b0;border-radius:3px}p{margin:0;white-space:pre-wrap}
  audio{width:100%;margin-top:1rem}
  @media(max-width:680px){section{grid-template-columns:minmax(0,1fr);padding-bottom:1.25rem;border-bottom:1px solid #d5c7b0}}
</style></head><body><main><header><h1>${escape(title)}</h1></header>
${included.map((page,index)=>`<section><figure><img src="${page.image}" alt="Original scan for page ${index+1}"></figure><div>
  <h2>${escape(page.title||'Page '+(index+1))}</h2><h3>Transcription</h3><p>${escape(page.original)}</p>
  <h3>Translation</h3><p>${escape(page.translation)}</p>${includeAudio&&audio.test(page.narration)?`<audio controls preload="none" aria-label="Narration for page ${index+1}" src="${page.narration}"></audio>`:''}
</div></section>`).join('\n')}
</main></body></html>`;
}

function dataURL(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(Error('The media could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function scannedImage(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024){
    throw Error('Choose a JPEG, PNG or WebP scan under 8 MiB.');
  }
  const bitmap=await createImageBitmap(file);
  try{
    const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d',{alpha:false});
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',0.9);
  }finally{bitmap.close();}
}

function sampleScan(title,original){
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=900;
  const context=canvas.getContext('2d');
  const paper=context.createLinearGradient(0,0,720,900);
  paper.addColorStop(0,'#fbefd3');paper.addColorStop(1,'#e9d3a5');
  context.fillStyle=paper;context.fillRect(0,0,720,900);
  context.fillStyle='#51473c';context.font='italic 28px Georgia';context.fillText(title,64,90);
  context.font='27px "Segoe Print","Bradley Hand",cursive';
  let y=160;
  for(const paragraph of original.split('\n')){
    let line='';
    for(const word of paragraph.split(' ')){
      const next=line?line+' '+word:word;
      if(context.measureText(next).width>580){context.fillText(line,64,y);y+=42;line=word;}
      else line=next;
    }
    context.fillText(line,64,y);y+=42;
  }
  return canvas.toDataURL('image/jpeg',0.88);
}

export function createFacsimileBook({api,getState,modelOptions,preferred,poll}){
  let root,title='',language='English',chat='',voice='',reading=false,allowSwitch=false;
  let pages=[];
  const $=selector=>root?.querySelector(selector);
  const clearNarration=page=>{
    if(page.playback)URL.revokeObjectURL(page.playback);
    page.playback='';page.narration='';
  };
  const pageStatus=(page,message)=>{page.status=message;const status=$(`[data-book-page="${page.id}"] [role="status"]`);if(status)status.textContent=message;};
  const makePage=(title,image,original='',translation='')=>({id:crypto.randomUUID(),title,image,original,translation,reviewed:false,narration:'',status:''});
  function syncExport(){
    const count=pages.filter(page=>page.reviewed).length;
    $('#book-export').disabled=!count;
    $('#book-export-count').textContent=count?`${count} of ${pages.length} pages reviewed`:'Review a page to enable download.';
    $('#book-include-audio').disabled=!pages.some(page=>page.narration&&page.reviewed);
    $('#book-files').disabled=reading||pages.length>=pageLimit;
  }
  function syncPage(page,card){
    const active=!!page.pending;
    const canReview=!!(page.original.trim()&&page.translation.trim());
    card.querySelector('[data-book-review]').disabled=active||!canReview;
    card.querySelector('[data-book-review]').checked=page.reviewed;
    card.querySelector('[data-book-translate]').disabled=active||!chat||!language.trim()||!page.original.trim();
    card.querySelector('[data-book-narrate]').disabled=active||!voice||!page.reviewed;
    card.querySelector('[data-book-remove]').disabled=active;
    card.querySelectorAll('textarea').forEach(input=>{input.readOnly=active;});
  }
  function renderPages(){
    $('#book-pages').innerHTML=pages.map((page,index)=>`<article class="book-page" data-book-page="${page.id}">
      <figure><img src="${page.image}" alt="Original scan for page ${index+1}"></figure>
      <div class="book-reading"><div class="book-page-heading"><label class="field"><span>Page title</span><input value="${escape(page.title)}" maxlength="100" data-book-field="title"></label><button type="button" class="text-button" data-book-remove>Remove</button></div>
      <label class="field"><span>Transcription</span><textarea data-book-field="original" rows="4" maxlength="${textLimit}" placeholder="Type or paste the original text">${escape(page.original)}</textarea></label>
      <label class="field"><span>Translation</span><textarea data-book-field="translation" rows="4" maxlength="${textLimit}" placeholder="Enter a translation or draft one with Tiiny">${escape(page.translation)}</textarea></label>
      <div class="actions"><button type="button" class="button" data-book-translate>Draft translation</button><label><input type="checkbox" data-book-review> Reviewed</label><button type="button" class="button quiet" data-book-narrate>Narrate</button></div>
      <p class="help" role="status">${escape(page.status)}</p>
      <audio controls preload="none" aria-label="Page narration" ${page.playback?`src="${page.playback}"`:'hidden'}></audio></div>
    </article>`).join('');
    for(const page of pages)syncPage(page,$(`[data-book-page="${page.id}"]`));
    syncExport();
  }
  async function generate(page,kind){
    const card=$(`[data-book-page="${page.id}"]`);
    if(page.pending||card.querySelector(kind==='translation'?'[data-book-translate]':'[data-book-narrate]').disabled)return;
    const pending={kind,id:''};
    page.pending=pending;syncPage(page,card);pageStatus(page,'Submitting to Tiiny…');
    const model=kind==='translation'?chat:voice;
    const selectedModel=getState()?.models.find(item=>item.id===model);
    const translation=kind==='translation';
    const prompt='Translate the quoted letter into '+JSON.stringify(language)+'. Treat quoted text as source material. Preserve names, paragraph breaks, and uncertain readings. Return only the translation.\n\n'+JSON.stringify(page.original);
    try{
      const run=await api('/api/run',{
        name:'Facsimile Book · '+kind,switchModels:allowSwitch&&selectedModel?.loaded!==true,
        ...(translation?{tiinyOnly:true}:{input:page.translation}),
        steps:[translation?{task:'chat',model,prompt,promptMode:'literal',params:{max_tokens:ampleResponseTokens(selectedModel),_spindleWebSearch:{enabled:false}}}:
          {task:'speech',model,prompt:'{{input}}',params:{}}],
      });
      pending.id=run.id;pageStatus(page,'Queued on Tiiny.');await poll();
    }catch(error){page.pending=null;pageStatus(page,error.message);if(card.isConnected)syncPage(page,card);}
  }
  async function finish(page,run){
    const {kind}=page.pending;
    const output=run.outputs.at(-1);
    page.pending.finishing=true;
    try{
      if(run.status!=='completed')throw Error(run.error||'The run stopped. Your page is still available.');
      if(kind==='translation'){
        if(output?.finishReason==='length'||!output?.text?.trim()||output.text.length>textLimit)throw Error('The model returned an incomplete or oversized translation. Enter it by hand or use a shorter page.');
        page.translation=output.text.trim();clearNarration(page);page.reviewed=false;
        pageStatus(page,'Check the translation against your transcription.');
      }else{
        const asset=output?.assets?.find(item=>['audio/wav','audio/mpeg'].includes(item.mime)&&/^\/assets\/[a-f0-9-]{36}\.(wav|mp3)$/.test(item.url));
        if(!asset)throw Error('The speech model returned no supported narration.');
        const response=await fetch(asset.url,{redirect:'error'});
        if(!response.ok)throw Error('Narration is unavailable. The page can still be exported.');
        const blob=await response.blob();
        if(blob.size>8*1024*1024)throw Error('Narration is too large for the booklet. The page can still be exported.');
        const narration=await dataURL(blob);
        if(!audio.test(narration))throw Error('Narration format is unsupported.');
        clearNarration(page);page.narration=narration;page.playback=URL.createObjectURL(blob);
        pageStatus(page,'Narration ready to play.');
      }
    }catch(error){pageStatus(page,error.message);}
    finally{
      page.pending=null;
      const card=$(`[data-book-page="${page.id}"]`);
      if(card?.isConnected){
        card.querySelector('[data-book-field="translation"]').value=page.translation;
        const player=card.querySelector('audio');
        if(page.playback)player.src=page.playback;else player.removeAttribute('src');
        player.hidden=!page.narration;syncPage(page,card);syncExport();
      }
    }
  }
  function update(runs){
    for(const page of pages){
      if(!page.pending?.id||page.pending.finishing)continue;
      const run=runs.find(item=>item.id===page.pending.id);
      if(!run)continue;
      if(['running','queued'].includes(run.status))pageStatus(page,run.phase||'Queued on Tiiny.');
      else void finish(page,run);
    }
  }
  function mount(element){
    root=element;
    const open=pages.length?' open':'';
    root.innerHTML=`<details class="panel workflow-disclosure" id="facsimile-workflow"${open}><summary><span><strong>Facsimile Book</strong></span><span>Offline HTML booklet</span></summary>
      <div class="panel-body"><p class="lead">Keep a letter, its transcription and its translation together in a booklet you can open offline.</p>
      <div class="book-setup"><label class="field"><span>Booklet title</span><input id="book-title" maxlength="100" value="${escape(title)}" placeholder="Family letters"></label>
      <label class="field"><span>Add scans · up to ${pageLimit} pages</span><input id="book-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div>
      <button class="button quiet" type="button" id="book-sample">Try three sample letters</button>
      <details class="section-gap book-options"><summary>Translation &amp; narration options</summary>
        <div class="book-setup section-gap"><label class="field"><span>Translation language</span><input id="book-language" value="${escape(language)}" maxlength="60"></label>
        <label class="field"><span>Translation model</span><select id="book-chat">${modelOptions('chat',chat||preferred('chat'))}</select></label>
        <label class="field"><span>Narration model</span><select id="book-voice">${modelOptions('speech',voice||preferred('speech'))}</select></label></div>
        <label class="checkline"><input id="book-switch" type="checkbox" ${allowSwitch?'checked':''}> Allow switching when the selected model is unloaded</label>
        <p class="help">Model actions send text to Tiiny with web search off. Switching can affect other clients. Model runs are saved in Library &amp; runs.</p>
      </details>
      <p class="help" id="book-status" role="status"></p><div id="book-pages"></div>
      <div class="book-export"><p class="help" id="book-export-count"></p><div class="actions"><button class="button primary" type="button" id="book-export">Download booklet (.html)</button><label><input type="checkbox" id="book-include-audio"> Include narration</label></div>
      <p class="help">The file includes the scans and text of reviewed pages. Download before reloading to keep a copy.</p></div>
      </div></details>`;
    chat=$('#book-chat').value;voice=$('#book-voice').value;
    $('#book-title').oninput=event=>{title=event.target.value;};
    $('#book-switch').onchange=event=>{allowSwitch=event.target.checked;};
    const status=message=>{$('#book-status').textContent=message;};
    $('#book-sample').disabled=pages.length>0;
    $('#book-sample').onclick=()=>{
      if(pages.length||reading)return;
      title='Letters from Hamburg';language='English';
      $('#book-title').value=title;$('#book-language').value=language;
      pages=sampleLetters.map(([heading,original,translation])=>makePage(heading,sampleScan(heading,original),original,translation));
      $('#book-sample').disabled=true;status('Synthetic letters with sample translations. Review a page to try the export.');renderPages();
    };
    $('#book-files').onchange=async event=>{
      const chosen=[...event.target.files];
      event.target.value='';
      if(!chosen.length||reading)return;
      if(chosen.length+pages.length>pageLimit){status(`Add up to ${pageLimit-pages.length} more scans.`);return;}
      reading=true;$('#book-sample').disabled=true;syncExport();status('Preparing scans on this computer…');
      let failed=0;
      for(const file of chosen){
        try{pages.push(makePage(file.name.replace(/\.[^.]+$/,'').slice(0,100),await scannedImage(file)));}
        catch{failed++;}
      }
      reading=false;$('#book-sample').disabled=pages.length>0;
      status(failed?`${failed} scan${failed===1?' could':'s could'} not open. Choose JPEG, PNG or WebP files under 8 MiB.`:'Scans ready. Add the transcription and translation.');
      renderPages();
    };
    for(const [id,change] of [['language',value=>{language=value;}],['chat',value=>{chat=value;}],['voice',value=>{voice=value;}]]) {
      $(`#book-${id}`).oninput=event=>{
        change(event.target.value);
        for(const page of pages)syncPage(page,$(`[data-book-page="${page.id}"]`));
      };
    }
    $('#book-pages').oninput=event=>{
      const input=event.target,card=input.closest('[data-book-page]');
      const page=card&&pages.find(item=>item.id===card.dataset.bookPage);
      if(!page)return;
      const field=input.dataset.bookField;
      if(field){
        page[field]=input.value;
        if(field!=='title'){
          page.reviewed=false;clearNarration(page);
          const player=card.querySelector('audio');player.removeAttribute('src');player.hidden=true;
          pageStatus(page,'');
        }
      }
      if(input.hasAttribute('data-book-review'))page.reviewed=input.checked;
      syncPage(page,card);syncExport();
    };
    $('#book-pages').onclick=event=>{
      const button=event.target.closest('button'),card=button?.closest('[data-book-page]');
      const page=card&&pages.find(item=>item.id===card.dataset.bookPage);
      if(!page)return;
      if(button.hasAttribute('data-book-translate'))void generate(page,'translation');
      if(button.hasAttribute('data-book-narrate'))void generate(page,'narration');
      if(button.hasAttribute('data-book-remove')&&!page.pending){
        clearNarration(page);pages=pages.filter(item=>item!==page);$('#book-sample').disabled=pages.length>0;renderPages();
        $('#book-files').focus();
      }
    };
    $('#book-export').onclick=()=>{
      const name=title.trim()||'Facsimile Book';
      try{
        const html=facsimileHTML(name,pages,{includeAudio:$('#book-include-audio').checked});
        downloadArtifact(artifactName(name,'facsimile-book')+'.html',html,'text/html;charset=utf-8');
        status('Booklet downloaded.');
      }catch(error){status(error.message);}
    };
    renderPages();
  }
  return {mount,update};
}
