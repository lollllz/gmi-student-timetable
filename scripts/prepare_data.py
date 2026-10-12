#!/usr/bin/env python3
"""Produce class-specific student datasets and portable calendar downloads."""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path


def escape_ics(text):
    return str(text).replace('\\', '\\\\').replace('\n', '\\n').replace(';', '\\;').replace(',', '\\,')


def fold_ics(line):
    result, part = [], ''
    for char in line:
        if len((part + char).encode('utf-8')) > 75:
            result.append(part)
            part = ' '
        part += char
    return result + [part]


def prepare(source, public):
    recovered = json.loads((source / 'recovered-data.json').read_text())
    with (source / 'reconstructed-occurrences.csv').open(encoding='utf-8-sig') as file:
        rows = list(csv.DictReader(file))
    grouped = collections.defaultdict(list)
    for row in rows:
        if row['class']:
            grouped[row['class']].append(row)
    data_folder, calendar_folder = public / 'data', public / 'calendars'
    data_folder.mkdir(parents=True, exist_ok=True)
    calendar_folder.mkdir(parents=True, exist_ok=True)
    source_hash = recovered['metadata']['sha256']
    classes = []
    count = 0
    for item in sorted(recovered['dictionaries']['classes'], key=lambda item: item['name'].strip().casefold()):
        identifier, name = str(item['id_raw']), item['name']
        entries = sorted(grouped.pop(name, []), key=lambda row: (row['date'], row['start_local'], row['subject'], row['lesson_id']))
        events = []
        for row in entries:
            uid = hashlib.sha256(f"{source_hash}:{row['lesson_id']}:{row['date']}:{row['slot_ids']}".encode()).hexdigest()[:40]
            events.append({'id': uid, 'date': row['date'], 'start': row['start_local'], 'end': row['end_local'],
                           'subject': row['subject'].strip(), 'lecturer': row['staff'].strip(),
                           'room': row['room'].strip(), 'note': row['note'].strip(),
                           'exception': row['source_calendar_exception'].strip()})
        days = collections.defaultdict(list)
        for event in events:
            days[event['date']].append(event)
        for day in days.values():
            for event in day:
                event['overlap'] = any(other['id'] != event['id'] and event['start'] < other['end'] and other['start'] < event['end'] for other in day)
        count += len(events)
        student_class = {'id': identifier, 'name': name.strip(), 'eventCount': len(events),
                         'firstDate': events[0]['date'] if events else None,
                         'lastDate': events[-1]['date'] if events else None}
        classes.append(student_class)
        (data_folder / f'{identifier}.json').write_text(json.dumps({'class': student_class, 'events': events}, ensure_ascii=False, separators=(',', ':')))
        lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Student Timetable//Class Calendar//EN',
                 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + escape_ics(name.strip()), 'X-WR-TIMEZONE:Asia/Kuala_Lumpur',
                 'BEGIN:VTIMEZONE', 'TZID:Asia/Kuala_Lumpur', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
                 'TZOFFSETFROM:+0800', 'TZOFFSETTO:+0800', 'TZNAME:MYT', 'END:STANDARD', 'END:VTIMEZONE']
        for event in events:
            description = 'Reconstructed timetable. Confirm changes with your lecturer.'
            for label, field in [('Class', name.strip()), ('Lecturer', event['lecturer']), ('Notes', event['note']),
                                 ('Calendar exception', event['exception'])]:
                if field:
                    description += f'\n{label}: {field}'
            if event['overlap']:
                description += '\nOverlapping class entry: check with lecturer.'
            date = event['date'].replace('-', '')
            lines += ['BEGIN:VEVENT', 'UID:' + event['id'] + '@student-timetable.local', 'DTSTAMP:20261012T000000Z',
                      'DTSTART;TZID=Asia/Kuala_Lumpur:' + date + 'T' + event['start'].replace(':', '') + '00',
                      'DTEND;TZID=Asia/Kuala_Lumpur:' + date + 'T' + event['end'].replace(':', '') + '00',
                      'SUMMARY:' + escape_ics(name.strip() + ' - ' + event['subject']),
                      'LOCATION:' + escape_ics(event['room']), 'DESCRIPTION:' + escape_ics(description),
                      'STATUS:TENTATIVE', 'END:VEVENT']
        lines += ['END:VCALENDAR']
        (calendar_folder / f'{identifier}.ics').write_bytes(('\r\n'.join(part for line in lines for part in fold_ics(line)) + '\r\n').encode('utf-8'))
    assert not grouped, f'Unmapped class names: {list(grouped)}'
    assert count == sum(bool(row['class']) for row in rows) == 23193
    exceptions = [{'date': item['start_date'], 'name': item['label'].strip() or 'Calendar exception'} for item in recovered['calendar_exceptions']]
    manifest = {'title': 'GMI Student Timetable', 'timezone': 'Asia/Kuala_Lumpur',
                'sourceRevision': '9 October 2026', 'planningStart': '2026-01-01', 'planningEnd': '2027-01-31',
                'reconstructed': True, 'classes': classes, 'exceptions': exceptions}
    (data_folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    print(f'Prepared {len(classes)} classes, {count} student events and {len(classes)} class-only calendars.')


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root.parent / 'dav-recovery')
    parser.add_argument('--public', type=Path, default=root / 'public')
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.public)
