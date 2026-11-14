const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export {withResponseLimit} from './chat-settings.mjs';

export function isChatRun(run){
  return run?.keepChatModel===true&&run.steps?.length===1&&run.steps[0].task==='chat'&&run.steps[0].promptMode==='literal';
}

export function chatReply(run){
  const step=run.outputs.length-1,output=run.outputs[step];
  if(output?.task!=='chat')return null;
  const {text,reasoning,webSearch,webSearchWarning,finishReason,responseLimit}=output;
  return {role:'assistant',content:text,reasoning,webSearch,webSearchWarning,finishReason,responseLimit,runId:run.id,step};
}

export function restoreChat(run,runs){
  const byId=new Map(runs.map(item=>[item.id,item])),seen=new Set(),turns=[];
  for(let turn=run;isChatRun(turn)&&!seen.has(turn.id);turn=byId.get(turn.previousChatRunId)){
    seen.add(turn.id);
    const {prompt,attachments}=turn.steps[0],reply=turn.status==='completed'?chatReply(turn):null;
    turns.push([{role:'user',content:prompt,attachments},...(reply?[reply]:[])]);
  }
  return turns.reverse().flat();
}

const compactTokens=new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1});
const count=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

export function chatRunStats(job,model){
  const output=job.outputs?.at(-1);
  const final=output?.task==='chat'?output:null;
  const live=job.chatProgress;
  const usage=final?.metrics??live;
  const context=count(final?.context??live?.context??model?.context)||null;
  const input=count(usage?.inputTokens),generated=count(usage?.outputTokens);
  const inputUsed=input??count(final?.chatTiming?.estimatedInput??live?.estimatedInput);
  const generatedUsed=generated??count(final?.chatTiming?.estimatedOutput??live?.estimatedOutput);
  const total=count(usage?.totalTokens);
  const used=total??(inputUsed==null?null:inputUsed+(generatedUsed??0));
  const estimated=used!=null&&total==null&&(input==null||generated==null);
  const ratio=used!=null&&context!=null?used/context:null;
  const cache=count(usage?.cachedTokens);
  const reportedRate=count(usage?.decodeTps);
  const duration=final?.chatTiming?.durationMs;
  const responseRate=duration>0&&generated!=null?generated*1000/duration:null;
  const estimatedRate=count(final?.chatTiming?.estimatedOutputTps??live?.estimatedOutputTps)
    ??(duration>0&&generatedUsed!=null?generatedUsed*1000/duration:null);
  const rate=reportedRate??responseRate??estimatedRate;
  const rateLabel=reportedRate!=null?'Tiiny decode':responseRate!=null?'response avg':'estimate';
  return {
    context,used,ratio,estimated,
    tokens:(used==null?'—':(estimated?'≈':'')+compactTokens.format(used))+' / '+(context==null?'—':compactTokens.format(context)),
    percent:ratio==null?'—':new Intl.NumberFormat(undefined,{style:'percent',maximumFractionDigits:1}).format(ratio),
    cache:cache==null?'—':compactTokens.format(cache)+(input>0?' ('+Math.round(100*cache/input)+'%)':''),
    rate:rate==null?'—':(rateLabel==='estimate'?'≈':'')+rate.toLocaleString(undefined,{maximumFractionDigits:1})+' t/s ('+rateLabel+')',
  };
}

function safeLink(value){
  try{
    const url=new URL(value);
    if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;
  }catch{}
  return null;
}

