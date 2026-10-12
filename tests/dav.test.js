import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeDav } from '../dav-reader.js';
import { classCalendar } from '../calendar.js';
import { makeDavFixture } from './dav-fixture.js';

test('dynamic V30 reader handles different counts, names and period starts', async () => {
  for (const [name, start] of [['CLASS A', 480], ['A much longer class name', 540]]) {
    const result = await decodeDav(makeDavFixture({ className: name, periodStart: start }).buffer, 'new.dav');
    assert.equal(result.manifest.classes.length, 2);
    assert.equal(result.manifest.classes[0].name, name);
    assert.equal(result.total, 1);
    const event = result.datasets['1'].events[0];
    assert.equal(event.date, '2026-07-06');
    assert.equal(event.start, start === 480 ? '08:00' : '09:00');
    assert.equal(event.subject, 'Mathematics');
    assert.equal(result.datasets['2'].events.length, 0);
  }
});
test('local calendar export preserves timezone, class isolation and safe escaping', async () => {
  const result = await decodeDav(makeDavFixture({ subject: 'Math; Lab, A' }).buffer);
  const calendar = classCalendar(result.datasets['1'].class, result.datasets['1'].events);
  assert.equal((calendar.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(calendar.includes('Math\\; Lab\\, A'));
  assert.ok(calendar.includes('DTSTART;TZID=Asia/Kuala_Lumpur:20260706T080000'));
  assert.ok(!calendar.includes('CLASS B'));
  assert.ok(calendar.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
});
test('high-bit record IDs resolve and midnight ends use the next calendar day', async () => {
  const result = await decodeDav(makeDavFixture({ classId: 2147483649 }).buffer);
  assert.equal(result.datasets['2147483649'].events.length, 1);
  const event = { ...result.datasets['2147483649'].events[0], start: '23:00', end: '24:00' };
  const calendar = classCalendar(result.datasets['2147483649'].class, [event]);
  assert.ok(calendar.includes('DTEND;TZID=Asia/Kuala_Lumpur:20260707T000000'));
});
test('unsupported, truncated and oversized files are rejected', async () => {
  await assert.rejects(decodeDav(new TextEncoder().encode('<daVinci/>').buffer), /layout/);
  const fixture = makeDavFixture();
  await assert.rejects(decodeDav(fixture.slice(0, fixture.length - 1).buffer), /layout/);
  await assert.rejects(decodeDav(new ArrayBuffer(20 * 1024 * 1024 + 1)), /20 MB/);
});
test('browser decoder agrees with every published class event in the reference file', { skip: !process.env.DAV_REFERENCE_FILE }, async () => {
  const source = await readFile(process.env.DAV_REFERENCE_FILE);
  const result = await decodeDav(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  assert.equal(result.total, 23193);
  assert.equal(result.manifest.classes.length, 178);
  const canonical = events => events.map(({ id, ...event }) => JSON.stringify(event)).sort();
  for (const item of result.manifest.classes) {
    const expected = JSON.parse(await readFile(new URL(`../public/data/${item.id}.json`, import.meta.url), 'utf8'));
    const actualRows = canonical(result.datasets[item.id].events), expectedRows = canonical(expected.events);
    assert.equal(actualRows.length, expectedRows.length, item.name);
    const mismatch = actualRows.findIndex((row, index) => row !== expectedRows[index]);
    if (mismatch !== -1) assert.equal(actualRows[mismatch], expectedRows[mismatch], item.name);
  }
});
