import { addDays, monday, localToday, clampWeek, formatDate, weekLabel, minutes, filterEvents, shareUrl, calendarPath, escapeHtml as esc, validDate } from './core.js';
import { icon } from './icons.js';
import { classCalendar } from './calendar.js';
import { classDetails, searchClasses } from './class-search.js';

const $ = selector => document.querySelector(selector);
const storageKey = 'gmi-student-class';
const media = window.matchMedia('(max-width: 700px)');
const state = { manifest: null, selected: null, events: [], week: monday(localToday()), day: localToday(), view: 'week', query: '', loading: false, error: '', request: null, localFile: false, generation: 0 };
const classCache = new Map();
let toastTimer;
let importWorker = null;
let cancelImport = null;
let importSequence = 0;
let exportBlobUrl = null;

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
}
function storedClass() { try { return localStorage.getItem(storageKey); } catch { return ''; } }
function saveClass(id) { if (state.localFile) return; try { localStorage.setItem(storageKey, id); } catch { /* Selection still works without browser storage. */ } }
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 5000);
}
function openDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}
function updateUrl() {
  if (state.localFile) { history.replaceState(null, '', location.pathname); return; }
  if (state.selected) history.replaceState(null, '', shareUrl(location.href, state.selected.id, state.week));
}
function renderClassResults() {
  if (!state.manifest) return;
  const query = $('#class-search').value;
  const classes = searchClasses(state.manifest.classes, query, { programme: $('#programme-filter').value, semester: $('#semester-filter').value, group: $('#group-filter').value });
  $('#class-result-count').textContent = `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}${query.trim() ? ' matching your search' : ' available'}`;
  $('#class-results').innerHTML = classes.length ? classes.map(item => `<button class="class-option ${state.selected?.id === item.id ? 'selected' : ''}" data-class-id="${item.id}" ${state.selected?.id === item.id ? 'aria-current="true"' : ''}><span><strong>${esc(item.name)}</strong><small>${item.fuzzy ? 'Close match · ' : ''}${item.eventCount ? `${item.eventCount} dated entries · calendar available` : 'No dated entries in this source'}</small></span>${icon(state.selected?.id === item.id ? 'check' : 'chevron')}</button>`).join('') : '<p class="picker-empty">No matching class. Try fewer words or clear the filters.</p>';
}
function openClassPicker() {
  if (!state.manifest) return;
  $('#class-search').value = '';
  const details = state.manifest.classes.map(item => classDetails(item.name));
  for (const [selector, values, label] of [
    ['#programme-filter', details.flatMap(item => item.programmes), 'All programmes'],
    ['#semester-filter', details.map(item => item.semester), 'All semesters'],
    ['#group-filter', details.map(item => item.group), 'All groups'],
  ]) {
    $(selector).innerHTML = `<option value="">${label}</option>` + [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(value => `<option value="${esc(value)}">${selector === '#semester-filter' ? 'Semester ' : selector === '#group-filter' ? 'Group / team ' : ''}${esc(value)}</option>`).join('');
  }
  renderClassResults();
  openDialog('#class-dialog');
  $('#class-search').focus();
}
async function fetchJson(path, signal) {
  const response = await fetch(path, { cache: 'no-cache', signal });
  if (!response.ok) throw new Error(`Schedule request failed (${response.status})`);
  return response.json();
}
async function selectClass(id, { preserveWeek = true } = {}) {
  const selected = state.manifest?.classes.find(item => item.id === id);
  if (!selected) return;
  state.request?.abort();
  const controller = new AbortController();
  state.request = controller;
  state.selected = selected;
  state.loading = true;
  state.error = '';
  state.events = [];
  state.query = '';
  $('#subject-search').value = '';
  if (!preserveWeek) state.week = clampWeek(localToday(), state.manifest.planningStart, state.manifest.planningEnd);
  saveClass(id);
  updateUrl();
  $('#class-dialog').close();
  render();
  try {
    const dataset = classCache.get(id) || await fetchJson(`./data/${id}.json`, controller.signal);
    if (controller.signal.aborted) return;
    if (dataset.class.id !== id || !Array.isArray(dataset.events)) throw new Error('Invalid class dataset');
    classCache.set(id, dataset);
    state.events = dataset.events;
    state.loading = false;
    render();
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.loading = false;
    state.error = 'We couldn’t load this class’s timetable. Check your connection and try again.';
    render();
  }
}
function setWeek(date) {
  if (!state.manifest || !validDate(date)) return;
  const previousDayOffset = Math.max(0, Math.min(6, Math.round((Date.parse(state.day) - Date.parse(state.week)) / 86400000)));
  state.week = clampWeek(date, state.manifest.planningStart, state.manifest.planningEnd);
  const today = localToday();
  state.day = today >= state.week && today <= addDays(state.week, 6) ? today : addDays(state.week, previousDayOffset);
  updateUrl();
  render();
}
function exceptionsFor(date) {
  return [...new Set(state.manifest.exceptions.filter(item => item.date === date).map(item => item.name))];
}
function card(event, index = 0) {
  const tone = event.subject.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return `<button class="lesson ${tone === 1 ? 'alt' : tone === 2 ? 'warm' : ''}" data-event-id="${event.id}" aria-label="${esc(event.subject)}, ${esc(event.start)} to ${esc(event.end)}, ${esc(event.room || 'room not listed')}"><span class="lesson-time">${icon('clock')}${esc(event.start)} – ${esc(event.end)}</span><h3>${esc(event.subject)}</h3><span class="lesson-meta">${icon('pin')}<span>${esc(event.room || 'Room not listed')}</span></span>${event.lecturer ? `<span class="lesson-meta">${icon('person')}<span>${esc(event.lecturer)}</span></span>` : ''}${event.note ? `<p class="lesson-note">${esc(event.note)}</p>` : ''}${event.exception ? '<span class="badge amber">Calendar exception</span>' : ''}${event.overlap ? '<span class="badge amber">Overlapping entry</span>' : ''}</button>`;
}
function renderWeek(events) {
  const today = localToday();
  return `<div class="week-grid">${Array.from({ length: 7 }, (_, day) => {
    const date = addDays(state.week, day);
    const lessons = events.filter(event => event.date === date);
    const exceptions = exceptionsFor(date);
    return `<section class="day-column ${day > 4 ? 'weekend' : ''}" aria-label="${esc(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}"><h2 class="day-heading ${date === today ? 'current' : ''}"><span>${formatDate(date, { weekday: 'short' }).toUpperCase()}</span><strong>${formatDate(date, { day: 'numeric' })}</strong></h2>${exceptions.map(name => `<span class="day-exception">${esc(name)}</span>`).join('')}${lessons.length ? lessons.map(card).join('') : '<p class="no-day"><span></span>No classes</p>'}</section>`;
  }).join('')}</div>`;
}
function renderAgenda(events) {
  const dates = media.matches ? [state.day] : Array.from({ length: 7 }, (_, i) => addDays(state.week, i));
  return `<div class="agenda-list">${dates.map(date => {
    const lessons = events.filter(event => event.date === date);
    const exceptions = exceptionsFor(date);
    if (!lessons.length && !exceptions.length && !media.matches) return '';
    return `<section class="agenda-day"><div class="agenda-day-heading"><h2>${formatDate(date, { weekday: 'long' })}<span>${formatDate(date, { day: 'numeric', month: 'long' })}</span></h2>${date === localToday() ? '<span class="badge">Today</span>' : ''}</div>${exceptions.map(name => `<span class="day-exception">${esc(name)}</span>`).join('')}${lessons.length ? `<div class="agenda-events">${lessons.map(card).join('')}</div>` : `<div class="state-panel"><div class="state-illustration">${icon('calendar')}</div><h2>${state.query ? 'No matching lessons' : 'A little breathing room'}</h2><p>${state.query ? 'Try a different subject, room or lecturer.' : 'No class entries are listed for this day. Choose another day above.'}</p>${state.query ? '<button class="button secondary" data-action="clear-search">Clear search</button>' : ''}</div>`}</section>`;
  }).join('')}</div>`;
}
function renderDayStrip(events) {
  $('#day-strip').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(state.week, i);
    return `<button class="day-tab ${date === state.day ? 'active' : ''} ${date === localToday() ? 'today' : ''}" data-day="${date}" aria-label="${esc(formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))}" aria-pressed="${date === state.day}"><span>${formatDate(date, { weekday: 'short' })}</span><strong>${formatDate(date, { day: 'numeric' })}</strong><span class="day-marker" style="${events.some(event => event.date === date) ? '' : 'visibility:hidden'}"></span></button>`;
  }).join('');
}
function renderSummary(events) {
  const hours = events.reduce((sum, event) => sum + minutes(event.end) - minutes(event.start), 0) / 60;
  const rooms = new Set(events.map(event => event.room).filter(Boolean)).size;
  $('#summary').innerHTML = [{ value: events.length, label: 'lessons this week', icon: 'book' }, { value: Number(hours.toFixed(1)), label: 'scheduled hours', icon: 'clock' }, { value: rooms, label: 'rooms this week', icon: 'pin' }].map(item => `<div class="summary-item"><span class="summary-icon">${icon(item.icon)}</span><div><strong>${item.value}</strong><small>${item.label}</small></div></div>`).join('');
}
function statePanel(title, description, action, actionLabel, image = 'calendar') {
  return `<div class="state-panel"><div class="state-illustration">${icon(image)}</div><h2>${title}</h2><p>${description}</p>${action ? `<button class="button primary" data-action="${action}">${actionLabel}${icon('chevron')}</button>` : ''}</div>`;
}
function render() {
  const manifest = state.manifest;
  const ready = Boolean(manifest);
  const selected = state.selected;
  const usable = Boolean(selected && !state.loading && !state.error);
  $('#class-name').textContent = selected?.name || 'Let’s get you started';
  $('#compact-class-name').textContent = selected?.name || 'Choose your class';
  $('#mobile-class-name').textContent = selected?.name || '';
  $('#class-button small').textContent = selected ? 'Your timetable' : 'Choose your class';
  $('#class-button').disabled = $('#compact-class-button').disabled = !ready;
  $('#share-button').disabled = !usable || state.localFile;
  $('#share-button').title = state.localFile ? 'Your local file cannot be shared through a website link. Export its class calendar instead.' : 'Share this class and week';
  $('#file-source-label').textContent = state.localFile ? `On this device: ${state.manifest.filename}` : 'Using the provided timetable';
  $('#restore-source').hidden = !state.localFile;
  $('#revision').textContent = state.localFile ? 'Source · your local file' : 'Source revision · 9 Oct 2026';
  $('#about-source-description').textContent = state.localFile ? `You’re viewing ${state.manifest.filename}, read locally on this device. The planning range is ${state.manifest.planningStart} through ${state.manifest.planningEnd}.` : 'This planner was recovered from the GMI timetable file revised on 9 October 2026. It covers January 2026 through January 2027.';
  $('#class-dialog .dialog-description').textContent = state.localFile ? 'Choose your class from this file. Reopen the file after refreshing the page.' : 'Choose your exact class or team. We’ll remember it on this device.';
  document.querySelectorAll('.export-trigger').forEach(button => { button.disabled = !usable || !selected.eventCount; });
  $('.mobile-export').hidden = !selected;
  $('#summary').hidden = !usable;
  $('#subbar').hidden = !usable;
  $('#day-strip').hidden = !usable;
  $('#week-label').textContent = ready ? weekLabel(state.week) : 'Loading schedule…';
  $('#week-date').disabled = !ready;
  $('#week-date').value = state.week;
  if (manifest) {
    $('#week-date').min = manifest.planningStart;
    $('#week-date').max = manifest.planningEnd;
    $('#previous-week').disabled = state.week <= monday(manifest.planningStart);
    $('#next-week').disabled = state.week >= monday(manifest.planningEnd);
    $('#today-button').disabled = false;
  }
  $('#week-view').classList.toggle('active', state.view === 'week');
  $('#agenda-view').classList.toggle('active', state.view === 'agenda');
  $('#week-view').setAttribute('aria-pressed', state.view === 'week');
  $('#agenda-view').setAttribute('aria-pressed', state.view === 'agenda');
  const schedule = $('#schedule');
  schedule.setAttribute('aria-busy', state.loading || !ready ? 'true' : 'false');
  $('#greeting').textContent = selected ? 'YOUR CLASS. YOUR SCHEDULE.' : 'YOUR STUDENT PLANNER';
  $('#heading-description').textContent = selected ? `${selected.name} · Times in Kuala Lumpur` : 'Less searching. More time for what’s next.';
  if (state.error) {
    schedule.setAttribute('aria-busy', 'false');
    schedule.innerHTML = statePanel('Let’s try that again', esc(state.error), 'retry', 'Retry', 'info');
    return;
  }
  if (state.loading || !ready) {
    schedule.innerHTML = `<div class="state-panel"><span class="loading-spinner"></span><h2>${selected ? 'Loading your class' : 'Getting your planner ready'}</h2><p>${selected ? 'Just your timetable, nothing else.' : 'Loading the available classes…'}</p></div>`;
    return;
  }
  if (!selected) {
    schedule.innerHTML = statePanel('Your timetable starts here', 'Pick your class to see your week. Or download its calendar and use the calendar app you already love.', 'choose-class', 'Find my class');
    return;
  }
  const allWeek = filterEvents(state.events, state.week);
  const events = filterEvents(state.events, state.week, state.query);
  renderSummary(allWeek);
  renderDayStrip(events);
  $('#schedule-context').textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'}${state.query ? ' matching your search' : ' on your schedule'}`;
  if (!events.length && !media.matches) {
    const next = state.events.find(event => event.date > addDays(state.week, 6));
    schedule.innerHTML = statePanel(state.query ? 'Nothing matches that search' : 'No classes listed this week', state.query ? 'Try a different subject, room or lecturer.' : next ? `Your next scheduled entry is ${esc(formatDate(next.date, { day: 'numeric', month: 'long' }))}.` : selected.eventCount ? 'There are no more dated entries in this source. You can view an earlier week or download the full class calendar.' : 'This class has no dated entries in the recovered source. Choose another class or check with your lecturer.', state.query ? 'clear-search' : next ? 'next-scheduled' : 'choose-class', state.query ? 'Clear search' : next ? 'Go to next class' : 'Choose another class');
    return;
  }
  schedule.innerHTML = media.matches || state.view === 'agenda' ? renderAgenda(events) : renderWeek(events);
}
function openLesson(id) {
  const event = state.events.find(item => item.id === id);
  if (!event) return;
  const row = (symbol, label, value) => `<div class="detail-row">${icon(symbol)}<div><small>${label}</small><strong>${esc(value)}</strong></div></div>`;
  $('#lesson-content').innerHTML = `<p class="lesson-title-date">${formatDate(event.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><h2 id="lesson-dialog-title">${esc(event.subject)}</h2><p class="lesson-class">${esc(state.selected.name)}</p>${row('clock', 'TIME · KUALA LUMPUR', `${event.start} – ${event.end}`)}${row('pin', 'ROOM', event.room || 'Not listed in source')}${row('person', 'LECTURER', event.lecturer || 'Not listed in source')}${event.note ? row('info', 'NOTES', event.note) : ''}<div class="lesson-flags">${event.exception ? `<span class="badge amber">${esc(event.exception)} — calendar exception</span>` : ''}${event.overlap ? '<span class="badge amber">Overlaps another class entry. Check with your lecturer.</span>' : ''}<span class="badge">Reconstructed · confirm changes with your lecturer</span></div>`;
  openDialog('#lesson-dialog');
}
function openExport() {
  if (!state.selected || state.loading || state.error || !state.selected.eventCount) return;
  const selected = state.selected;
  if (exportBlobUrl) { URL.revokeObjectURL(exportBlobUrl); exportBlobUrl = null; }
  let downloadPath = calendarPath(selected.id);
  if (state.localFile) {
    exportBlobUrl = URL.createObjectURL(new Blob([classCalendar(selected, state.events)], { type: 'text/calendar;charset=utf-8' }));
    downloadPath = exportBlobUrl;
  }
  $('#export-content').innerHTML = `<p class="dialog-description">Keep your class timetable in the calendar app you already use.</p><div class="export-class"><strong>${esc(selected.name)}</strong><p>${selected.eventCount} entries · ${formatDate(selected.firstDate, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(selected.lastDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div><a id="calendar-download" class="button primary full download-link" href="${downloadPath}" download="GMI-${selected.id}.ics">${icon('download')}Download my class calendar (.ics)</a><div class="export-notice">${icon('info')}<span>Only this class’s full schedule is included. Times use Kuala Lumpur (UTC+8), and entries are marked tentative. Check changes with your lecturer.</span></div><p class="calendar-import-label">HOW TO ADD THE FILE</p><details open><summary>Google Calendar</summary><p>On a computer, open Google Calendar → Settings → Import &amp; export. Select the downloaded .ics file, choose a calendar, then Import.</p><a href="https://support.google.com/calendar/answer/37118?hl=en" target="_blank" rel="noopener">Google’s import guide ${icon('external')}</a></details><details><summary>Apple Calendar</summary><p>On a Mac, open Calendar → File → Import. Choose the downloaded .ics file, select a calendar, then confirm. Device import options may vary.</p><a href="https://support.apple.com/guide/calendar/icl1023/mac" target="_blank" rel="noopener">Apple’s import guide ${icon('external')}</a></details><details><summary>Outlook</summary><p>In Outlook on the web, choose Add calendar → Upload from file. Select the .ics file and your destination calendar, then Import.</p><a href="https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web" target="_blank" rel="noopener">Outlook’s import guide ${icon('external')}</a></details><p class="export-footnote">This download is a snapshot; it won’t update automatically. Import into a separate class calendar so you can replace it when a new schedule is published. Importing repeatedly may create duplicates.</p>`;
  openDialog('#export-dialog');
}
async function shareWeek() {
  if (!state.selected) return;
  const url = shareUrl(location.href, state.selected.id, state.week);
  try {
    if (media.matches && navigator.share) {
      await navigator.share({ title: state.selected.name + ' timetable', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Class and week link copied.');
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('#lesson-content').innerHTML = `<h2 id="lesson-dialog-title">Share this week</h2><p class="dialog-description">Copy this link to share the selected class and week.</p><label class="search-field"><input id="share-link" type="text" aria-label="Class and week link" value="${esc(url)}" readonly></label>`;
    openDialog('#lesson-dialog');
    $('#share-link').select();
  }
}
function openFilePicker() {
  $('#file-input').value = '';
  $('#file-error').hidden = true;
  $('#file-progress').hidden = true;
  openDialog('#file-dialog');
}
async function importFile(file) {
  if (!file) return;
  const sequence = ++importSequence;
  $('#file-error').hidden = true;
  $('#file-progress').hidden = false;
  $('#file-progress').textContent = `Reading ${file.name} on your device…`;
  $('#file-input').disabled = true;
  let timeout;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Choose a timetable file smaller than 20 MB.');
    const buffer = await file.arrayBuffer();
    if (sequence !== importSequence || !$('#file-dialog').open) return;
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./file-worker.js', import.meta.url), { type: 'module' });
      importWorker = worker;
      cancelImport = () => { worker.terminate(); reject(Object.assign(new Error('File import cancelled'), { name: 'AbortError' })); };
      timeout = setTimeout(() => { worker.terminate(); reject(new Error('This file took too long to decode. Try a smaller compatible .dav file.')); }, 20000);
      worker.onmessage = event => { worker.terminate(); cancelImport = null; event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error)); };
      worker.onerror = () => { worker.terminate(); reject(new Error('The timetable reader could not start. Refresh the page and try again.')); };
      worker.postMessage({ buffer, filename: file.name }, [buffer]);
    });
    if (sequence !== importSequence || !$('#file-dialog').open) return;
    state.generation++;
    state.request?.abort();
    const previousId = state.selected?.id;
    state.localFile = true;
    state.manifest = result.manifest;
    state.selected = null;
    state.events = [];
    state.error = '';
    state.loading = false;
    state.query = '';
    $('#subject-search').value = '';
    classCache.clear();
    for (const [id, dataset] of Object.entries(result.datasets)) classCache.set(id, dataset);
    state.week = clampWeek(localToday(), state.manifest.planningStart, state.manifest.planningEnd);
    state.day = state.week;
    updateUrl();
    render();
    importWorker = null;
    $('#file-dialog').close();
    if (previousId && classCache.has(previousId)) await selectClass(previousId);
    toast(`${result.manifest.classes.length} classes loaded from your file.${result.omitted ? ' Unplaced or unverified slots were excluded from dated entries.' : ''}`);
    openClassPicker();
  } catch (error) {
    if (error.name === 'AbortError' || sequence !== importSequence) return;
    $('#file-error').textContent = error.message || 'This file could not be read.';
    $('#file-error').hidden = false;
  } finally {
    clearTimeout(timeout);
    if (sequence === importSequence) {
      importWorker?.terminate();
      importWorker = null;
      cancelImport = null;
      $('#file-input').disabled = false;
      $('#file-progress').hidden = true;
    }
  }
}
async function restoreProvidedSchedule() {
  state.request?.abort();
  state.localFile = false;
  state.selected = null;
  state.manifest = null;
  state.events = [];
  state.loading = false;
  classCache.clear();
  if (exportBlobUrl) { URL.revokeObjectURL(exportBlobUrl); exportBlobUrl = null; }
  await initialize();
  toast('The provided timetable is active again.');
}
async function initialize() {
  const generation = ++state.generation;
  state.error = '';
  render();
  try {
    const manifest = await fetchJson('./data/manifest.json');
    if (generation !== state.generation) return;
    state.manifest = manifest;
    const query = new URLSearchParams(location.search);
    const date = query.get('week');
    state.week = clampWeek(validDate(date) ? date : localToday(), state.manifest.planningStart, state.manifest.planningEnd);
    const today = localToday();
    state.day = today >= state.week && today <= addDays(state.week, 6) ? today : state.week;
    const id = query.get('class') || storedClass();
    if (state.manifest.classes.some(item => item.id === id)) await selectClass(id);
    else render();
  } catch {
    if (generation !== state.generation) return;
    state.error = 'We couldn’t load the class list. Check your connection and try again.';
    render();
  }
}
hydrateIcons();
$('#open-file-button').addEventListener('click', openFilePicker);
$('#file-input').addEventListener('change', event => importFile(event.target.files[0]));
$('#restore-source').addEventListener('click', restoreProvidedSchedule);
$('#file-dialog').addEventListener('close', () => {
  if (cancelImport) { cancelImport(); cancelImport = null; }
  importSequence++;
  importWorker?.terminate(); importWorker = null;
  $('#file-input').disabled = false;
  $('#file-progress').hidden = true;
});
$('#class-button').addEventListener('click', openClassPicker);
$('#compact-class-button').addEventListener('click', openClassPicker);
$('#class-search').addEventListener('input', renderClassResults);
for (const selector of ['#programme-filter', '#semester-filter', '#group-filter']) $(selector).addEventListener('change', renderClassResults);
$('#clear-class-filters').addEventListener('click', () => { $('#class-search').value = ''; for (const selector of ['#programme-filter', '#semester-filter', '#group-filter']) $(selector).value = ''; renderClassResults(); $('#class-search').focus(); });
$('#class-results').addEventListener('click', event => {
  const button = event.target.closest('[data-class-id]');
  if (button) selectClass(button.dataset.classId);
});
$('#previous-week').addEventListener('click', () => setWeek(addDays(state.week, -7)));
$('#next-week').addEventListener('click', () => setWeek(addDays(state.week, 7)));
$('#today-button').addEventListener('click', () => setWeek(localToday()));
$('#week-date').addEventListener('change', event => setWeek(event.target.value));
$('#week-view').addEventListener('click', () => { state.view = 'week'; render(); });
$('#agenda-view').addEventListener('click', () => { state.view = 'agenda'; render(); });
$('#subject-search').addEventListener('input', event => { state.query = event.target.value; render(); });
$('#share-button').addEventListener('click', shareWeek);
$('#day-strip').addEventListener('click', event => {
  const button = event.target.closest('[data-day]');
  if (button) { state.day = button.dataset.day; render(); }
});
$('#schedule').addEventListener('click', event => {
  const lesson = event.target.closest('[data-event-id]');
  if (lesson) return openLesson(lesson.dataset.eventId);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'choose-class') openClassPicker();
  else if (action === 'retry') state.selected && state.manifest ? selectClass(state.selected.id) : initialize();
  else if (action === 'clear-search') { state.query = ''; $('#subject-search').value = ''; render(); $('#subject-search').focus(); }
  else if (action === 'next-scheduled') {
    const next = state.events.find(item => item.date > addDays(state.week, 6));
    if (next) { setWeek(next.date); state.day = next.date; render(); }
  }
});
document.querySelectorAll('.export-trigger').forEach(button => button.addEventListener('click', openExport));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rectangle = dialog.getBoundingClientRect();
  if (event.clientX < rectangle.left || event.clientX > rectangle.right || event.clientY < rectangle.top || event.clientY > rectangle.bottom) dialog.close();
}));
$('#export-content').addEventListener('click', event => {
  if (event.target.closest('#calendar-download')) toast('Calendar download started. Import the file in your calendar app.');
});
$('#quality-button').addEventListener('click', () => openDialog('#about-dialog'));
$('#about-button').addEventListener('click', () => openDialog('#about-dialog'));
media.addEventListener('change', render);
initialize();
