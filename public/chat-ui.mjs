const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export {withResponseLimit} from './chat-settings.mjs';
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
