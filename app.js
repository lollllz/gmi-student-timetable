import { addDays, monday, localToday, clampWeek, formatDate, weekLabel, minutes, filterEvents, shareUrl, calendarPath, escapeHtml as esc, validDate } from './core.js';
import { hazeAdvisory, hazeActive, needsModeCheck, sourceSaysOnline } from './advisories.js';
import { icon } from './icons.js';
let classDetails, searchClasses;

const $ = selector => document.querySelector(selector);
const storageKey = 'gmi-student-class';
const media = window.matchMedia('(max-width: 700px)');
const state = { manifest: null, selected: null, events: [], week: monday(localToday()), day: localToday(), view: 'week', query: '', loading: false, error: '', request: null, localFile: false, generation: 0, mode: 'class', davBuffer: null, editor: null, editId: null };
const classCache = new Map();
let toastTimer;
let importWorker = null;
let cancelImport = null;
let importSequence = 0;
let exportBlobUrl = null;
const lecturerCache = new Map();
const choices = () => state.mode === 'lecturer' ? state.manifest?.lecturers || [] : state.manifest?.classes || [];
function applyPreferences() {
  for (const id of ['large-text','high-contrast','reduce-motion']) document.documentElement.classList.toggle(id, $('#' + id).checked);
}
function installLocal(result, buffer) {
  state.davBuffer = buffer; state.editor = result.editor; state.manifest = result.manifest;
  classCache.clear(); lecturerCache.clear();
  for (const [id,dataset] of Object.entries(result.datasets)) classCache.set(id,dataset);
  for (const lecturer of result.manifest.lecturers) {
    const events = result.lecturerEvents.filter(e => e.lecturer === lecturer.name);
    const days = new Map(); for (const event of events) { const day = days.get(event.date) || []; day.push(event); days.set(event.date,day); }
    for (const day of days.values()) for (const event of day) event.overlap = day.some(other => other.id !== event.id && event.start < other.end && other.start < event.end);
    Object.assign(lecturer, {eventCount:events.length,firstDate:events[0]?.date || null,lastDate:events.at(-1)?.date || null});
    events.sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    lecturer.firstDate = events[0]?.date || null; lecturer.lastDate = events.at(-1)?.date || null;
    lecturerCache.set(lecturer.id,{class:lecturer,events});
  }
}


