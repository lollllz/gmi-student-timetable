# GMI Student Timetable

A responsive student timetable with class selection and class-only calendar export. Students can use the weekly planner on desktop, the day agenda on mobile, or download their timetable into their own calendar app.

[Open the student app](https://lollllz.github.io/gmi-student-timetable/)

## Student features

- Search and choose a class; remember it on the current device.
- Browse a week, choose a date, and search subjects, rooms, lecturers or notes.
- Open lesson details and identify overlapping entries or calendar-exception dates.
- Share a URL containing the class and selected week.
- Download a class-only `.ics` file, with import guidance for Google Calendar, Apple Calendar and Outlook.
- Responsive layouts, keyboard-accessible dialogs and retry/empty/loading states.

No student login or backend is required. Data is loaded one class at a time. The deployment does not publish the original binary or forensic raw-field exports.

## Timetable status

The schedule was reconstructed from `TT JULYSEPT 2026_R03Y_09102026.dav`, revised 9 October 2026. There are 178 class records, 166 with dated entries, and 23,193 student entries. The source planning range is January 2026 through January 2027.

This is **not an official live timetable**. Some original rules remain unverified. Exception overlaps and simultaneous entries are retained and labelled. Students should confirm changes with their lecturer. Exports are tentative snapshots and do not automatically update. Resource activities without a class are excluded from student datasets. Classes without entries remain searchable but have no enabled export.

All event times use `Asia/Kuala_Lumpur` (UTC+8). Each calendar contains the full dated schedule of the selected class, rather than only the currently displayed week. Import into a separate calendar to make later replacement easier; repeated imports can create duplicates.

## Local development

Requires Node.js 22+ and Python 3 for data checks.

```sh
npm ci
npm run dev
```

Open the local URL printed by the server. All asset/data paths are relative, including when served under `/gmi-student-timetable/`.

```sh
npm test
npm run build
```

Browser checks:

```sh
npx playwright install chromium
npm run test:e2e
```

To use an already installed Chrome for browser checks:

```sh
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

## Updating recovered data

The app builds using the checked-in generated datasets. To regenerate them, supply the separate recovery output folder containing `recovered-data.json` and `reconstructed-occurrences.csv`:

```sh
python3 scripts/prepare_data.py --source /path/to/dav-recovery
npm test
npm run build
```

The data generator produces a JSON file and `.ics` calendar for each class. It verifies that every dated class label maps to a known class. Event UIDs remain stable for a given source, lesson, date and slot group.

## GitHub Pages

The `Publish student timetable` workflow checks the datasets and date/search logic, builds `dist/`, and deploys it to GitHub Pages on pushes to `main`. The repository’s Pages setting uses GitHub Actions.

## Verification

- Every class calendar is checked against its class JSON: counts, dates, start/end times, unique UIDs, timezone, tentative status, UTF-8 line folding and date bounds.
- Unit checks cover Malaysia’s date boundary, week navigation, search, shared links, safe calendar paths and HTML escaping.
- Browser checks cover class selection, calendar download content, lesson details, search, empty weeks, saved selections, request retry, desktop weekly columns and mobile widths down to 320px.

Calendar imports themselves have not been exercised in the user’s calendar account. Import instructions link to official vendor guides within the app.
