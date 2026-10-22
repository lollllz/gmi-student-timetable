import { handle } from '../lib/rust-adapter.mjs';
export default (request,context)=>handle(request,context,'/api/publish-timetable');
export const config={path:'/api/publish-timetable',rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowSize:300,windowLimit:3}};
