const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function chatDetails(out,part='all'){
  const reasoning=out.reasoning?`<details class="thinking-panel" data-chat-panel data-reasoning><summary>✦ Thinking <span>Model-provided reasoning</span></summary><div class="output-text">${esc(out.reasoning)}</div></details>`:'';
  const search=out.webSearch;
  const sources=search?`<details class="chat-sources" data-chat-panel><summary>◎ Web sources · ${search.sources.length}</summary><p class="help">${esc(search.provider==='brave'?'Brave Search':'DuckDuckGo')} · ${esc(search.query)} · ${esc(new Date(search.searchedAt).toLocaleString())}<br>Search snippets only. Open a source to verify the full page.</p><ol>${search.sources.map(s=>{
    let url;try{url=new URL(s.url);if(!['https:','http:'].includes(url.protocol))return '';}catch{return '';}
    return `<li><a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(s.title || url.hostname)} ↗</a><p>${esc(s.snippet)}</p></li>`;
  }).join('')}</ol></details>`:'';
  const warning=out.finishReason==='length'?'<p class="notice">The response reached its token limit. Increase max_tokens in Advanced settings, or ask the model to continue.</p>':'';
  return part==='thinking'?reasoning:part==='sources'?sources+warning:reasoning+sources+warning;
}
