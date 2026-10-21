import { getStore } from '@netlify/blobs';
import { createLiftHandler } from '../lib/lift-handler.mjs';
export default async (request, context) => createLiftHandler(() => getStore({ name: context.deploy.context === 'production' ? 'lift-reports' : 'lift-reports-preview', consistency: 'strong' }))(request);
export const config = { path: '/api/lifts', rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 15 } };