function renderHazeAdvisory() {
  const region = $('#haze-advisory'); region.hidden = !hazeActive();
  $('#haze-brief').hidden = !hazeActive();
  let collapsed = false;
  try { collapsed = localStorage.getItem(hazeAdvisory.id + '-collapsed') === 'true'; } catch {}
  $('#haze-details').hidden = collapsed;
  $('#haze-toggle').setAttribute('aria-expanded',String(!collapsed));
  $('#haze-toggle').textContent = collapsed ? 'Show haze reminder' : 'Hide haze reminder';
  $('#haze-air-link').href = hazeAdvisory.airQualityUrl;
  $('#haze-health-link').href = hazeAdvisory.healthUrl;
}
function modeReminder(event) {
  if (sourceSaysOnline(event)) return 'Online · source note';
  return needsModeCheck(event) ? 'Confirm class delivery' : '';
}
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
  if (state.selected) { const url = new URL(shareUrl(location.href, state.selected.id, state.week)); if (state.mode === 'lecturer') { url.searchParams.delete('class'); url.searchParams.set('lecturer',state.selected.id); } history.replaceState(null,'',url); }
}
function renderClassResults() {
  if (!state.manifest) return;
  const query = $('#class-search').value;
  const classes = state.mode === 'lecturer' ? choices().filter(item => query.toLowerCase().trim().split(/\s+/).every(word => item.name.toLowerCase().includes(word))) : searchClasses(state.manifest.classes, query, { programme: $('#programme-filter').value, semester: $('#semester-filter').value, group: $('#group-filter').value });
  $('#class-result-count').textContent = state.mode === 'lecturer' ? `${classes.length} lecturer / resource timetables` : `${classes.length} ${classes.length === 1 ? 'class' : 'classes'}${query.trim() ? ' matching your search' : ' available'}`;
  $('#class-results').innerHTML = classes.length ? classes.map(item => `<button class="class-option ${state.selected?.id === item.id ? 'selected' : ''}" data-class-id="${item.id}" ${state.selected?.id === item.id ? 'aria-current="true"' : ''}><span><strong>${esc(item.name)}</strong><small>${item.fuzzy ? 'Close match · ' : ''}${item.eventCount ? `${item.eventCount} dated entries · calendar available` : 'No dated entries in this source'}</small></span>${icon(state.selected?.id === item.id ? 'check' : 'chevron')}</button>`).join('') : '<p class="picker-empty">No matching class. Try fewer words or clear the filters.</p>';
}
async function openClassPicker() {
  try { ({ classDetails, searchClasses } = await import('./class-search.js')); } catch { toast('Could not load class search. Please try again.'); return; }
  if (!state.manifest) return;
  $('#class-dialog-title').textContent = state.mode === 'lecturer' ? 'Find a lecturer' : 'Find your class';
  $('#class-search').placeholder = state.mode === 'lecturer' ? 'Search lecturer name…' : 'Try semester 3 dmch or dswe group 2…';
  $('#class-search').setAttribute('aria-label',state.mode === 'lecturer' ? 'Search lecturers' : 'Search classes');
  $('.class-filters').hidden = state.mode === 'lecturer';
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
  const selected = choices().find(item => item.id === id);
  const pickerOpen = $('#class-dialog').open; const mode = state.mode;
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
  if (mode === 'class') saveClass(id);
  updateUrl();
  $('#class-dialog').close();
  render();
  try {
    const cache = mode === 'lecturer' ? lecturerCache : classCache;
    const sharedPath = state.manifest.serviceEndpoint ? `${state.manifest.serviceEndpoint}?resource=${mode}&id=${encodeURIComponent(id)}&release=${state.manifest.sourceHash}` : null;
    const dataset = cache.get(id) || await fetchJson(sharedPath || (mode === 'lecturer' ? `./lecturers/${id}.json` : `./data/${id}.json`), controller.signal);
    if (controller.signal.aborted) return;
    if (dataset.class.id !== id || !Array.isArray(dataset.events)) throw new Error('Invalid class dataset');
    cache.set(id, dataset);
    state.events = dataset.events;
    state.loading = false;
    render();
    if (pickerOpen) $('#main').focus();
    toast(`${selected.name} timetable loaded.`);
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
  const mode = modeReminder(event);
  const tone = event.subject.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return `<button class="lesson ${tone === 1 ? 'alt' : tone === 2 ? 'warm' : ''}" data-event-id="${event.id}" aria-label="${esc(event.subject)}, ${esc(event.start)} to ${esc(event.end)}, ${esc(event.room || 'room not listed')}, ${esc(event.date)}, ${esc(event.className || state.selected?.name || '')}${event.exception ? ' calendar exception' : ''}${event.overlap ? ' overlapping entry' : ''}${mode ? ', ' + esc(mode) : ''}"><span class="lesson-time">${icon('clock')}${esc(event.start)} – ${esc(event.end)}</span><h3>${esc(event.subject)}</h3>${mode ? `<span class="badge mode-badge">${esc(mode)}</span>` : ''}${state.mode === 'lecturer' ? `<span class="lesson-meta">${esc(event.className)}</span>` : ''}<span class="lesson-meta">${icon('pin')}<span>${esc(event.room || 'Room not listed')}</span></span>${event.lecturer ? `<span class="lesson-meta">${icon('person')}<span>${esc(event.lecturer)}</span></span>` : ''}${event.note ? `<p class="lesson-note">${esc(event.note)}</p>` : ''}${event.exception ? '<span class="badge amber">Calendar exception</span>' : ''}${event.overlap ? '<span class="badge amber">Overlapping entry</span>' : ''}</button>`;
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
  renderHazeAdvisory();
  const focusedDay = document.activeElement?.dataset.day;
  if (focusedDay) requestAnimationFrame(() => $(`[data-day="${focusedDay}"]`)?.focus());
  const manifest = state.manifest;
  const ready = Boolean(manifest);
  const selected = state.selected;
  const usable = Boolean(selected && !state.loading && !state.error);
  $('#student-mode').setAttribute('aria-pressed',state.mode === 'class');
  $('#student-mode').disabled = $('#lecturer-mode').disabled = !ready;
  $('#lecturer-mode').setAttribute('aria-pressed',state.mode === 'lecturer');
  $('#dav-export').disabled = !state.davBuffer;
  $('#dav-hint').textContent = state.davBuffer ? 'Local edits affect recurring lessons. Export DAV saves the full file; verify it in DaVinci.' : 'To edit and export a DAV, open your original file. Downloads preserve the full timetable.';
  $('#class-name').textContent = selected?.name || 'Let’s get you started';
  $('#compact-class-name').textContent = selected?.name || (state.mode === 'lecturer' ? 'Choose a lecturer' : 'Choose your class');
  $('#mobile-class-name').textContent = selected?.name || '';
  $('.mobile-export small').textContent = state.mode === 'lecturer' ? 'LECTURER CALENDAR' : 'YOUR CLASS CALENDAR';
  $('#class-button small').textContent = state.mode === 'lecturer' ? 'Lecturer timetable' : selected ? 'Your timetable' : 'Choose your class';
  $('#compact-class-button small').textContent = state.mode === 'lecturer' ? 'LECTURER' : 'YOUR CLASS';
  $('#class-dialog .dialog-footnote').textContent = state.mode === 'lecturer' ? 'Lecturer calendars include all classes and resource activities listed in this source.' : 'Class calendars contain only that class’s entries.';
  $('#class-button').disabled = $('#compact-class-button').disabled = !ready;
  $('#share-button').disabled = !usable || state.localFile;
  $('#share-button').title = state.localFile ? 'Your local file cannot be shared through a website link. Export its class calendar instead.' : 'Share this class and week';
  $('#file-source-label').textContent = state.localFile ? `On this device: ${state.manifest.filename}` : state.manifest?.communityUpload ? 'Community-uploaded timetable · not verified by GMI' : 'Using the provided timetable';
  $('#restore-source').hidden = !state.localFile;
  const notice = $('#latest-timetable');
  notice.hidden = !manifest;
  if (manifest) {
    const label = state.localFile ? 'Local file loaded' : `${manifest.revisionCode || 'Latest'} · ${manifest.sourceRevisionDate ? formatDate(manifest.sourceRevisionDate,{day:'numeric',month:'short',year:'numeric'}) : manifest.sourceRevision}`;
    let unread = false;
    try { unread = !state.localFile && localStorage.getItem('timetable-seen-revision') !== manifest.sourceHash; } catch { /* Still show the revision when storage is unavailable. */ }
    $('#latest-timetable-label').textContent = label;
    $('#revision-new-dot').hidden = !unread;
    notice.setAttribute('aria-label',`${unread ? 'New timetable loaded. ' : ''}${label}. View timetable source details`);
    notice.title = state.localFile ? manifest.filename : `${manifest.communityUpload ? "Community-uploaded" : "Latest provided"} timetable: ${manifest.sourceFilename || manifest.sourceRevision}`;
  }
  $('#revision').textContent = state.localFile ? 'Source · your local file' : `Source revision · ${manifest?.sourceRevision || 'loading'}`;
  $('#about-source-description').textContent = state.localFile ? `You’re viewing ${state.manifest.filename}, read locally on this device. The planning range is ${state.manifest.planningStart} through ${state.manifest.planningEnd}.` : manifest ? `${manifest.communityUpload ? 'Community-uploaded timetable (not verified by GMI)' : 'Latest provided timetable'}: ${manifest.sourceFilename || manifest.title}. Revision ${manifest.revisionCode || ''}, dated ${manifest.sourceRevision}. Planning range: ${manifest.planningStart} through ${manifest.planningEnd}. Calendar downloads are snapshots; replace an older imported calendar to use this revision.` : 'Loading timetable source details…';
  $('#class-dialog .dialog-description').textContent = state.mode === 'lecturer' ? 'Search a lecturer or resource name to see entries across all classes. Source resource names may include activities.' : state.localFile ? 'Choose your class from this file. Reopen the file after refreshing the page.' : 'Choose your exact class or team. We’ll remember it on this device.';
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
  $('#greeting').textContent = state.mode === 'lecturer' ? 'LECTURER TIMETABLE · ALL CLASSES' : selected ? 'YOUR CLASS. YOUR SCHEDULE.' : 'YOUR STUDENT PLANNER';
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
    schedule.innerHTML = statePanel('Your timetable starts here', state.mode === 'lecturer' ? 'Choose a lecturer to see lessons across all classes and export their calendar.' : 'Pick your class to see your week. Or download its calendar and use the calendar app you already love.', 'choose-class', state.mode === 'lecturer' ? 'Find a lecturer' : 'Find my class');
    return;
  }
  const allWeek = filterEvents(state.events, state.week);
  const events = filterEvents(state.events, state.week, state.query);
  renderSummary(allWeek);
  renderDayStrip(events);
  $('#schedule-context').textContent = `${events.length} ${events.length === 1 ? 'entry' : 'entries'} · ${media.matches ? formatDate(state.day,{weekday:'long',day:'numeric',month:'short'}) : weekLabel(state.week)}${state.query ? ' matching your search' : ' on your schedule'}`;
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
  $('#lesson-content').innerHTML = `<p class="lesson-title-date">${formatDate(event.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><h2 id="lesson-dialog-title">${esc(event.subject)}</h2><p class="lesson-class">${esc(event.className || state.selected.name)}</p>${row('clock', 'TIME · KUALA LUMPUR', `${event.start} – ${event.end}`)}${row('pin', 'ROOM', event.room || 'Not listed in source')}${row('person', 'LECTURER', event.lecturer || 'Not listed in source')}${event.note ? row('info', 'NOTES', event.note) : ''}<div class="lesson-flags">${event.exception ? `<span class="badge amber">${esc(event.exception)} — calendar exception</span>` : ''}${event.overlap ? '<span class="badge amber">Overlaps another class entry. Check with your lecturer.</span>' : ''}<span class="badge">Reconstructed · confirm changes with your lecturer</span></div>`;
  if (sourceSaysOnline(event) || needsModeCheck(event)) {
    const message = sourceSaysOnline(event) ? 'The timetable note says online. Confirm the latest arrangements and meeting link with your lecturer.' : 'Haze may affect class delivery. This lesson is not confirmed online. Check your lecturer’s latest message or GMI announcements before travelling.';
    $('#lesson-content').insertAdjacentHTML('beforeend',`<div class="lesson-mode-notice"><strong>Class delivery</strong><p>${message}</p></div>`);
  }
  if (state.davBuffer && state.editor?.events[id]) $('#lesson-content').insertAdjacentHTML('beforeend',`<button id="edit-lesson" class="button secondary" data-edit-id="${esc(id)}">Edit recurring lesson</button>`);
  openDialog('#lesson-dialog');
}
async function openExport() {
  if (!state.selected || state.loading || state.error || !state.selected.eventCount) return;
  const selected = state.selected, exportEvents = state.events, exportMode = state.mode;
  if (exportBlobUrl) { URL.revokeObjectURL(exportBlobUrl); exportBlobUrl = null; }
  let downloadPath = '';
  if (!state.localFile && !state.manifest.communityUpload && state.mode === 'class') downloadPath = calendarPath(selected.id);
  if (state.localFile || state.manifest.communityUpload || state.mode === 'lecturer') {
    let classCalendar; try { ({ classCalendar } = await import('./calendar.js')); } catch { toast('Could not load calendar export. Please try again.'); return; }
    if (state.selected !== selected || state.mode !== exportMode || state.events !== exportEvents) return;
    exportBlobUrl = URL.createObjectURL(new Blob([classCalendar(selected, exportEvents)], { type: 'text/calendar;charset=utf-8' }));
    downloadPath = exportBlobUrl;
  }
  $('#export-content').innerHTML = `<p class="dialog-description">Keep your class timetable in the calendar app you already use.</p><div class="export-class"><strong>${esc(selected.name)}</strong><p>${selected.eventCount} entries · ${formatDate(selected.firstDate, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(selected.lastDate, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div><a id="calendar-download" class="button primary full download-link" href="${downloadPath}" download="GMI-${selected.id}.ics">${icon('download')}Download ${state.mode === 'lecturer' ? 'lecturer' : 'my class'} calendar (.ics)</a><div class="export-notice">${icon('info')}<span>${state.mode === 'lecturer' ? 'This lecturer’s full schedule across classes and resource activities is included.' : 'Only this class’s full schedule is included.'} Times use Kuala Lumpur (UTC+8), and entries are marked tentative. Check changes with your lecturer.</span></div><p class="calendar-import-label">HOW TO ADD THE FILE</p><details open><summary>Google Calendar</summary><p>On a computer, open Google Calendar → Settings → Import &amp; export. Select the downloaded .ics file, choose a calendar, then Import.</p><a href="https://support.google.com/calendar/answer/37118?hl=en" target="_blank" rel="noopener">Google’s import guide ${icon('external')}</a></details><details><summary>Apple Calendar</summary><p>On a Mac, open Calendar → File → Import. Choose the downloaded .ics file, select a calendar, then confirm. Device import options may vary.</p><a href="https://support.apple.com/guide/calendar/icl1023/mac" target="_blank" rel="noopener">Apple’s import guide ${icon('external')}</a></details><details><summary>Outlook</summary><p>In Outlook on the web, choose Add calendar → Upload from file. Select the .ics file and your destination calendar, then Import.</p><a href="https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web" target="_blank" rel="noopener">Outlook’s import guide ${icon('external')}</a></details><p class="export-footnote">This download is a snapshot; it won’t update automatically. Import into a separate class calendar so you can replace it when a new schedule is published. Importing repeatedly may create duplicates.</p>`;
  openDialog('#export-dialog');
}
async function shareWeek() {
  if (!state.selected) return;
  const shared = new URL(shareUrl(location.href, state.selected.id, state.week)); if (state.mode === 'lecturer') { shared.searchParams.delete('class'); shared.searchParams.set('lecturer',state.selected.id); } const url = shared.href;
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
    const retainedBuffer = buffer.slice(0);
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
    installLocal(result, retainedBuffer);
    state.selected = null;
    state.events = [];
    state.error = '';
    state.loading = false;
    state.query = '';
    $('#subject-search').value = '';

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
  state.localFile = false; state.davBuffer = null; state.editor = null; state.mode = 'class'; lecturerCache.clear();
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
    state.mode = query.has('lecturer') ? 'lecturer' : 'class';
    const id = query.get(state.mode) || (state.mode === 'class' ? storedClass() : '');
    if (choices().some(item => item.id === id)) await selectClass(id);
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
initialize().then(checkCommunitySchedule).finally(() => import('./air-quality-ui.js').then(({ initAirQuality }) => initAirQuality()).catch(() => { $('#air-brief').textContent = 'Air quality unavailable'; }));

for (const id of ['large-text','high-contrast','reduce-motion','agenda-default']) {
  try { $('#' + id).checked = localStorage.getItem('timetable-' + id) === 'true'; } catch {}
  $('#' + id).addEventListener('change',() => { try { localStorage.setItem('timetable-' + id,String($('#' + id).checked)); } catch {} if (id === 'agenda-default') state.view = $('#' + id).checked ? 'agenda' : 'week'; applyPreferences(); render(); });
}
applyPreferences(); if ($('#agenda-default').checked) state.view = 'agenda';
$('#accessibility-button').addEventListener('click',() => openDialog('#accessibility-dialog'));
for (const mode of ['class','lecturer']) $('#' + (mode === 'class' ? 'student' : 'lecturer') + '-mode').addEventListener('click',() => {
  state.request?.abort(); state.mode = mode; state.selected = null; state.events = []; state.loading = false; state.error = ''; history.replaceState(null,'',location.pathname); render(); openClassPicker();
});
$('#dav-export').addEventListener('click',async () => {
  if (!state.davBuffer) return;
  const buffer = state.davBuffer;
  let davDownload; try { ({ davDownload } = await import('./dav-writer.js')); } catch { toast('Could not load DAV export. Please try again.'); return; }
  if (buffer !== state.davBuffer) return;
  const url = URL.createObjectURL(davDownload(buffer)); const a = document.createElement('a');
  a.href = url; a.download = 'edited-' + (state.manifest.filename || 'Timetable.dav'); a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  toast('DAV downloaded. Verify this experimental export in DaVinci before distributing.');
});
$('#lesson-content').addEventListener('click',event => {
  const id = event.target.closest('[data-edit-id]')?.dataset.editId; if (!id) return;
  state.editId = id; const record = state.editor.events[id];
  $('#edit-note').value = record.note;
  $('#edit-day').innerHTML = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((name,i) => `<option value="${i+1}">${name}</option>`).join(''); $('#edit-day').value = record.slots[0].day;
  $('#edit-period').innerHTML = state.editor.periods.map((start,i) => `<option value="${i+1}">${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')} (period ${i+1})</option>`).join(''); $('#edit-period').value = record.slots[0].period;
  $('#edit-error').hidden = true; openDialog('#edit-dialog');
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#save-edit').disabled = true; $('#edit-error').hidden = true;
  try {
    const selected = state.selected.id, week = state.week, filename = state.manifest.filename;
    const { editDav } = await import('./dav-writer.js');
    const result = await editDav(state.davBuffer,state.editor,state.editId,{note:$('#edit-note').value,day:Number($('#edit-day').value),period:Number($('#edit-period').value)});
    result.decoded.manifest.filename = filename; installLocal(result.decoded,result.buffer);
    $('#edit-dialog').close(); $('#lesson-dialog').close(); await selectClass(selected); setWeek(week);
    $('#main').focus();
    toast('Recurring lesson updated locally. Export DAV to save your changes.');
  } catch(error) { $('#edit-error').textContent = error.message; $('#edit-error').hidden = false; }
  finally { $('#save-edit').disabled = false; }
});

$('#latest-timetable').addEventListener('click',() => {
  if (!state.localFile && state.manifest?.sourceHash) { try { localStorage.setItem('timetable-seen-revision',state.manifest.sourceHash); } catch {} }
  render(); openDialog('#about-dialog');
});

$('#haze-toggle').addEventListener('click',() => {
  const collapsed = !$('#haze-details').hidden;
  try { localStorage.setItem(hazeAdvisory.id + '-collapsed',String(collapsed)); } catch {}
  $('#haze-details').hidden = collapsed;
  $('#haze-toggle').setAttribute('aria-expanded',String(!collapsed));
  $('#haze-toggle').textContent = collapsed ? 'Show haze reminder' : 'Hide haze reminder';
});
// Re-evaluate the date window when a tab is revisited, including after midnight.
document.addEventListener('visibilitychange',() => { if (!document.hidden) render(); });


const themeMedia = matchMedia('(prefers-color-scheme: dark)');
let themeChoice = 'system';
try { themeChoice = localStorage.getItem('timetable-theme') || 'system'; } catch {}
function applyTheme() {
  const dark = themeChoice === 'dark' || (themeChoice === 'system' && themeMedia.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme-mode').value = themeChoice;
  $('#theme-toggle').textContent = dark ? 'Light mode' : 'Dark mode';
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}
function saveTheme(choice) { themeChoice = choice; try { localStorage.setItem('timetable-theme', choice); } catch {} applyTheme(); }
$('#theme-toggle').addEventListener('click', () => saveTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('#theme-mode').addEventListener('change', event => saveTheme(event.target.value));
themeMedia.addEventListener('change', applyTheme);
applyTheme();

let liftLoader;
$('#lift-button').addEventListener('click', async () => {
  openDialog('#lifts-dialog');
  try {
    if (!liftLoader) liftLoader = import('./lift-reports.js').then(({initLiftReports})=>initLiftReports()).catch(error=>{liftLoader=null;throw error;});
    else { const reload = await liftLoader; await reload(); return; }
    await liftLoader;
  } catch { $('#lift-results').textContent = 'Could not load lift reports. Please retry.'; }
});

async function checkCommunitySchedule() {
  const generation = state.generation;
  try {
    const { latestCommunityManifest } = await import('./community-timetable.js');
    const manifest = await latestCommunityManifest();
    if (!manifest || state.localFile || generation !== state.generation || manifest.sourceHash === state.manifest?.sourceHash) return;
    const selected = state.selected?.id;
    state.request?.abort(); classCache.clear(); lecturerCache.clear(); state.manifest = manifest;
    state.week = clampWeek(state.week,manifest.planningStart,manifest.planningEnd);
    if (choices().some(item=>item.id===selected)) await selectClass(selected,true);
    else { state.selected=null;state.events=[];state.loading=false;render(); }
    toast('Community timetable loaded. Confirm changes with your lecturer.');
  } catch { /* The provided revision stays explicitly labelled when the shared service cannot be reached. */ }
}
let publishingReady;
$('#publish-button').addEventListener('click',async()=>{
  openDialog('#publish-dialog');
  try { if(!publishingReady){const {initCommunityUpload}=await import('./community-timetable.js');initCommunityUpload(checkCommunitySchedule);publishingReady=true;} }
  catch { $('#publish-feedback').textContent='Could not load publishing tools. Please retry.'; }
});
