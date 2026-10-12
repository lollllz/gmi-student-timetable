// Small synthetic V30 timetable; contains no recovered institutional data.
export function makeDavFixture({ className = 'CLASS A', classId = 1, periodStart = 480, subject = 'Mathematics' } = {}) {
  const pieces = [];
  const bytes = (...values) => Uint8Array.from(values);
  const raw = (method, size, value) => { const buffer = new ArrayBuffer(size); new DataView(buffer)[method](0, value, true); return new Uint8Array(buffer); };
  const u32 = value => raw('setUint32', 4, value);
  const i32 = value => raw('setInt32', 4, value);
  const f64 = value => raw('setFloat64', 8, value);
  const f32 = value => raw('setFloat32', 4, value);
  const integer = value => bytes(2, value & 255);
  const string = value => { const payload = new TextEncoder().encode(value); return Uint8Array.from([6, payload.length, ...payload]); };
  const append = (...values) => pieces.push(...values);
  const named = (id, name) => [u32(id), integer(-1), string(name)];
  const header = new Uint8Array(50); header.set(bytes(3, 86, 51, 48)); new DataView(header.buffer).setUint32(11, 60, true);
  append(header, string('Campus'), new Uint8Array(7), f64(46023), f64(46418), new Uint8Array(16));
  append(string('New semester'), string(''), bytes(9), integer(2));
  for (const start of [periodStart, periodStart + 60]) append(raw('setUint16', 2, start), new Uint8Array(8));
  append(integer(1), f64(46209), f64(46209), i32(-1), i32(-1), bytes(3), string('Campus holiday'), new Uint8Array(8));
  append(integer(2), ...named(classId, className), ...named(2, 'CLASS B'));
  append(integer(1), ...named(3, 'Example lecturer'));
  append(integer(1), ...named(4, 'Room 1'));
  append(integer(1), ...named(5, subject));
  const mask = raw('setBigUint64', 8, ((1n << 64n) - 1n) ^ (1n << 28n));
  append(integer(1), ...named(6, 'CW28'), string(''), mask, f32(1), f32(60), f32(1), f32(1));
  append(integer(1), ...named(7, 'Group container'), string(''), integer(1), u32(10), new Uint8Array(20));
  append(integer(1), integer(0), u32(8), i32(-1), i32(classId), i32(3), i32(4), integer(1));
  const slot = new Uint8Array(18); slot[0] = 1; slot[1] = 1; slot[9] = 1;
  append(u32(9), u32(8), slot, integer(0), integer(0), i32(4), i32(3), i32(-1));
  append(i32(6), mask, integer(0), integer(0), string('From the new file'), i32(5), i32(0));
  append(integer(0), integer(0), bytes(0), string('Example lecturer'), string('Room 1'));
  for (let index = 0; index < 4; index++) append(integer(0));
  for (const value of [1, 60, 1, 60]) append(bytes(15), f32(value));
  append(string(''), integer(0), bytes(0, 0, 127), u32(1), u32(0), integer(1), integer(6), string(''), integer(0));
  append(integer(0), integer(0), integer(0), integer(1), string('Absent'), new Uint8Array(40));
  for (let index = 0; index < 4; index++) append(integer(0));
  const result = new Uint8Array(pieces.reduce((size, piece) => size + piece.length, 0));
  let offset = 0; for (const piece of pieces) { result.set(piece, offset); offset += piece.length; }
  return result;
}
