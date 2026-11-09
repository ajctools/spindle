const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function withResponseLimit(params,selection='default',custom=''){
  if(selection==='default')return {...params};
  if(!['4096','8192','16384','32768','custom'].includes(selection))throw new Error('Choose a valid maximum response length.');
  const value=Number(selection==='custom'?custom:selection);
  if(!Number.isSafeInteger(value)||value<1)throw new Error('Enter a positive whole number for maximum response tokens.');
  const {max_tokens,max_completion_tokens,...rest}=params;
  return {...rest,max_tokens:value};
}
export function chatDetails(out,part='all'){
  const reasoning=out.reasoning?`<details class="thinking-panel" data-chat-panel data-reasoning><summary>✦ Thinking <span>Model-provided reasoning</span></summary><div class="output-text">${esc(out.reasoning)}</div></details>`:'';
  const search=out.webSearch;
  const sources=search?`<details class="chat-sources" data-chat-panel><summary>◎ Web sources · ${search.sources.length}</summary><p class="help">${esc(search.provider==='brave'?'Brave Search':'DuckDuckGo')} · ${esc(search.query)} · ${esc(new Date(search.searchedAt).toLocaleString())}<br>Search snippets only. Open a source to verify the full page.</p><ol>${search.sources.map(s=>{
    let url;try{url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))return '';}catch{return '';}
    return `<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(s.title || url.hostname)} ↗</a><p>${esc(s.snippet)}</p></li>`;
  }).join('')}</ol></details>`:'';
  const limit=Number.isSafeInteger(out.responseLimit)&&out.responseLimit>0?out.responseLimit:null;
  const advice=!out.text&&out.reasoning?'Thinking used the available budget before an answer arrived. Choose a larger <strong>Maximum response tokens</strong> value and resend your prompt. Lower reasoning effort or turn thinking off if your model supports it.':'Choose a larger <strong>Maximum response tokens</strong> value, then ask the model to continue. Thinking can share the output budget.';
  const warning=out.finishReason==='length'?`<p class="notice">${limit?'The response reached its requested '+limit.toLocaleString()+'-token limit.':out.responseLimit===null?'Tiiny stopped this response at a runtime output or context limit. Spindle did not set a token cap.':'The runtime stopped this response at a token or context limit.'} ${advice} The model’s context window and firmware still apply.</p>`:'';
  return part==='thinking'?reasoning:part==='sources'?sources+warning:reasoning+sources+warning;
}
