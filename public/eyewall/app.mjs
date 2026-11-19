import { incidents, categories, featured, seedDate, snapshot, publicUrl } from './incidents.mjs';

import { createGlobe } from './globe.mjs';

const $ = selector => document.querySelector(selector);
const dateInput = $('#as-of');
const searchInput = $('#search');
const categoryInput = $('#category');
const details = $('#details');
const list = $('#list');
const map = $('#map');
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const displayDate = date => dateFormat.format(new Date(date));
const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
let asOf = seedDate;
let selection = featured;
let view = 'globe';
let landRequest;
let activeCase;
let playback;
let pins = [];
const globeCanvas = $('#globe');
const scene = $('#scene');
const playButton = $('#play');

function el(name, attrs = {}, ...content) {
  const node = document.createElement(name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...content);
  return node;
}

function time(date) {
  return el('time', { datetime: date }, displayDate(date));
}

function sourceLink(url, label, className = 'source') {
  return el('a', { class: className, href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function button(label, onClick, attrs = {}) {
  const node = el('button', { type: 'button', ...attrs }, label);
  node.addEventListener('click', onClick);
  return node;
}

function categoryTag(record) {
  return el('span', { class: 'tag ' + record.category }, categories[record.category]);
}

for (const [value, label] of Object.entries(categories)) {
  categoryInput.append(el('option', { value }, label));
}

function choose(id, control) {
  document.dispatchEvent(new Event('eyewall:case-selected'));
  stopReplay();
  selection = id;
  render(false);
  if (isLocated(activeCase) && view === 'globe') {
    globe.locate(activeCase.geo.lon, activeCase.geo.lat);
  }
  if (control === 'row') {
    const heading = details.querySelector('h2');
    heading?.focus({ preventScroll: true });
    if (heading && heading.getBoundingClientRect().top < 0) {
      details.scrollIntoView({ block: 'start' });
    }
  } else {
    document.querySelector('[data-pin="' + id + '"]')?.focus({ preventScroll: true });
  }
}

function renderList(records) {
  const rows = records.map(record => {
    const row = button(
      el('span', { class: 'row-meta' }, categoryTag(record), time(record.events.at(-1).date)),
      () => choose(record.id, 'row'),
      { class: 'incident-row', 'aria-pressed': selection === record.id, 'data-row': record.id },
    );
    row.append(
      el('span', { class: 'row-title' }, record.title),
      el('span', { class: 'row-subtitle' }, record.geo.label),
    );
    return el('li', {}, row);
  });
  list.replaceChildren(rows.length
    ? el('ul', { class: 'incident-list' }, ...rows)
    : el('p', { class: 'empty' }, 'No matching incidents in this snapshot.'));
}

function fact(label, value) {
  return el('div', {}, el('dt', {}, label), el('dd', {}, value));
}

function renderDetails(record) {
  if (!record) {
    details.replaceChildren(el('p', { class: 'empty' }, 'Try another search, category, or date to view an incident.'));
    return;
  }
  const head = el('div', { class: 'detail-head' },
    el('p', { class: 'detail-kicker' }, 'Incident brief'),
    el('h2', { tabindex: '-1' }, record.title),
    el('div', { class: 'detail-tags' }, categoryTag(record), el('span', { class: 'tag neutral' }, record.evidence)),
    el('p', { class: 'detail-summary' }, record.summary),
  );
  const facts = el('dl', { class: 'facts' },
    fact('Attribution', record.attribution),
    fact('Impact area', record.geo.label),
  );
  const events = record.events.map(event => el('li', {},
    el('div', { class: 'event-meta' }, time(event.date), ' · ' + event.label),
    el('h3', {}, event.title),
    el('p', {}, event.text),
    sourceLink(event.url, event.source),
  ));
  const timeline = el('section', { class: 'timeline', 'aria-labelledby': 'timeline-title' },
    el('header', { class: 'timeline-head' },
      el('h3', { class: 'section-title', id: 'timeline-title' }, 'Source timeline'),
      el('span', { class: 'section-meta' }, plural(events.length, 'update')),
    ),
    el('ol', { tabindex: '0', 'aria-label': 'Sources in publication order' }, ...events),
  );
  details.replaceChildren(head, facts, timeline);
}

function flatCoordinates(lon, lat) {
  return [(lon + 180) / 360, (83 - lat) / 148];
}

async function drawMap() {
  const canvas = $('#map-canvas');
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const point = (lon, lat) => {
    const [x, y] = flatCoordinates(lon, lat);
    return [x * width, y * height];
  };
  context.strokeStyle = '#263c54';
  context.beginPath();
  for (let lon = -150; lon <= 150; lon += 30) {
    context.moveTo(...point(lon, 83));
    context.lineTo(...point(lon, -65));
  }
  for (let lat = -60; lat <= 75; lat += 15) {
    context.moveTo(...point(-180, lat));
    context.lineTo(...point(180, lat));
  }
  context.stroke();
  const response = await fetch(new URL('./world.geojson', import.meta.url));
  if (!response.ok) throw new Error('Basemap request failed');
  const land = await response.json();
  context.fillStyle = '#234e5d';
  context.strokeStyle = '#4f8390';
  context.beginPath();
  for (const { geometry } of land.features) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        context.moveTo(...point(...ring[0]));
        for (const [lon, lat] of ring.slice(1)) context.lineTo(...point(lon, lat));
        context.closePath();
      }
    }
  }
  context.fill('evenodd');
  context.stroke();
}

