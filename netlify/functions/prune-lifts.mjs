import { handle } from '../lib/rust-adapter.mjs';
export default (request,context)=>handle(request,context,'/internal/prune-lifts');
export const config = {schedule:'0 7 * * *'};
