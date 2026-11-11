const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export {withResponseLimit} from './chat-settings.mjs';

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
  return headers&&dividers?.length===headers.length&&dividers.every(cell=>/^:?-{3,}:?$/.test(cell))?headers:null;
}

const fence=/^ {0,3}(`{3,}|~{3,})/;
const heading=/^ {0,3}(#{1,6})\s+(.+)$/;
const listItem=/^ {0,3}(?:([-+*])|(\d{1,9})[.)])\s+(.+)$/;

export function chatMarkdown(text){
  const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n');
  const blocks=[];
  for(let i=0;i<lines.length;){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    const openingFence=line.match(fence);
    if(openingFence){
      const marker=openingFence[1];
      const closing=new RegExp('^ {0,3}'+marker[0]+'{'+marker.length+',}\\s*$');
      const code=[];
      for(i++;i<lines.length&&!closing.test(lines[i]);i++)code.push(lines[i]);
      if(i<lines.length)i++;
      blocks.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const headers=tableHeader(line,lines[i+1]);
    if(headers){
      i+=2;
      const rows=[];
      while(i<lines.length){
        const cells=tableCells(lines[i]);
        if(!cells||cells.length!==headers.length)break;
        rows.push('<tr>'+cells.map(cell=>`<td>${inline(cell)}</td>`).join('')+'</tr>');
        i++;
      }
      const head=headers.map(cell=>`<th scope="col">${inline(cell)}</th>`).join('');
      blocks.push(`<div class="chat-table-scroll" tabindex="0" role="region" aria-label="Reply table"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    const title=line.match(heading);
    if(title){
      const level=Math.max(2,title[1].length);
      blocks.push(`<h${level}>${inline(title[2])}</h${level}>`);
      i++;
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
      if(fence.test(lines[i])||heading.test(lines[i])||listItem.test(lines[i])||tableHeader(lines[i],lines[i+1]))break;
      paragraph.push(lines[i]);
    }
    blocks.push('<p>'+paragraph.map(inlineLine=>inline(inlineLine)).join('<br>')+'</p>');
  }
  return `<div class="output-text chat-markdown">${blocks.join('')}</div>`;
}

export function chatDetails(out,part='all'){
  const reasoning=out.reasoning?`<details class="thinking-panel" data-chat-panel data-reasoning><summary>✦ Thinking <span>Model-provided reasoning</span></summary><div class="output-text">${esc(out.reasoning)}</div></details>`:'';
  const search=out.webSearch;
  const sources=search?`<details class="chat-sources" data-chat-panel><summary>◎ Web sources · ${search.sources.length}</summary><p class="help">${esc(search.provider==='brave'?'Brave Search':'DuckDuckGo')} · ${esc(search.query)} · ${esc(new Date(search.searchedAt).toLocaleString())}</p><ol>${search.sources.map(s=>{
    let url;try{url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))return '';}catch{return '';}
    const forecast=s.forecast;
    const excerpt=forecast?`<p><strong>NWS forecast for ${esc(forecast.location)}</strong> · Issued ${esc(new Date(forecast.issuedAt).toLocaleString())} (your time)</p><ul>${forecast.periods.map(period=>`<li><strong>${esc(period.name)}</strong> · ${esc(period.detail)}</li>`).join('')}</ul>`:`<p>${esc(s.snippet)}</p>`;
    return `<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(s.title || url.hostname)} ↗</a>${excerpt}</li>`;
  }).join('')}</ol></details>`:'';
  const limit=Number.isSafeInteger(out.responseLimit)&&out.responseLimit>0?out.responseLimit:null;
  const advice=!out.text&&out.reasoning?'Thinking used the available budget before an answer arrived. Choose a larger <strong>Maximum response tokens</strong> value and resend your prompt. Lower reasoning effort or turn thinking off if your model supports it.':'Choose a larger <strong>Maximum response tokens</strong> value, then ask the model to continue. Thinking can share the output budget.';
  const warning=out.finishReason==='length'?`<p class="notice">${limit?'The response reached its requested '+limit.toLocaleString()+'-token limit.':out.responseLimit===null?'Tiiny stopped this response at a runtime output or context limit. Spindle did not set a token cap.':'The runtime stopped this response at a token or context limit.'} ${advice} The model’s context window and firmware still apply.</p>`:'';
  return part==='thinking'?reasoning:part==='sources'?sources+warning:reasoning+sources+warning;
}
