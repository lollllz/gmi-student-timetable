import { addDays, monday } from './core.js';

const textDecoder = new TextDecoder('windows-1252');
const MAX_FILE = 20 * 1024 * 1024;
const failure = () => new Error('This file uses a timetable layout we can’t read yet. Supported: compatible legacy .dav files with the V30 format.');
function require(condition) { if (!condition) throw failure(); }
const reference = value => value === -1 ? -1 : value >>> 0;
class Reader {
  constructor(bytes, position = 0) { this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.position = position; }
  take(size) { require(Number.isInteger(size) && size >= 0 && this.position + size <= this.bytes.length); const start = this.position; this.position += size; return start; }
  u8() { return this.view.getUint8(this.take(1)); }
  i8() { return this.view.getInt8(this.take(1)); }
  u16() { return this.view.getUint16(this.take(2), true); }
  i16() { return this.view.getInt16(this.take(2), true); }
  u32() { return this.view.getUint32(this.take(4), true); }
  i32() { return this.view.getInt32(this.take(4), true); }
  f32() { const value = this.view.getFloat32(this.take(4), true); require(Number.isFinite(value)); return value; }
  f64() { const value = this.view.getFloat64(this.take(8), true); require(Number.isFinite(value)); return value; }
  mask() { return this.view.getBigUint64(this.take(8), true); }
  value() {
    const tag = this.u8();
    if (tag === 2) return this.i8();
    if (tag === 3) return this.i16();
    if (tag === 4) return this.i32();
    if (tag === 15) return this.f32();
    if (tag === 8 || tag === 9) return tag === 9;
    if (tag === 6) { const length = this.u8(); const start = this.take(length); return textDecoder.decode(this.bytes.subarray(start, start + length)); }
    throw failure();
  }
  count(maximum) { const value = this.value(); require(Number.isInteger(value) && value >= 0 && value <= maximum); return value; }
}
function dateSerial(value) {
  require(Number.isFinite(value) && value >= 32874 && value <= 73416);
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
}
function activeBits(mask) { return Array.from({ length: 64 }, (_, bit) => bit).filter(bit => !(mask & (1n << BigInt(bit)))); }
function countBefore(bytes, position, maximum) {
  for (const [length, tag] of [[2, 2], [3, 3], [5, 4]]) {
    if (position >= length && bytes[position - length] === tag) {
      const reader = new Reader(bytes, position - length);
      try { const count = reader.count(maximum); if (count > 0 && reader.position === position) return count; } catch { /* Try another integer width. */ }
    }
  }
  return 0;
}
function namedRecords(bytes) {
  const result = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let marker = 4; marker < bytes.length - 4; marker++) {
    if (bytes[marker] !== 2 || bytes[marker + 1] !== 255 || bytes[marker + 2] !== 6) continue;
    const size = bytes[marker + 3];
    if (!size || marker + 4 + size > bytes.length) continue;
    const value = bytes.subarray(marker + 4, marker + 4 + size);
    if (value.some(byte => byte < 32 || byte === 127)) continue;
    result.push({ position: marker - 4, id: view.getUint32(marker - 4, true), name: textDecoder.decode(value) });
  }
  return result;
}
function calendarSection(bytes, firstName) {
  for (let position = 4; position < firstName; position++) {
    if (bytes[position + 25] !== 6 || !bytes.subarray(position + 16, position + 24).every(value => value === 255)) continue;
    const count = countBefore(bytes, position, 2000);
    if (!count) continue;
    try {
      const reader = new Reader(bytes, position);
      const exceptions = [];
      for (let index = 0; index < count; index++) {
        const start = dateSerial(reader.f64()), end = dateSerial(reader.f64());
        require(start <= end && reader.i32() === -1 && reader.i32() === -1);
        const kind = reader.u8();
        require(kind <= 10);
        const name = reader.value();
        require(typeof name === 'string');
        exceptions.push({ start, end, name: name.trim() });
      }
      reader.take(8);
      const classes = reader.count(5000);
      require(classes > 0 && reader.position === firstName);
      return { classes, exceptions, start: position };
    } catch { /* This byte sequence is not the calendar section. */ }
  }
  throw failure();
}
function periodsSection(bytes, before, duration) {
  for (let position = 64; position < before; position++) {
    if (bytes[position] !== 6) continue;
    try {
      const reader = new Reader(bytes, position);
      const title = reader.value();
      require(typeof title === 'string' && title.length >= 3);
      require(typeof reader.value() === 'string');
      require(typeof reader.value() === 'boolean');
      const count = reader.count(48);
      require(count > 0);
      const periods = [];
      for (let index = 0; index < count; index++) { const start = reader.u16(); const flags = reader.take(8); require(bytes.subarray(flags, flags + 8).every(value => value === 0)); require(start + duration <= 1440 && (!index || start > periods[index - 1])); periods.push(start); }
      require(reader.position < before);
      return { title, periods };
    } catch { /* Continue looking for a valid clock table. */ }
  }
  throw failure();
}
function parseTimetable(bytes, position, patternCount, periods) {
  const reader = new Reader(bytes, position);
  const patterns = [];
  for (let index = 0; index < patternCount; index++) {
    const id = reader.u32();
    require(reader.value() === -1);
    const name = reader.value(), short = reader.value();
    require(typeof name === 'string' && typeof short === 'string');
    const mask = reader.mask();
    for (let field = 0; field < 4; field++) reader.f32();
    patterns.push({ id, name, bits: activeBits(mask) });
  }
  const groups = reader.count(5000);
  for (let group = 0; group < groups; group++) {
    reader.u32(); require(reader.value() === -1);
    require(typeof reader.value() === 'string' && typeof reader.value() === 'string');
    reader.take(reader.count(10000) * 24);
  }
  const lessonCount = reader.count(30000);
  require(lessonCount > 0 && reader.value() === 0);
  const lessons = [], lessonIds = new Set(), slotIds = new Set();
  for (let index = 0; index < lessonCount; index++) {
    const id = reader.u32(); require(!lessonIds.has(id)); lessonIds.add(id);
    const refs = Array.from({ length: 4 }, () => reference(reader.i32()));
    const count = reader.count(1000), slots = [];
    for (let slotIndex = 0; slotIndex < count; slotIndex++) {
      const slotId = reader.u32(); require(!slotIds.has(slotId)); slotIds.add(slotId);
      require(slotIds.size <= 150000 && reader.u32() === id);
      const rawStart = reader.take(18), layout = bytes.subarray(rawStart, rawStart + 18);
      require(layout[0] <= 7 && layout[1] <= periods.length && layout.subarray(2, 9).every(value => value === 0) && layout[9] === 1 && layout.subarray(10, 17).every(value => value === 0));
      require(reader.value() === 0 && reader.value() === 0);
      const room = reference(reader.i32()), lecturer = reference(reader.i32()); reader.i32();
      slots.push({ offset: rawStart, id: slotId, day: layout[0], period: layout[1], flag: layout[17], room, lecturer });
    }
    reader.i32(); const mask = reader.mask();
    reader.value(); reader.value(); const noteOffset = reader.position; const note = reader.value(); const noteEnd = reader.position;
    require(typeof note === 'string');
    const subject = reference(reader.i32()); reader.i32();
    reader.value(); reader.value(); reader.u8();
    require(typeof reader.value() === 'string' && typeof reader.value() === 'string');
    for (let field = 0; field < 8; field++) reader.value();
    require(typeof reader.value() === 'string'); reader.value();
    const layout = reader.take(11);
    require(reader.view.getUint32(layout + 3, true) === count);
    require(reader.value() === 1 && reader.value() === 6 && reader.value() === '' && reader.value() === 0);
    lessons.push({ id, coupling: refs[0], noteOffset, noteEnd, classId: refs[1], subject, note, bits: activeBits(mask), slots });
  }
  for (let field = 0; field < 3; field++) reader.value();
  const reasons = reader.count(100);
  for (let reason = 0; reason < reasons; reason++) require(typeof reader.value() === 'string');
  reader.take(40);
  for (let field = 0; field < 4; field++) reader.value();
  require(reader.position === bytes.length);
  return { patterns, lessons };
}
function weekAnchor(patterns, start) {
  const explicit = [], generic = [];
  for (const pattern of patterns) {
    const match = /^CW(\d+)(?: (\d{4}))?$/.exec(pattern.name.trim());
    if (!match || pattern.bits.length !== 1 || Number(match[1]) < 1 || Number(match[1]) > 53) continue;
    const year = match[2] || start.slice(0, 4);
    const anchor = addDays(monday(`${year}-01-04`), (Number(match[1]) - 1 - pattern.bits[0]) * 7);
    (match[2] ? explicit : generic).push(anchor);
  }
  const choices = explicit.length ? explicit : generic;
  if (!choices.length) throw new Error('This file has no recognised calendar-week reference. We can’t safely assign lesson dates yet.');
  const counts = new Map();
  for (const choice of choices) counts.set(choice, (counts.get(choice) || 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  require(ranked.length === 1 || ranked[0][1] > ranked[1][1]);
  return ranked[0][0];
}
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export async function decodeDav(buffer, filename = 'Timetable.dav') {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_FILE) throw new Error('Choose a timetable file smaller than 20 MB.');
  require(bytes.length > 200 && bytes[0] === 3 && bytes[1] === 86 && bytes[2] === 51 && bytes[3] === 48);
  const names = namedRecords(bytes); require(names.length > 4);
  const calendar = calendarSection(bytes, names[0].position);
  const dictionary = {}, classRecords = []; let nameIndex = 0;
  for (const [category, initial] of [['classes', calendar.classes], ['staff', 0], ['rooms', 0], ['subjects', 0]]) {
    const count = initial || countBefore(bytes, names[nameIndex]?.position || 0, 5000);
    require(count > 0 && nameIndex + count <= names.length);
    const ids = new Set();
    for (const record of names.slice(nameIndex, nameIndex + count)) {
      require(!ids.has(record.id) && !dictionary[record.id]); ids.add(record.id);
      dictionary[record.id] = { category, name: record.name.trim() };
      if (category === 'classes') classRecords.push({ id: String(record.id), name: record.name.trim() });
    }
    nameIndex += count;
  }
  const header = new Reader(bytes, 50); require(typeof header.value() === 'string');
  const dates = new Reader(bytes, header.position + 7);
  const planningStart = dateSerial(dates.f64()), planningEnd = dateSerial(dates.f64());
  require(planningStart <= planningEnd && Date.parse(planningEnd) - Date.parse(planningStart) <= 86400000 * 900);
  const duration = new DataView(buffer).getUint32(11, true); require(duration >= 1 && duration <= 240);
  const { title, periods } = periodsSection(bytes, calendar.start, duration);
  let timetable;
  for (const record of names.slice(nameIndex)) {
    const count = countBefore(bytes, record.position, 10000);
    if (!count) continue;
    try { timetable = parseTimetable(bytes, record.position, count, periods); break; } catch { /* Try the next structurally possible section. */ }
  }
  require(timetable);
  const anchor = weekAnchor(timetable.patterns, planningStart);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
  const exceptions = [], exceptionMap = new Map();
  for (const exception of calendar.exceptions) {
    require(Date.parse(exception.end) - Date.parse(exception.start) <= 86400000 * 900);
    for (let date = exception.start; date <= exception.end; date = addDays(date, 1)) {
      exceptions.push({ date, name: exception.name || 'Calendar exception' });
      const current = exceptionMap.get(date) || []; current.push(exception.name || 'Unlabelled exception'); exceptionMap.set(date, current);
    }
  }
  const datasets = Object.fromEntries(classRecords.map(item => [item.id, { class: item, events: [] }]));
  let total = 0, omitted = 0; const lecturerEvents = [], editorEvents = {};
  for (const lesson of timetable.lessons) {
    const target = datasets[String(lesson.classId)], subject = dictionary[lesson.subject];
    if (subject?.category !== 'subjects') continue;
    const grouped = new Map();
    for (const slot of lesson.slots) {
      if (!slot.day || !slot.period || slot.flag) { omitted++; continue; }
      const key = `${slot.day}/${slot.lecturer}/${slot.room}`;
      const slots = grouped.get(key) || []; slots.push(slot); grouped.set(key, slots);
    }
    for (const slots of grouped.values()) {
      slots.sort((a, b) => a.period - b.period || a.id - b.id);
      const blocks = [];
      for (const slot of slots) {
        const previous = blocks.at(-1);
        if (previous && slot.period === previous.at(-1).period + 1 && periods[slot.period - 1] === periods[previous.at(-1).period - 1] + duration) previous.push(slot);
        else blocks.push([slot]);
      }
      for (const bit of lesson.bits) {
        const date = addDays(anchor, bit * 7 + slots[0].day - 1);
        if (date < planningStart || date > planningEnd) continue;
        for (const block of blocks) {
          const first = block[0], last = block.at(-1);
          require(lecturerEvents.length < 200000);
          const entry = { id: `${hash.slice(0, 24)}-${lesson.id}-${date.replaceAll('-', '')}-${block.map(slot => slot.id).join('.')}`, date,
            start: clock(periods[first.period - 1]), end: clock(periods[last.period - 1] + duration),
            subject: subject.name, lecturer: dictionary[first.lecturer]?.category === 'staff' ? dictionary[first.lecturer].name : '',
            room: dictionary[first.room]?.category === 'rooms' ? dictionary[first.room].name : '', note: lesson.note.trim(),
            exception: (exceptionMap.get(date) || []).join('; '), overlap: false };
          editorEvents[entry.id] = { lessonId: lesson.id, coupling: lesson.coupling, noteOffset: lesson.noteOffset, noteEnd: lesson.noteEnd, note: lesson.note, slots: block };
          lecturerEvents.push({ ...entry, className: target?.class.name || 'Resource / activity' });
          if (target) { target.events.push(entry); total++; }
        }
      }
    }
  }
  for (const dataset of Object.values(datasets)) {
    dataset.events.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
    const days = new Map();
    for (const event of dataset.events) { const day = days.get(event.date) || []; day.push(event); days.set(event.date, day); }
    for (const day of days.values()) for (const event of day) event.overlap = day.some(other => other.id !== event.id && event.start < other.end && other.start < event.end);
    Object.assign(dataset.class, { eventCount: dataset.events.length, firstDate: dataset.events[0]?.date || null, lastDate: dataset.events.at(-1)?.date || null });
  }
  const classes = classRecords.sort((a, b) => a.name.localeCompare(b.name));
  const lecturers = [...new Set(lecturerEvents.map(e => e.lecturer).filter(Boolean))].sort().map((name, index) => ({ id: String(index + 1), name }));
  return { editor: { events: editorEvents, periods, duration, staff: Object.entries(dictionary).filter(([,v]) => v.category === 'staff').map(([id,v]) => ({ id, name:v.name })) }, lecturerEvents, manifest: { sourceHash: hash, lecturers, title, timezone: 'Asia/Kuala_Lumpur', sourceRevision: 'Your local file', filename, planningStart, planningEnd, reconstructed: true, classes, exceptions }, datasets, omitted, total };
}
