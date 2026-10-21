import { getStore } from '@netlify/blobs';
import { createTimetableHandler } from '../lib/timetable-handler.mjs';
export default async (request,context)=>createTimetableHandler(()=>getStore({name:context.deploy.context==='production' && new URL(request.url).hostname==='gmi-campus-reports.netlify.app'?'community-timetables':`timetable-preview-${context.deploy.id}`,consistency:'strong'}))(request);
export const config={path:'/api/publish-timetable',rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowSize:300,windowLimit:3}};
