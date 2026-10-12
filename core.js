export const TIMEZONE = 'Asia/Kuala_Lumpur';
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
export function addDays(value, amount) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function monday(value) {
  const day = new Date(value + 'T12:00:00Z').getUTCDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
}
export function localToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function clampWeek(date, start, end) {
  const week = monday(date);
  return week < monday(start) ? monday(start) : week > monday(end) ? monday(end) : week;
}
export function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(new Date(date + 'T12:00:00Z'));
}
export function weekLabel(week) {
  const end = addDays(week, 6);
  const sameMonth = week.slice(0, 7) === end.slice(0, 7);
  return `${formatDate(week, { day: 'numeric', ...(sameMonth ? {} : { month: 'short' }) })} – ${formatDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
export function minutes(time) {
  const [hours, minute] = time.split(':').map(Number);
  return hours * 60 + minute;
}
export function filterEvents(events, week, query = '') {
  const end = addDays(week, 6);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter(event => event.date >= week && event.date <= end && words.every(word => [event.subject, event.lecturer, event.room, event.note].join(' ').toLowerCase().includes(word)));
}
export function shareUrl(base, classId, week) {
  const url = new URL(base);
  url.search = '';
  url.searchParams.set('class', classId);
  url.searchParams.set('week', week);
  return url.href;
}
export function calendarPath(classId) {
  if (!/^\d+$/.test(String(classId))) throw new Error('Invalid class ID');
  return `./calendars/${classId}.ics`;
}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
