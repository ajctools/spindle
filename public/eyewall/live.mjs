import { autoRefreshEnabled, autoRefreshKey, refreshInterval, refreshIsDue, seeReports, setAutoRefresh } from './read-state.mjs';

const $ = selector => document.querySelector(selector);
const list = $('#live-reports');
const refreshButton = $('#refresh-feeds');
const detectButton = $('#detect-models');
const triageButton = $('#triage-reports');
const autoFeed = $('#auto-feed');
const autoTriage = $('#auto-triage');
const modelSelect = $('#triage-model');
const reportType = $('#report-type');
const status = $('#feed-status');
const modelStatus = $('#model-status');
const timestamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let snapshot;
let models = [];
let refreshing = false;
let triaging = false;
let timer;
let busyPoll;

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
  let response = await fetch('/api/eyewall/' + route, options);
  if (response.status === 403 && !snapshot?.readOnly) {
    await fetch('/api/session');
    response = await fetch('/api/eyewall/' + route, options);
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
  if (live !== (location.hash === '#live')) {
    history.replaceState(null, '', location.pathname + location.search + (live ? '#live' : ''));
  }
  showTab(live);
}

function reportCard(report) {
  const url = new URL(report.url);
  const link = el('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, report.title);
  const labels = [
    el('span', { class: 'report-unverified' }, 'Unverified'),
    el('span', { class: 'report-kind' }, report.community ? 'Community lead' : 'News report'),
  ];
  if (report.firstSeenAt === snapshot.lastAttempt) {
    labels.push(el('span', { class: 'report-new' }, 'New to Eyewall'));
  }
  const observed = report.publishedAt ? 'Published ' : report.community ? 'Posted ' : 'Indexed ';
  const meta = [report.publisher, report.publisherCountry && 'Publisher: ' + report.publisherCountry, report.language].filter(Boolean);
  const card = el('li', { class: 'report-card' },
    el('div', { class: 'report-labels' }, ...labels),
    el('h3', {}, link),
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
  const total = value.reports.length;
  const active = value.sources.filter(source => source.state === 'ok').length;
  $('#live-count').textContent = total;
  $('#live-count').hidden = total === 0;
  const reports = value.reports.filter(report => reportType.value === 'all' || report.community === (reportType.value === 'community'));
  const hasReports = reports.length > 0;
  if (value.lastAttempt) {
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
    : el('p', { class: 'empty' }, value.lastAttempt
      ? (total ? 'No reports match this filter.' : 'No matching reports in the cache. Try refreshing again later.')
      : 'Refresh feeds to load current public reports.'));
  renderControls();
  clearTimeout(busyPoll);
  if ((value.busy || value.triaging) && !refreshing && !triaging) busyPoll = setTimeout(readSnapshot, 2000);
}

async function triage() {
  const selected = models[modelSelect.value];
  if (!selected || !snapshot?.reports.length || triaging) return;
  triaging = true;
  renderControls();
  modelStatus.textContent = 'The selected model is reviewing up to 12 headlines.';
  try {
    const result = await api('triage', { model: selected.model, endpointId: selected.endpointId });
    render(result);
    modelStatus.textContent = result.labeled ? 'Added labels to ' + result.labeled + ' headlines. Their status remains unverified.'
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
    render(await api('refresh', {}));
    if (autoTriage.checked && modelSelect.value) await triage();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    refreshing = false;
    renderControls();
  }
}

reportType.addEventListener('change', () => { if (snapshot) render(snapshot); });

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
window.addEventListener('hashchange', () => showTab(location.hash === '#live'));
document.addEventListener('eyewall:case-selected', () => selectTab(false));
refreshButton.addEventListener('click', refresh);
triageButton.addEventListener('click', triage);
modelSelect.addEventListener('change', () => {
  autoTriage.checked = false;
  renderControls();
});
detectButton.addEventListener('click', async () => {
  detectButton.disabled = true;
  modelStatus.textContent = 'Checking loaded Tiiny models and configured local endpoints…';
  const previous = models[modelSelect.value];
  try {
    models = await api('models');
    modelSelect.replaceChildren(el('option', { value: '' }, 'Select a model'),
      ...models.map((model, index) => el('option', { value: index }, model.provider + ' · ' + model.name)));
    const priorIndex = models.findIndex(model => model.model === previous?.model && model.endpointId === previous?.endpointId);
    const preferred = models.findIndex(model => model.preferred);
    const tiiny = models.findIndex(model => !model.endpointId);
    if (priorIndex < 0) autoTriage.checked = false;
    modelSelect.value = [priorIndex, preferred, tiiny].find(index => index >= 0) ?? '';
    modelSelect.disabled = models.length === 0;
    modelStatus.textContent = models.length
      ? 'Only public headlines are sent to the selected model.'
      : 'Load a chat model in Spindle Models or add a local endpoint in Settings, then try again.';
  } catch (error) {
    modelStatus.textContent = error.message;
  } finally {
    detectButton.disabled = false;
    if (!modelSelect.value) autoTriage.checked = false;
    renderControls();
  }
});

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

showTab(location.hash === '#live');
async function readSnapshot() {
  try {
    render(await api('reports'));
  } catch {
    status.textContent = 'Could not read the local cache.';
  }
}
void readSnapshot();
