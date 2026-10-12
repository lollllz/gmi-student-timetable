import { decodeDav } from './dav-reader.js';
self.onmessage = async event => {
  try { self.postMessage({ ok: true, result: await decodeDav(event.data.buffer, event.data.filename) }); }
  catch (error) { self.postMessage({ ok: false, error: error.message || 'This file could not be read.' }); }
};
