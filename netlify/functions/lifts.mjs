import { getStore } from '@netlify/blobs';
import { createLiftHandler } from '../lib/lift-handler.mjs';
export default async (request, context) => createLiftHandler(() => getStore({ name: context.deploy.context === 'production' && new URL(request.url).hostname === 'gmi-campus-reports.netlify.app' ? 'lift-reports' : `lift-preview-${context.deploy.id}`, consistency: 'strong' }))(request);
export const config = { path: '/api/lifts', rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 15 } };
