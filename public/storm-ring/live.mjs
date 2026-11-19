import { autoRefreshEnabled, autoRefreshKey, autoReviewRoute, refreshInterval, refreshIsDue, seeReports, setAutoRefresh, setAutoReviewRoute } from './read-state.mjs';

const $ = selector => document.querySelector(selector);
const list = $('#live-reports');
const refreshButton = $('#refresh-feeds');
const detectButton = $('#detect-models');
const triageButton = $('#triage-reports');
const autoFeed = $('#auto-feed');
const autoTriage = $('#auto-triage');
const modelSelect = $('#triage-model');
const fallbackSelect = $('#triage-fallback');
const allowCloud = $('#allow-cloud');
const reportType = $('#report-type');
const reportQuery = $('#report-query');
const status = $('#feed-status');
const modelStatus = $('#model-status');
const timestamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let snapshot;
let models = [];
let refreshing = false;
let triaging = false;
let timer;
let busyPoll;
let pendingReport;

function el(name, attributes = {}, ...children) {
  const node = document.createElement(name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

function dateText(value) {
  return timestamp.format(new Date(value));
}

async function api(route, body) {
  const options = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  let response = await fetch('/api/storm-ring/' + route, options);
  if (response.status === 403 && !snapshot?.readOnly) {
    await fetch('/api/session');
    response = await fetch('/api/storm-ring/' + route, options);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Local server could not complete the request.');
  return data;
}

function showTab(live) {
  $('#live-tab').setAttribute('aria-pressed', live);
  $('#brief-tab').setAttribute('aria-pressed', !live);
  $('#details').hidden = live;
  $('#live-panel').hidden = !live;
  markViewed();
}

function markViewed() {
  if (snapshot && !document.hidden && !$('#live-panel').hidden) seeReports(snapshot.reports);
}

function selectTab(live) {
  if (live !== isLiveHash()) {
    history.replaceState(null, '', location.pathname + location.search + (live ? '#live' : ''));
  }
  if (!live) pendingReport = null;
  showTab(live);
}

function isLiveHash() {
  return location.hash === '#live' || /^#live\/[a-f0-9]{24}$/.test(location.hash);
}

function showLocation() {
  pendingReport = isLiveHash() ? location.hash.split('/')[1] : null;
  showTab(isLiveHash());
  if (pendingReport && snapshot) render(snapshot);
}

function reportCard(report) {
  const title = report.simulated ? report.title :
    el('a', { href: new URL(report.url).href, target: '_blank', rel: 'noopener noreferrer' }, report.title);
  const labels = [
    el('span', { class: 'report-unverified' }, 'Unverified'),
    el('span', { class: 'report-kind' }, report.simulated ? 'Simulation' : report.community ? 'Community lead' : 'News report'),
  ];
  if (report.firstSeenAt === snapshot.lastAttempt) {
    labels.push(el('span', { class: 'report-new' }, 'New to Storm Ring'));
  }
  const observed = report.publishedAt ? 'Published ' : report.community ? 'Posted ' : 'Indexed ';
  const meta = [report.publisher, report.publisherCountry && 'Publisher: ' + report.publisherCountry, report.language].filter(Boolean);
  const card = el('li', { class: 'report-card', id: 'report-' + report.id, tabindex: '-1' },
    el('div', { class: 'report-labels' }, ...labels),
    el('h3', {}, title),
    el('p', { class: 'report-meta' }, meta.join(' · ')),
    el('p', { class: 'report-time' }, observed, el('time', { datetime: report.reportedAt }, dateText(report.reportedAt))),
  );
  if (report.triage) {
    card.append(el('p', { class: 'model-note', title: [report.triage.provider, report.triage.model].filter(Boolean).join(' · ') },
      'Model suggestion · ' + report.triage.topic + ' · ' + report.triage.relevance));
  }
  return card;
}

function renderControls() {
  const active = refreshing || triaging || snapshot?.busy || snapshot?.triaging;
  const readOnly = snapshot?.readOnly === true;
  refreshButton.disabled = readOnly || Boolean(active);
  refreshButton.textContent = refreshing ? 'Refreshing…' : 'Refresh feeds';
  triageButton.disabled = readOnly || Boolean(active) || !modelSelect.value || !snapshot?.reports.length;
  triageButton.textContent = triaging ? 'Model running…' : 'Triage current headlines';
  autoTriage.disabled = readOnly || !modelSelect.value;
  autoFeed.disabled = readOnly;
  if (readOnly) detectButton.disabled = true;
}

function render(value) {
  snapshot = value;
  markViewed();
  if (pendingReport) {
    reportType.value = 'all';
    reportQuery.value = '';
  }
  const total = value.reports.length;
  const active = value.sources.filter(source => source.state === 'ok').length;
  $('#live-count').textContent = total;
  $('#live-count').hidden = total === 0;
  const query = reportQuery.value.trim().toLowerCase();
  const reports = value.reports.filter(report =>
    (reportType.value === 'all' || report.community === (reportType.value === 'community')) &&
    (!query || [report.title,report.publisher,report.publisherCountry].some(value=>value?.toLowerCase().includes(query))));
  const hasReports = reports.length > 0;
  if (value.simulation) {
    status.textContent = value.reports.length ? 'Simulation complete. This report is fictional.' : 'Simulation running. Waiting for a fictional report…';
  } else if (value.lastAttempt) {
    const checked = 'Last checked ' + dateText(value.lastAttempt);
    const failures = value.sources.length - active;
    status.textContent = checked + ' · ' + (failures ? active + '/' + value.sources.length + ' sources reached' : 'All sources reached');
    if (!active && value.lastSuccess) status.textContent += ' · Showing cache';
  } else {
    status.textContent = value.readOnly ? 'Feed refresh is unavailable in the read-only demo.' : 'Feeds refresh on request by default.';
  }
  const sourceStates = { ok: 'Reached', unavailable: 'Unavailable', waiting: 'Waiting' };
  $('#source-health').replaceChildren(...value.sources.map(source =>
    el('li', {}, el('span', {}, source.name), el('span', {}, sourceStates[source.state] + (source.count ? ' · ' + source.count : '')),
  )));
  list.replaceChildren(hasReports
    ? el('ol', { class: 'report-list' }, ...reports.map(reportCard))
    : el('p', { class: 'empty' }, value.simulation ? 'The demo report will appear in a few seconds.' : value.lastAttempt
      ? (total ? 'No reports match this filter.' : 'No matching reports in the cache. Try refreshing again later.')
      : 'Refresh feeds to load current public reports.'));
  if (pendingReport) {
    const card = document.getElementById('report-' + pendingReport);
    if (card) {
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'nearest' });
      pendingReport = null;
    } else if (!value.simulation || value.reports.length) {
      status.textContent = 'That report is no longer in the local cache. Showing current reports.';
      pendingReport = null;
    }
  }
  renderControls();
  clearTimeout(busyPoll);
  if ((value.busy || value.triaging || (value.simulation && !total)) && !refreshing && !triaging) {
    busyPoll = setTimeout(readSnapshot, value.simulation ? 1000 : 2000);
  }
}

function selectedRoute() {
  const selected = models[modelSelect.value];
  const alternate = models[fallbackSelect.value];
  return selected && {
    model: selected.model, endpointId: selected.endpointId, allowCloud: allowCloud.checked,
    ...(alternate ? { fallback: { model: alternate.model, endpointId: alternate.endpointId } } : {}),
  };
}

async function triage() {
  const route=selectedRoute();
  if (!route || !snapshot?.reports.length || triaging) return;
  triaging = true;
  renderControls();
  modelStatus.textContent = 'The selected model is reviewing up to 12 headlines.';
  try {
    const result = await api('triage', route);
    render(result);
    modelStatus.textContent = result.labeled ? result.reviewedBy + ' labeled ' + result.labeled + ' headlines. Their status remains unverified.'
      : 'The current headlines have already been labeled by this model.';
  } catch (error) {
    modelStatus.textContent = error.message;
  } finally {
    triaging = false;
    renderControls();
  }
}

async function refresh() {
  if (refreshing || triaging || snapshot?.readOnly) return;
  refreshing = true;
  renderControls();
  status.textContent = 'Checking public feeds…';
  try {
    const lastAttempt=snapshot?.lastAttempt;
    render(await api('refresh', {}));
    if (autoTriage.checked && snapshot.lastAttempt!==lastAttempt &&
      snapshot.reports.some(report=>report.firstSeenAt===snapshot.lastAttempt)) await triage();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    refreshing = false;
    renderControls();
  }
}

reportType.addEventListener('change', () => { if (snapshot) render(snapshot); });
reportQuery.addEventListener('input', () => { if (snapshot) render(snapshot); });

function schedule() {
  clearInterval(timer);
  if (autoFeed.checked) {
    timer = setInterval(() => {
      if (!document.hidden && snapshot && refreshIsDue(snapshot)) void refresh();
    }, refreshInterval);
  }
}

$('#live-tab').addEventListener('click', () => selectTab(true));
$('#brief-tab').addEventListener('click', () => selectTab(false));
window.addEventListener('hashchange', showLocation);
document.addEventListener('storm-ring:case-selected', () => selectTab(false));
refreshButton.addEventListener('click', refresh);
triageButton.addEventListener('click', triage);
function clearAutoReview() {
  autoTriage.checked = false;
  setAutoReviewRoute(null);
}
modelSelect.addEventListener('change', () => {
  clearAutoReview();
  renderControls();
});
fallbackSelect.addEventListener('change', clearAutoReview);
autoTriage.addEventListener('change',()=>setAutoReviewRoute(autoTriage.checked?selectedRoute():null));
allowCloud.addEventListener('change', () => {
  clearAutoReview();
  void discoverModels();
});
detectButton.addEventListener('click',discoverModels);
async function discoverModels() {
  detectButton.disabled = true;
  modelStatus.textContent = 'Checking loaded Tiiny models and configured local endpoints…';
  const saved=autoReviewRoute();
  const previous = models[modelSelect.value]??saved,previousAlternate=models[fallbackSelect.value]??saved?.fallback;
  const includeCloud=allowCloud.checked;
  allowCloud.disabled=true;
  try {
    models = await api('models'+(includeCloud?'?cloud=1':''));
    // A saved primary can be offline while its alternate is ready.
    for(const choice of [saved,saved?.fallback]){
      if(choice&&!models.some(model=>model.model===choice.model&&model.endpointId===choice.endpointId)){
        models.push({...choice,name:choice.model+' (saved)',provider:choice.endpointId?'Saved endpoint':'Tiiny'});
      }
    }
    const options = () => models.map((model, index) => el('option', { value: index }, (model.cloud?'Cloud · ':'') + model.provider + ' · ' + model.name));
    modelSelect.replaceChildren(el('option', { value: '' }, 'Select a model'), ...options());
    fallbackSelect.replaceChildren(el('option', { value: '' }, 'No alternate'), ...options());
    const priorIndex = models.findIndex(model => model.model === previous?.model && model.endpointId === previous?.endpointId);
    const preferred = models.findIndex(model => model.preferred);
    const tiiny = models.findIndex(model => !model.endpointId);
    if (priorIndex < 0) clearAutoReview();
    modelSelect.value = [priorIndex, preferred, tiiny].find(index => index >= 0) ?? '';
    const alternateIndex=models.findIndex(model=>model.model===previousAlternate?.model&&model.endpointId===previousAlternate?.endpointId);
    fallbackSelect.value=alternateIndex<0?'':alternateIndex;
    if(saved&&priorIndex>=0&&(!saved.fallback||alternateIndex>=0))autoTriage.checked=true;
    else if(saved)clearAutoReview();
    modelSelect.disabled = models.length === 0;
    fallbackSelect.disabled = models.length < 2;
    modelStatus.textContent = models.length
      ? 'Only public headlines are sent to the selected model.'
      : 'Load a chat model in Spindle Models or add a local endpoint in Settings, then try again.';
  } catch (error) {
    modelStatus.textContent = error.message;
  } finally {
    detectButton.disabled = false;
    allowCloud.disabled = Boolean(snapshot?.readOnly);
    if (!modelSelect.value && !snapshot?.readOnly) autoTriage.checked = false;
    renderControls();
  }
}

autoFeed.checked = autoRefreshEnabled();
autoFeed.addEventListener('change', () => {
  setAutoRefresh(autoFeed.checked);
  schedule();
});
window.addEventListener('storage', event => {
  if (event.key === autoRefreshKey) {
    autoFeed.checked = autoRefreshEnabled();
    schedule();
  }
});
document.addEventListener('visibilitychange', markViewed);
schedule();

showLocation();
async function readSnapshot() {
  try {
    render(await api('reports'));
  } catch {
    status.textContent = 'Could not read the local cache.';
  }
}
void readSnapshot();
const savedReview=autoReviewRoute();
if(savedReview){
  allowCloud.checked=savedReview.allowCloud===true;
  void discoverModels();
}
