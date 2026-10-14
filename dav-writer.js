// Patch only decoded fields in the original source; all other bytes remain intact.
import { decodeDav } from './dav-reader.js';
const cp1252 = new TextDecoder('windows-1252');
function encodeText(value) {
  const lookup = new Map(Array.from({length:256}, (_, i) => [cp1252.decode(Uint8Array.of(i)), i]));
  const chars = [...value];
  if (chars.length > 255 || chars.some(c => !lookup.has(c))) throw new Error('DAV notes support up to 255 Windows-1252 characters.');
  return Uint8Array.from([6, chars.length, ...chars.map(c => lookup.get(c))]);
}
export async function editDav(buffer, editor, eventId, { note, day, period }) {
  const record = editor.events[eventId];
  if (!record) throw new Error('This entry cannot be edited.');
  if (!Number.isInteger(day) || day < 1 || day > 7 || !Number.isInteger(period) || period < 1 || period + record.slots.length - 1 > editor.periods.length) throw new Error('Choose a weekday and a start period that fits the whole lesson.');
  const moved = record.slots.some((slot, i) => slot.day !== day || slot.period !== period + i);
  if (moved && record.coupling !== -1) throw new Error('Linked lessons must be moved together in DaVinci. You can edit the notes here.');
  for (let i = 1; i < record.slots.length; i++) if (editor.periods[period + i - 1] !== editor.periods[period + i - 2] + editor.duration) throw new Error('This lesson needs consecutive clock periods.');
  const bytes = new Uint8Array(buffer.slice(0));
  for (const [i, slot] of record.slots.entries()) {
    if (bytes[slot.offset] !== slot.day || bytes[slot.offset+1] !== slot.period) throw new Error('The source changed. Reopen the lesson before editing.');
    bytes[slot.offset] = day; bytes[slot.offset+1] = period+i;
  }
  const encoded = encodeText(note);
  const next = new Uint8Array(bytes.length - (record.noteEnd - record.noteOffset) + encoded.length);
  next.set(bytes.subarray(0,record.noteOffset));next.set(encoded,record.noteOffset);next.set(bytes.subarray(record.noteEnd),record.noteOffset+encoded.length);
  const decoded = await decodeDav(next.buffer);
  return { buffer: next.buffer, decoded };
}
export function davDownload(buffer) { return new Blob([buffer], {type:'application/octet-stream'}); }