function isLocated(record) {
  return Number.isFinite(record?.geo.lat) && Number.isFinite(record?.geo.lon);
}

function placePins(projectPoint) {
  for (const { record, node } of pins) {
    const point = projectPoint(record.geo.lon, record.geo.lat);
    node.hidden = !point.visible || point.x < 7 || point.y < 7 ||
      point.x > scene.clientWidth - 7 || point.y > scene.clientHeight - 7;
    node.style.left = point.x + 'px';
    node.style.top = point.y + 'px';
  }
}

function placeFlatPins() {
  const bounds = $('#map-canvas').getBoundingClientRect();
  const base = scene.getBoundingClientRect();
  placePins((lon, lat) => {
    const [x, y] = flatCoordinates(lon, lat);
    return { x: bounds.left - base.left + bounds.width * x, y: bounds.top - base.top + bounds.height * y, visible: true };
  });
}

function renderPins(records) {
  pins = records.filter(isLocated).map(record => ({
    record,
    node: button(el('span', { class: 'pin-label', 'aria-hidden': 'true' }, record.geo.label),
      () => choose(record.id, 'pin'),
      {
        class: 'pin ' + record.category, 'aria-label': record.title + ' · ' + record.geo.label,
        'aria-pressed': selection === record.id, 'data-pin': record.id, hidden: '',
      },
    ),
  }));
  $('#map-pins').replaceChildren(...pins.map(({ node }) => node));
  if (view === 'globe') globe.redraw();
  else placeFlatPins();
}

function render(refreshPins = true) {
  const query = searchInput.value.trim().toLowerCase();
  const category = categoryInput.value;
  const records = snapshot(incidents, asOf).filter(record => {
    const fields = [record.title, categories[record.category], record.geo.label, record.attribution, record.summary,
      ...record.events.flatMap(event => [event.title, event.source, event.text])];
    return (!category || category === record.category) && fields.some(field => field.toLowerCase().includes(query));
  }).sort((a, b) => b.events.at(-1).date.localeCompare(a.events.at(-1).date));
  activeCase = records.find(record => record.id === selection) ?? records[0];
  selection = activeCase?.id ?? selection;
  $('#count').textContent = records.length;
  $('#located').textContent = records.filter(isLocated).length;
  $('#updates').textContent = records.reduce((count, record) => count + record.events.length, 0);
  if (refreshPins) renderPins(records);
  else for (const { record, node } of pins) node.setAttribute('aria-pressed', selection === record.id);
  renderList(records);
  renderDetails(activeCase);
  renderPlayback();
}

function setDate(value) {
  dateInput.value = value;
  asOf = value;
  $('#latest').disabled = value === seedDate;
  render();
}

const stopFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
function replayDates() {
  const record = incidents.find(item => item.id === activeCase?.id);
  return record ? [...new Set(record.events.map(event => event.date))] : [];
}

function renderPlayback() {
  const dates = replayDates();
  $('#playback-case').textContent = activeCase?.title ?? 'Select an incident to replay its sources.';
  playButton.disabled = dates.length < 2;
  playButton.textContent = playback ? 'Pause replay' : 'Play timeline';
  const current = dates.findLast(date => date <= asOf);
  $('#milestones').replaceChildren(...dates.map(date => {
    const control = button(stopFormat.format(new Date(date)), () => {
      stopReplay();
      setDate(date);
      document.querySelector('[data-date="' + date + '"]')?.focus();
    }, {
      class: 'milestone' + (date > asOf ? ' future' : ''), 'aria-label': 'View as of ' + displayDate(date),
      'data-date': date,
    });
    if (date === current) control.setAttribute('aria-current', 'date');
    return control;
  }));
}

function stopReplay() {
  if (!playback) return;
  clearTimeout(playback);
  playback = null;
  playButton.textContent = 'Play timeline';
}