// Only generated markup is returned. Raw HTML and code always become text.
function inline(text,depth=0,links=true){
  if(depth>=6)return esc(text);
  const tokens=/\\([\\`*_[\]#!|])|`([^`\n]+)`|(!?)\[([^[\]\n]{1,250})\]\(([^\s()]{1,2048})\)|(\*\*|__)(?=\S)(.{0,2047}?\S)\6|(\*|_)(?=\S)(.{0,2047}?\S)\8/g;
  let result='',end=0;
  for(const match of text.matchAll(tokens)){
    const [source,literal,code,image,label,target,strong,bold,em,italic]=match;
    result+=esc(text.slice(end,match.index));
    end=match.index+source.length;
    if(literal)result+=esc(literal);
    else if(code)result+=`<code>${esc(code)}</code>`;
    else if(label){
      const href=!image&&links?safeLink(target):null;
      const caption=inline(label,depth+1,false);
      result+=href?`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${caption}</a>`:caption;
    }else if(strong)result+=`<strong>${inline(bold,depth+1,links)}</strong>`;
    else if(em)result+=`<em>${inline(italic,depth+1,links)}</em>`;
  }
  return result+esc(text.slice(end));
}

function tableCells(line){
  if(!line?.includes('|'))return null;
  const body=line.trim().replace(/^\||(?<!\\)\|$/g,'');
  const cells=body.split(/(?<!\\)\|/).map(cell=>cell.trim());
  return cells.length>1?cells:null;
}

function tableHeader(line,nextLine){
  const headers=tableCells(line),dividers=tableCells(nextLine);
  return headers&&dividers?.length===headers.length&&dividers.every(cell=>/^:?-{3,}:?$/.test(cell))?{headers,dividers}:null;
}

const fence=/^ {0,3}(`{3,}|~{3,})/;
const heading=/^ {0,3}(#{1,6})\s+(.+)$/;
const listItem=/^ {0,3}(?:([-+*])|(\d{1,9})[.)])\s+(.+)$/;
const sectionTitle=/^\s*SECTION ([A-Z]|\d{1,3})\s+[—–-]\s+(.+?)\s*$/i;
const boxRule=/^\s*[═─]{4,}\s*$/;
const markdownRule=/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const quote=/^ {0,3}>[ \t]?/;
const startsBlock=(line,next)=>fence.test(line)||heading.test(line)||sectionTitle.test(line)||boxRule.test(line)||
  markdownRule.test(line)||quote.test(line)||listItem.test(line)||tableHeader(line,next);

export function chatAppSource(output){
  if(output?.task!=='chat'||output.authorKind||typeof output.text!=='string'||output.finishReason==='length')return null;
  const source=output.text.trim();
  const document=/^(?:<!doctype\s+html\s*>\s*)?<html\b[\s\S]*<\/html\s*>$/i;
  if(document.test(source))return source;
  const lines=source.split(/\r\n?|\n/);
  for(let i=0;i<lines.length;i++){
    const marker=lines[i].match(fence)?.[1];
    if(!marker)continue;
    const language=lines[i].trim().slice(marker.length).trim().toLowerCase();
    const start=i+1,closing=new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}\\s*$');
    while(++i<lines.length&&!closing.test(lines[i])){}
    if(i===lines.length)break;
    if(language&&language!=='html')continue;
    const candidate=lines.slice(start,i).join('\n').trim();
    if(document.test(candidate))return candidate;
  }
  return null;
}

export function chatMarkdownBlocks(text,{partial=false}={}){
  // Keep the original line endings available for copying fenced text.
  const source=String(text??'');
  const lines=source.split(/\r\n?|\n/),endings=source.match(/\r\n?|\n/g)??[];
  const blocks=[],titles=[];
  for(let i=0;i<lines.length;){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    const openingFence=line.match(fence);
    if(openingFence){
      const marker=openingFence[1];
      const closing=new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}\\s*$');
      const language=line.trimStart().slice(marker.length).trim().match(/^[\w#+.-]{1,24}(?=\s|$)/)?.[0]??'Text';
      const start=++i;
      while(i<lines.length&&!closing.test(lines[i]))i++;
      const closed=i<lines.length;
      const code=lines.slice(start,i).map((part,index)=>part+(endings[start+index]??'')).join('');
      if(closed)i++;
      const copy=code.length&&(closed||!partial)?'<button class="button quiet copy-button" type="button" data-copy-code>Copy block</button>':'';
      blocks.push(`<figure class="chat-code"><figcaption>${esc(language)}${copy}</figcaption><pre tabindex="0" aria-label="${esc(language)} block"><code>${esc(code).replaceAll('\r','&#13;')}</code></pre></figure>`);
      continue;
    }
    const table=tableHeader(line,lines[i+1]);
    if(table){
      const {headers,dividers}=table;
      const alignment=dividers.map(divider=>divider.endsWith(':')?(divider.startsWith(':')?' data-align="center"':' data-align="end"'):'');
      i+=2;
      const rows=[];
      while(i<lines.length){
        const cells=tableCells(lines[i]);
        if(!cells||cells.length!==headers.length||fence.test(lines[i])||heading.test(lines[i])||sectionTitle.test(lines[i]))break;
        rows.push('<tr>'+cells.map((cell,column)=>`<td${alignment[column]}>${inline(cell)}</td>`).join('')+'</tr>');
        i++;
      }
      const head=headers.map((cell,column)=>`<th scope="col"${alignment[column]}>${inline(cell)}</th>`).join('');
      blocks.push(`<div class="chat-table-scroll" tabindex="0" role="region" aria-label="Reply table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    const title=line.match(heading),section=line.match(sectionTitle);
    if(section||title){
      const level=section?2:Math.max(2,title[1].length);
      const caption=section?`Section ${section[1].toUpperCase()} — ${section[2]}`:title[2];
      const label=section?`${section[1].toUpperCase()} · ${section[2]}`:caption;
      const target=level===2?` data-chat-heading="${titles.push(label)-1}" tabindex="-1"`:'';
      blocks.push(`<h${level}${target}>${inline(caption)}</h${level}>`);
      i++;
      continue;
    }
    if(boxRule.test(line)||markdownRule.test(line)){
      if(!boxRule.test(line)||!sectionTitle.test(lines[i-1]??'')&&!sectionTitle.test(lines[i+1]??''))blocks.push('<hr>');
      i++;
      continue;
    }
    if(quote.test(line)){
      const quoted=[];
      while(i<lines.length&&quote.test(lines[i]))quoted.push(inline(lines[i++].replace(quote,'')));
      blocks.push(`<blockquote>${quoted.join('<br>')}</blockquote>`);
      continue;
    }
    const item=line.match(listItem);
    if(item){
      const ordered=!!item[2],tag=ordered?'ol':'ul';
      const start=ordered&&Number(item[2])!==1?` start="${Number(item[2])}"`:'';
      const items=[];
      while(i<lines.length){
        const next=lines[i].match(listItem);
        if(!next||!!next[2]!==ordered)break;
        items.push(`<li>${inline(next[3])}</li>`);
        i++;
      }
      blocks.push(`<${tag}${start}>${items.join('')}</${tag}>`);
      continue;
    }
    const paragraph=[line];
    for(i++;i<lines.length&&lines[i].trim();i++){
      if(startsBlock(lines[i],lines[i+1]))break;
      paragraph.push(lines[i]);
    }
    blocks.push('<p>'+paragraph.map((part,index)=>{
      const hardBreak=index<paragraph.length-1&&/(?: {2,}|\\)$/.test(part);
      const line=part.trim();
      return inline(hardBreak?line.replace(/\\$/,''):line)+(hardBreak?'<br>':index<paragraph.length-1?' ':'');
    }).join('')+'</p>');
  }
  if(!partial&&(titles.length>=4||titles.length>=2&&blocks.length>=8)){
    const links=titles.map((label,index)=>`<button type="button" data-chat-jump="${index}">${inline(label,0,false)}</button>`).join('');
    blocks.unshift(`<nav class="chat-outline" aria-label="In this reply"><span>In this reply</span>${links}</nav>`);
  }
  return blocks;
}

export function chatMarkdown(text){
  return `<div class="output-text chat-markdown">${chatMarkdownBlocks(text).join('')}</div>`;
}

const liveReplies=new WeakMap();

export function updateLiveChat(container,text){
  const previous=liveReplies.get(container);
  if(previous?.text===text)return;
  const blocks=chatMarkdownBlocks(text,{partial:true}),oldBlocks=previous?.blocks??[];
  let shared=0;
  while(shared<oldBlocks.length&&oldBlocks[shared]===blocks[shared])shared++;
  while(container.children.length>shared)container.lastElementChild.remove();
  container.insertAdjacentHTML('beforeend',blocks.slice(shared).join(''));
  liveReplies.set(container,{text,blocks});
}

export function chatDetails(out,part='all'){
  const reasoning=out.reasoning?`<details class="thinking-panel" data-chat-panel data-reasoning><summary>✦ Thinking <span>Model-provided reasoning</span></summary><div class="output-text">${esc(out.reasoning)}</div></details>`:'';
  const search=out.webSearch;
  const queries=search?.queries?.length?search.queries.join(' → '):search?.query;
  const sources=search?`<details class="chat-sources" data-chat-panel><summary>◎ Web sources · ${search.sources.length}</summary><p class="help">${esc(search.provider==='public-page'?'Public page':search.provider==='publisher-news'?'Publisher feeds':search.provider==='brave'?'Brave Search':'DuckDuckGo')} · ${esc(queries)} · ${esc(new Date(search.searchedAt).toLocaleString())}</p><ol>${search.sources.map(s=>{
    let url;try{url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))return '';}catch{return '';}
    const forecast=s.forecast;
    const excerpt=forecast?`<p><strong>NWS forecast for ${esc(forecast.location)}</strong> · Issued ${esc(new Date(forecast.issuedAt).toLocaleString())} (your time)</p><ul>${forecast.periods.map(period=>`<li><strong>${esc(period.name)}</strong> · ${esc(period.detail)}</li>`).join('')}</ul>`:`<p>${esc(s.snippet)}</p>`;
    const published=s.publishedAt?`<p class="help">${esc(s.publisher)} · Published ${esc(new Date(s.publishedAt).toLocaleString())}</p>`:'';
    return `<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(s.title || url.hostname)} ↗</a>${published}${s.excerpt?`<p class="help">Page excerpt</p><p>${esc(s.excerpt)}</p>`:excerpt}</li>`;
  }).join('')}</ol></details>`:'';
  const searchWarning=out.webSearchWarning?`<p class="notice"><strong>Tiiny reply without web sources.</strong> ${esc(out.webSearchWarning)}</p>`:search?.coverage==='partial'?'<p class="notice">The web sources only answer part of this request.</p>':'';
  const limit=Number.isSafeInteger(out.responseLimit)&&out.responseLimit>0?out.responseLimit:null;
  const advice=!out.text&&out.reasoning?'Thinking used the available budget before an answer arrived. Choose a larger <strong>Maximum response tokens</strong> value and resend your prompt. Lower reasoning effort or turn thinking off if your model supports it.':'Choose a larger <strong>Maximum response tokens</strong> value, then ask the model to continue. Thinking can share the output budget.';
  const warning=out.finishReason==='length'?`<p class="notice">${limit?'The response reached its requested '+limit.toLocaleString()+'-token limit.':out.responseLimit===null?'Tiiny stopped this response at a runtime output or context limit. Spindle did not set a token cap.':'The runtime stopped this response at a token or context limit.'} ${advice} The model’s context window and firmware still apply.</p>`:'';
  return part==='before'?searchWarning+reasoning:part==='sources'?sources+warning:searchWarning+reasoning+sources+warning;
}
