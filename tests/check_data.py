#!/usr/bin/env python3
"""Validate every class-only JSON and calendar download."""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1] / 'public'
manifest = json.loads((root / 'data/manifest.json').read_text())
assert len(manifest['classes']) == 178
assert len({item['id'] for item in manifest['classes']}) == 178
all_count = 0
for item in manifest['classes']:
    dataset = json.loads((root / 'data' / f"{item['id']}.json").read_text())
    assert dataset['class'] == item
    events = dataset['events']
    assert len(events) == item['eventCount']
    assert len({event['id'] for event in events}) == len(events)
    raw = (root / 'calendars' / f"{item['id']}.ics").read_bytes()
    assert raw.endswith(b'\r\n')
    assert all(len(line) <= 75 for line in raw.split(b'\r\n'))
    text = raw.decode('utf-8').replace('\r\n ', '')
    calendar_events = text.split('BEGIN:VEVENT\r\n')[1:]
    assert len(calendar_events) == len(events)
    for event, exported in zip(events, calendar_events):
        assert 'UID:' + event['id'] + '@student-timetable.local' in exported
        assert 'STATUS:TENTATIVE' in exported
        day = event['date'].replace('-', '')
        assert 'DTSTART;TZID=Asia/Kuala_Lumpur:' + day + 'T' + event['start'].replace(':', '') + '00' in exported
        assert 'DTEND;TZID=Asia/Kuala_Lumpur:' + day + 'T' + event['end'].replace(':', '') + '00' in exported
        assert event['start'] < event['end']
        assert manifest['planningStart'] <= event['date'] <= manifest['planningEnd']
    all_count += len(events)
assert all_count == 23193
print('PASS: 178 class datasets/calendars; 23,193 events; IDs, counts, dates, times, timezone, folding and tentative status.')
lecturers = manifest['lecturers']
assert len({item['id'] for item in lecturers}) == len(lecturers)
for item in lecturers:
    dataset = json.loads((root / 'lecturers' / f"{item['id']}.json").read_text())
    assert dataset['class'] == item
    assert len(dataset['events']) == item['eventCount']
    assert len({event['id'] for event in dataset['events']}) == item['eventCount']
    assert all(event['lecturer'] == item['name'] and event['className'] and manifest['planningStart'] <= event['date'] <= manifest['planningEnd'] for event in dataset['events'])
assert sum(item['eventCount'] for item in lecturers) == 26443
print(f'PASS: {len(lecturers)} lecturer/resource datasets; 26,443 dated entries with class/activity labels.')
