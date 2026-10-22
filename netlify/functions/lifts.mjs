import { handle } from '../lib/rust-adapter.mjs';
export default (request,context)=>handle(request,context,'/api/lifts');
export const config = { path: '/api/lifts', rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 15 } };
