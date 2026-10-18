import { AIR_SOURCE, AIR_STATIONS, readingState, airTime } from './air-quality.js';
import { escapeHtml as esc } from './core.js';
export function initAirQuality() {
 const region=document.querySelector('#air-quality'), result=document.querySelector('#air-result'), select=document.querySelector('#air-station'), refresh=document.querySelector('#air-refresh');
 const show=html=>{if(result.innerHTML!==html)result.innerHTML=html;};
 let snapshot=null,loading=false,lastAttempt=0,error=false;
 select.innerHTML=AIR_STATIONS.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
 try { const saved=localStorage.getItem('air-reference-station');if(AIR_STATIONS.some(s=>s.id===saved))select.value=saved; } catch {}
 document.querySelector('#air-source').href=AIR_SOURCE;
 function render() {
  region.setAttribute('aria-busy',String(loading)); refresh.disabled=loading;
  const reading=readingState(snapshot,select.value); result.dataset.state=reading.status;
  if (loading && !snapshot) { show('<p>Loading latest station reading…</p>');return; }
  if (reading.status==='unavailable') { show('<p><strong>Reading unavailable</strong></p><p>No recent verified reading is available here. Check the official APIMS source.</p>');return; }
  show(`<p class="air-value"><strong>${reading.value}</strong><span>API / IPU · ${esc(reading.category)}</span></p><p><strong>${reading.status==='stale' ? 'Outdated reading' : 'Latest available reading'}</strong> · ${esc(airTime(reading.observedAt))}</p>${reading.status==='stale' ? '<p>Older than 3 hours. This is a last-known reading, not current conditions.</p>' : ''}${error ? '<p>Refresh failed; showing the last retrieved reading with its original timestamp.</p>' : ''}`);
 }
 async function load() {
  if(loading)return;loading=true;lastAttempt=Date.now();render();
  try {
   const response=await fetch('./data/air-quality.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('Reading request failed');
   const candidate=await response.json();
   if(candidate.schemaVersion!==1||!Array.isArray(candidate.stations))throw new Error('Invalid reading');
   snapshot=candidate;error=false;
  } catch {error=true;}
  finally {loading=false;render();}
 }
 select.addEventListener('change',()=>{try{localStorage.setItem('air-reference-station',select.value);}catch{}render();});
 refresh.addEventListener('click',load);
 setInterval(()=>{if(!document.hidden){render();if(Date.now()-lastAttempt>=15*60000)load();}},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if(Date.now()-lastAttempt>=15*60000)load();}});
 load();
}
