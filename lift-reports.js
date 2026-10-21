import { escapeHtml as esc } from './core.js';
const labels = { working: 'Reported working', intermittent: 'Reported intermittent', 'out-of-service': 'Reported out of service' };
export async function initLiftReports() {
  const dialog = document.querySelector('#lifts-dialog');
  const result = document.querySelector('#lift-results');
  const feedback = document.querySelector('#lift-feedback');
  const form = document.querySelector('#lift-form');
  let endpoint = '';
  try { const response = await fetch('./data/lift-service.json'); if (response.ok) { const config = await response.json(); if (/^https:\/\/[a-z0-9-]+\.netlify\.app\/api\/lifts$/.test(config.endpoint)) endpoint = config.endpoint; } } catch {}
  async function load() {
    result.textContent = 'Loading community observations…';
    if (!endpoint) { result.textContent = 'Shared reporting is not connected yet. No lift condition is known.'; form.hidden = true; return; }
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(10000), cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error(); const data = await response.json();
      if (!Array.isArray(data.reports)) throw new Error();
      const latest = new Map();
      const recent = data.reports.filter(report => labels[report.status] && typeof report.building === 'string' && typeof report.lift === 'string' && Date.now()-Date.parse(report.observedAt)>=0 && Date.now()-Date.parse(report.observedAt)<86400000).sort((a,b)=>b.observedAt.localeCompare(a.observedAt));
      for (const report of recent) { const key = `${report.building.trim().toLowerCase()}\0${report.lift.trim().toLowerCase()}`; if (!latest.has(key)) latest.set(key,report); }
      result.innerHTML = latest.size ? `<ul class="lift-list">${[...latest.values()].map(report=>`<li><strong>${esc(report.building)} · ${esc(report.lift)}</strong><span>${esc(labels[report.status])}</span><small>Observed ${esc(new Date(report.observedAt).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))} MYT${Date.now()-Date.parse(report.observedAt)>7200000?' · Older report; condition may have changed':''}</small></li>`).join('')}</ul>` : '<p>No observations in the last 24 hours. Lift conditions are unknown.</p>';
    } catch { result.textContent = 'Could not load lift reports. Conditions are unknown. Please retry.'; }
  }
  document.querySelector('#lift-refresh').addEventListener('click', load);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!endpoint || !form.reportValidity()) return;
    const button = form.querySelector('[type=submit]'); button.disabled = true; feedback.textContent = 'Sending observation…';
    const values = new FormData(form);
    try {
      const response = await fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(Object.fromEntries(values)), credentials:'omit', signal:AbortSignal.timeout(15000) });
      if (!response.ok) { if (response.status===429) throw new Error('Too many requests. Please wait a minute and retry.'); throw new Error('Could not save this report. Please retry.'); }
      feedback.textContent = 'Observation shared. Thank you. This is a community report, not an official maintenance notice.';
      form.reset(); await load();
    } catch (error) { feedback.textContent = error.message.startsWith('Too many') || error.message.startsWith('Could not save') ? error.message : 'Could not confirm your report. Refresh before retrying to avoid a duplicate.'; }
    finally { button.disabled = false; }
  });
  // The report service is contacted only while a student is viewing this dialog.
  dialog.addEventListener('close', () => { feedback.textContent = ''; });
  await load();
  return load;
}
