import {cloudRates,cloudEstimate,formatCloudCost,priceDate} from './cloud-cost.mjs';
import {sortTable,sortableHeader} from './dashboard-table.mjs';

const rates=cloudRates.map(r=>({...r}));
const number=new Intl.NumberFormat(undefined,{maximumFractionDigits:0});
const dates=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const calendarDate=value=>new Date(value+'T12:00:00Z');
const tokens=(usage,key)=>usage.covered?number.format(usage[key]):'—';
const estimate=(usage,rate)=>formatCloudCost(cloudEstimate(usage,rate.input,rate.output));

export function mountCostPanel(root){
  let data=null;
  root.innerHTML=`
    <div class="panel-head">
      <div><h2>Estimated cloud cost</h2><p class="help" id="cost-period">Selected dashboard period</p></div>
      <div class="cost-lifetime" hidden>
        <span>Lifetime local chat tokens</span>
        <strong id="cost-lifetime-total">—</strong>
        <small id="cost-lifetime-coverage"></small>
      </div>
    </div>
    <div class="cost-summary" id="cost-coverage">Reading reported text usage…</div>
    <div class="cost-cards">${rates.map((rate,i)=>`<article>
      <span>${rate.provider}</span><h3>${rate.model}</h3><strong data-estimate="${i}">—</strong>
      <small data-rate-label="${i}"></small>${rate.note?'<small>'+rate.note+'</small>':''}
      <a href="${rate.url}" target="_blank" rel="noopener noreferrer">Published pricing ↗</a>
    </article>`).join('')}</div>
    <details class="cost-settings cost-daily" hidden>
      <summary>Daily breakdown</summary>
      <p id="cost-no-days" hidden>No completed chat steps match these filters.</p>
      <div class="dash-table-wrap" role="region" aria-label="Estimated cloud costs by day" tabindex="0">
        <table class="dash-table">
          <thead><tr>${sortableHeader(['Date','Input tokens','Output tokens','Steps included',...rates.map(rate=>rate.model)])}</tr></thead>
          <tbody id="cost-days"></tbody>
        </table>
      </div>
    </details>
    <details class="cost-settings">
      <summary>Rates & assumptions · checked ${priceDate}</summary>
      <p>Standard uncached input and output rates per million tokens. Adjust them to compare your own plan. These edits stay in this tab.</p>
      <div class="cost-rate-grid">${rates.map((rate,i)=>`<fieldset>
        <legend>${rate.provider} · ${rate.model}</legend>
        <label>Input $ / 1M<input data-price="${i}" data-kind="input" type="number" min="0" max="100000" step="any" value="${rate.input}"></label>
        <label>Output $ / 1M<input data-price="${i}" data-kind="output" type="number" min="0" max="100000" step="any" value="${rate.output}"></label>
      </fieldset>`).join('')}</div>
      <button class="button quiet" id="cost-reset" type="button">Restore published rates</button>
      <p>Only completed text-only chat steps with both token counts are included. Missing usage, images, video, speech and 3D are excluded. Reasoning is already part of reported output. OpenRouter rates are for the listed model and example route. Other routes may cost more. Estimates exclude credit purchase fees, caching, batch discounts, tools, subscriptions, taxes and long-context premiums. Providers tokenize differently and models differ in capability. Estimates illustrate API spend for the reported counts. Spindle calculates them locally.</p>
    </details>`;

  const periodLabel=root.querySelector('#cost-period');
  const coverage=root.querySelector('#cost-coverage');
  const lifetime=root.querySelector('.cost-lifetime');
  const lifetimeTotal=root.querySelector('#cost-lifetime-total');
  const lifetimeCoverage=root.querySelector('#cost-lifetime-coverage');
  const daily=root.querySelector('.cost-daily');
  const tableWrap=daily.querySelector('.dash-table-wrap');
  const noDays=daily.querySelector('#cost-no-days');
  const dayRows=daily.querySelector('#cost-days');
  const sortDays=sortTable(dayRows,{column:0,direction:-1});
  const inputs=root.querySelectorAll('[data-price]');

  function render(){
    const {cloudUsage:usage,days,period,dailyCloudUsage,lifetimeCloudUsage,scope}=data??{};
    const periodText=period?.startDate
      ? `Rolling ${days} days · ${dates.formatRange(calendarDate(period.startDate),calendarDate(period.endDate))}`
      : period?'All time':'Selected dashboard period';
    periodLabel.textContent=`${periodText} · USD`;
    coverage.textContent=usage
      ? `${tokens(usage,'inputTokens')} input + ${tokens(usage,'outputTokens')} output tokens · ${usage.covered}/${usage.completed} completed chat steps included${usage.excluded?' · '+usage.excluded+' excluded for missing counts or uncertain/image input':''}`
      : data?'Restart the helper to enable full-history cost comparisons.':'Reading reported text usage…';

    lifetime.hidden=!lifetimeCloudUsage;
    if(lifetimeCloudUsage){
      const {inputTokens,outputTokens,covered,completed}=lifetimeCloudUsage;
      lifetimeTotal.textContent=covered?number.format(inputTokens+outputTokens):'—';
      lifetimeCoverage.textContent=completed
        ? `${scope==='all'?'All saved connections':'Current connection'} · ${number.format(covered)}/${number.format(completed)} completed steps included`
        : 'No completed chat steps yet';
    }

    rates.forEach((rate,i)=>{
      root.querySelector(`[data-estimate="${i}"]`).textContent=estimate(usage,rate);
      const valid=[rate.input,rate.output].every(v=>Number.isFinite(v)&&v>=0&&v<=100000);
      const edited=rate.input!==cloudRates[i].input||rate.output!==cloudRates[i].output;
      root.querySelector(`[data-rate-label="${i}"]`).textContent=valid
        ? `${rate.input} in / ${rate.output} out per 1M${edited?' · edited':''}`
        : 'Enter valid rates between $0 and $100,000.';
    });

    daily.hidden=!dailyCloudUsage;
    if(!dailyCloudUsage)return;
    tableWrap.hidden=dailyCloudUsage.length===0;
    noDays.hidden=dailyCloudUsage.length>0;
    dayRows.innerHTML=dailyCloudUsage.toReversed().map(day=>`<tr>
      <th scope="row" data-sort-value="${Date.parse(day.date)}">${dates.format(calendarDate(day.date))}</th>
      <td data-sort-value="${day.covered?day.inputTokens:''}">${tokens(day,'inputTokens')}</td><td data-sort-value="${day.covered?day.outputTokens:''}">${tokens(day,'outputTokens')}</td><td data-sort-value="${day.covered}">${day.covered}/${day.completed}</td>
      ${rates.map(rate=>{const cost=cloudEstimate(day,rate.input,rate.output);return `<td data-sort-value="${cost??''}">${formatCloudCost(cost).replace('<','&lt;')}</td>`;}).join('')}
    </tr>`).join('');
    sortDays();
  }

  inputs.forEach(input=>input.addEventListener('input',()=>{
    rates[Number(input.dataset.price)][input.dataset.kind]=input.value===''?NaN:Number(input.value);
    render();
  }));
  root.querySelector('#cost-reset').onclick=()=>{
    cloudRates.forEach((rate,i)=>Object.assign(rates[i],rate));
    inputs.forEach(input=>input.value=rates[Number(input.dataset.price)][input.dataset.kind]);
    render();
  };
  render();
  return next=>{data=next;render();};
}
