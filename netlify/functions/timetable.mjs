import { handle } from '../lib/rust-adapter.mjs';
export default (request,context)=>handle(request,context,'/api/timetable');
export const config={path:'/api/timetable',rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowSize:60,windowLimit:60}};
