import { handle } from '../lib/rust-adapter.mjs';
export default (request,context)=>handle(request,context,'/internal/prune-timetables');
export const config={schedule:'30 7 * * *'};
