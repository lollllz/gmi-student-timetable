let service;
export async function timetableEndpoint(){
 if(!service)service=fetch('./data/lift-service.json').then(response=>response.json()).then(config=>/^https:\/\/[a-z0-9-]+\.netlify\.app\/api\/lifts$/.test(config.endpoint)?config.endpoint.replace(/lifts$/,'timetable'):'').catch(()=>'');
 return service;
}
export async function latestCommunityManifest(){
 const endpoint=await timetableEndpoint();if(!endpoint)return null;
 const response=await fetch(endpoint,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});if(response.status===404)return null;if(!response.ok)throw new Error('unavailable');
 const manifest=await response.json();
 if(!manifest.communityUpload||!/^[a-f0-9]{64}$/.test(manifest.sourceHash)||!Array.isArray(manifest.classes)||!Array.isArray(manifest.lecturers))throw new Error('invalid');
 return {...manifest,serviceEndpoint:endpoint};
}
export function initCommunityUpload(onPublished){
 const form=document.querySelector('#publish-form'),feedback=document.querySelector('#publish-feedback');
 form.addEventListener('submit',async event=>{
  event.preventDefault();const file=document.querySelector('#publish-file').files[0];if(!file)return;
  const button=form.querySelector('[type=submit]');button.disabled=true;feedback.textContent='Validating and publishing… Keep this dialog open.';
  try{
   const endpoint=await timetableEndpoint();if(!endpoint)throw new Error('Shared publishing is not connected yet.');
   if(file.size>4*1024*1024)throw new Error('Shared uploads must be 4 MB or smaller. Larger files can still be opened locally.');
   const response=await fetch(endpoint.replace(/timetable$/,'publish-timetable'),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Timetable-Filename':encodeURIComponent(file.name)},body:file,credentials:'omit',signal:AbortSignal.timeout(60000)});
   if(response.status===429)throw new Error('Upload limit reached. Please wait five minutes and refresh before retrying.');
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not publish. Refresh to check the latest revision before retrying.');
   feedback.textContent=data.unchanged?'This file is already published.':'Published. This is now the shared default timetable.';await onPublished();
  }catch(error){feedback.textContent=error.name==='TimeoutError'?'Could not confirm publication. Refresh to check the latest revision before retrying.':error.message;}
  finally{button.disabled=false;}
 });
}