function startReplay() {
  const dates = replayDates();
  if (dates.length < 2) return;
  let step = 0;
  function advance() {
    playback = step < dates.length - 1 ? setTimeout(advance, 2600) : null;
    setDate(dates[step++]);
    if (activeCase?.id !== initialId) stopReplay();
  }
  const initialId = activeCase.id;
  searchInput.value = '';
  advance();
}

function showProjection(mode) {
  view = mode;
  const flatMode = mode === 'map';
  map.hidden = !flatMode;
  globeCanvas.hidden = flatMode;
  $('#scene-tools').hidden = flatMode;
  $('#map-view').setAttribute('aria-pressed', flatMode);
  $('#globe-view').setAttribute('aria-pressed', !flatMode);
  $('#map-note').textContent = flatMode ? 'Approximate impact locations' : 'Drag to rotate';
  $('#texture-credit').textContent = flatMode ? 'Natural Earth' : 'NASA Blue Marble';
  if (flatMode) {
    landRequest ??= drawMap().catch(() => {
      if (view === 'map') $('#map-note').textContent = 'Basemap unavailable. Cases are listed below.';
    });
    placeFlatPins();
  } else {
    globe.redraw();
  }
}

const globe = createGlobe(globeCanvas, projectPoint => {
  if (view === 'globe') placePins(projectPoint);
}, () => {
  $('#globe-view').disabled = true;
  showProjection('map');
});
new ResizeObserver(() => {
  if (view === 'map') placeFlatPins();
}).observe(scene);
$('#zoom-in').addEventListener('click', () => globe.zoom(.15));
$('#zoom-out').addEventListener('click', () => globe.zoom(-.15));
$('#reset-camera').addEventListener('click', globe.reset);
$('#globe-view').addEventListener('click', () => showProjection('globe'));
$('#map-view').addEventListener('click', () => showProjection('map'));
playButton.addEventListener('click', () => playback ? stopReplay() : startReplay());

dateInput.addEventListener('change', () => {
  if (dateInput.checkValidity()) {
    stopReplay();
    setDate(dateInput.value);
  } else {
    dateInput.reportValidity();
    dateInput.value = asOf;
  }
});
$('#latest').addEventListener('click', () => {
  stopReplay();
  setDate(seedDate);
});
for (const [input, event] of [[searchInput, 'input'], [categoryInput, 'change']]) {
  input.addEventListener(event, () => {
    stopReplay();
    render();
  });
}

const leadDialog = $('#lead-dialog');
const leadForm = $('#lead-form');
const leadMessage = $('#lead-message');
const storageKey = 'spindle-eyewall-leads-v1';

function loadLeads() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(value) ? value.filter(lead =>
      typeof lead?.id === 'string' && typeof lead?.title === 'string' && publicUrl(lead.url),
    ) : [];
  } catch {
    return [];
  }
}

let leads = loadLeads();

function saveLeads(next, message) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
    leads = next;
    leadMessage.textContent = message;
    renderLeads();
    return true;
  } catch {
    leadMessage.textContent = 'Browser storage is unavailable. Your changes could not be saved.';
    return false;
  }
}

function renderLeads() {
  const count = $('#lead-count');
  count.textContent = leads.length;
  count.hidden = !leads.length;
  const rows = leads.map(lead => el('li', {}, el('div', {},
    sourceLink(publicUrl(lead.url), lead.title), el('span', {}, 'Unreviewed · ' + new URL(lead.url).hostname),
  ), button('Remove', () => {
    if (saveLeads(leads.filter(item => item.id !== lead.id), 'Lead removed.')) leadForm.elements.title.focus();
  }, { class: 'button', 'aria-label': 'Remove ' + lead.title })));
  $('#lead-list').replaceChildren(...rows);
  if (!leads.length) $('#lead-list').append(el('li', {}, 'No saved leads.'));
}

$('#open-leads').addEventListener('click', () => {
  leadMessage.textContent = '';
  leadDialog.showModal();
  leadForm.elements.title.focus();
});
$('#close-leads').addEventListener('click', () => leadDialog.close());
leadForm.addEventListener('submit', event => {
  event.preventDefault();
  const title = leadForm.elements.title.value.trim();
  const url = publicUrl(leadForm.elements.url.value.trim());
  if (!title || !url) {
    leadMessage.textContent = 'Enter a title and a public HTTP or HTTPS URL without credentials.';
    return;
  }
  if (leads.some(lead => lead.url === url)) {
    leadMessage.textContent = 'This link is already saved.';
    return;
  }
  if (saveLeads([{ id: crypto.randomUUID(), title, url }, ...leads], 'Lead saved locally.')) leadForm.reset();
});

renderLeads();
setDate(seedDate);
