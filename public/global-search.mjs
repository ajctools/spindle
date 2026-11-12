import {meetingLines} from './meeting-transcript.mjs';

const limit=20;
const labels={page:'Workspace',chat:'Chat',meeting:'Meeting',run:'Library run',workflow:'Workflow',prompt:'PromptDex',model:'Model'};
const clean=value=>typeof value==='string'?value.slice(0,160_000).replace(/\s+/gu,' ').trim():'';
const fold=value=>value.toLowerCase();

export function* searchItems({pages=[],runs=[],workflows=[],prompts=[],models=[]}={}){
  yield* pages;
  for(const run of runs){
    const type=run.meeting?'meeting':run.steps?.length===1&&run.steps[0].task==='chat'&&!run.studio?'chat':'run';
    const base={type,id:run.id,title:run.name,date:run.createdAt};
    yield base;
    if(run.meeting){
      for(const line of meetingLines(run))yield {...base,at:line.at,text:line.text};
      continue;
    }
    yield {...base,text:run.input};
    for(const step of run.steps||[])yield {...base,text:step.prompt};
    for(const output of [...(run.outputs||[]),run.finalOutput]){
      if(!output||output.authorKind)continue;
      yield {...base,text:output.text};
      for(const asset of output.assets||[])yield {...base,text:asset.label};
    }
  }
  for(const item of workflows){
    const base={type:'workflow',id:item.id,title:item.name};
    yield base;
    for(const step of item.steps||[])yield {...base,text:step.prompt};
  }
  for(const item of prompts)yield {type:'prompt',id:item.id,title:item.title,text:[...item.tags,item.template].join(' · ')};
  for(const item of models)yield {type:'model',id:item.id,title:item.name,text:[item.id,item.type,item.installed?'Downloaded':'',item.loaded?'Loaded':''].filter(Boolean).join(' · ')};
}

export function localMatches(items,input){
  const query=fold(clean(input).slice(0,120));
  const terms=[...new Set(query.split(' '))];
  if(!query)return [];
  const found=new Map();
  for(const {text,...item} of items){
    const title=fold(clean(item.title)),titleMatch=terms.every(term=>title.includes(term));
    const key=item.type+':'+item.id;
    if(found.get(key)?.score>=20)continue;
    const body=clean(text),folded=fold(body);
    if(!titleMatch&&!terms.every(term=>title.includes(term)||folded.includes(term)))continue;
    const score=title===query?50:title.startsWith(query)?40:title.includes(query)?30:titleMatch?20:folded.includes(query)?12:10;
    if(found.get(key)?.score>=score)continue;
    const at=folded.includes(query)?folded.indexOf(query):Math.min(...terms.map(term=>folded.indexOf(term)).filter(index=>index>=0));
    const start=Math.max(0,(Number.isFinite(at)?at:0)-45);
    const excerpt=body.slice(start,start+150).trim();
    const snippet=excerpt?(start?'…':'')+excerpt+(start+150<body.length?'…':''):'';
    found.set(key,{...item,score,snippet});
  }
  return [...found.values()].sort((a,b)=>b.score-a.score||(b.date||'').localeCompare(a.date||'')||a.title.localeCompare(b.title)).slice(0,limit);
}

export function mountGlobalSearch({getItems,getPages,onOpen,onChoose}){
  const dialog=document.querySelector('#global-search'),trigger=document.querySelector('#open-global-search');
  trigger.hidden=false;
  const input=dialog.querySelector('input'),list=dialog.querySelector('ul'),status=dialog.querySelector('[role="status"]');
  let results=[],timer;
  function render(){
    clearTimeout(timer);
    if(!dialog.open)return;
    const query=input.value.trim();
    results=query?localMatches(getItems(),query):getPages();
    const fragment=document.createDocumentFragment();
    results.forEach((item,index)=>{
      const row=document.createElement('li'),button=document.createElement('button'),title=document.createElement('strong'),meta=document.createElement('small');
      button.type='button';button.dataset.searchIndex=index;
      title.textContent=item.title;
      meta.textContent=labels[item.type]+(item.date?' · '+new Date(item.date).toLocaleDateString():'');
      button.append(title);
      if(query)button.append(meta);
      if(item.snippet){const snippet=document.createElement('span');snippet.textContent=item.snippet;button.append(snippet);}
      row.append(button);fragment.append(row);
    });
    list.toggleAttribute('data-shortcuts',!query);
    list.replaceChildren(fragment);
    status.textContent=query?(results.length?`Showing ${results.length} ${results.length===1?'match':'matches'}`:'No matches. Try a name or a shorter phrase.'):'Jump to a workspace';
  }
  function open(){
    if(dialog.open||document.querySelector('dialog[open]'))return;
    input.value='';
    dialog.showModal();input.focus();render();onOpen(()=>{
      if(dialog.open&&document.activeElement===input)render();
    });
  }
  function choose(index){
    const result=results[index];
    if(!result)return;
    dialog.close();void onChoose(result);
  }
  trigger.addEventListener('click',open);
  dialog.querySelector('[data-search-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    const hit=event.target.closest('[data-search-index]');
    if(hit)choose(Number(hit.dataset.searchIndex));
    else if(event.target===dialog)dialog.close();
  });
  input.addEventListener('input',()=>{
    clearTimeout(timer);
    // Remove old choices immediately so Enter cannot select a stale result.
    results=[];list.replaceChildren();
    timer=setTimeout(render,85);
  });
  dialog.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();dialog.close();return;}
    if(!['ArrowDown','ArrowUp','Enter'].includes(event.key))return;
    if(event.key==='Enter'){
      if(event.target===input){event.preventDefault();render();choose(0);}
      return;
    }
    if(event.target!==input&&!event.target.matches('[data-search-index]'))return;
    event.preventDefault();
    if(event.target===input&&!results.length)render();
    const buttons=list.querySelectorAll('button'),index=Array.from(buttons).indexOf(event.target);
    const next=event.key==='ArrowDown'?index+1:index<0?buttons.length-1:index-1;
    (buttons[next]||input).focus();
  });
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    clearTimeout(timer);input.value='';list.replaceChildren();results=[];
  });
  document.addEventListener('keydown',event=>{
    if(!event.repeat&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){
      event.preventDefault();open();
    }
  });
}
