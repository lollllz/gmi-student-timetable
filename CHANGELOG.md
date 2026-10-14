# Changelog

## 14 October 2026 - Accessibility, lecturer timetables and DAV editing

Implemented and deployed in commit `d8c7cba3754140384368b714fd8108e6d18fc9d3`.

### Accessibility

- Added saved preferences for larger text, high contrast, reduced motion and an agenda default.
- Improved keyboard focus, mobile day selection focus retention, form labels and lesson accessible names.
- Replaced whole-timetable live announcements with concise status updates.
- Improved contrast for muted text, empty states, links and active mobile day labels.
- Added forced-colour support and fixed date-label overlap on narrow phones.

### Lecturer timetables

- Added a By lecturer picker with name search.
- Combined entries across classes and resource activities, with class/activity labels on lesson cards and calendar descriptions.
- Added lecturer-specific calendar downloads and provided-source lecturer/week links.
- Generated and checked 246 lecturer/resource datasets covering 26,443 dated entries. These are source labels and entries, not verified counts of individual people or users.

### Local DAV editing and export

- Retained the opened source buffer locally and added full-file DAV download.
- Added recurring lesson note edits and weekday/start-period changes for unlinked lesson blocks.
- Preserved unknown source bytes; edits patch decoded placement bytes and the tagged note string, then decode the result again.
- Kept coupled lesson placement changes blocked, required consecutive existing periods, and enforced the 255-character Windows-1252 note limit.
- Confirmed unchanged exports are byte-identical and reversing tested edits restores the original synthetic file byte-for-byte.
- Local edits do not update the public schedule and must be exported before refresh to retain them.

### Source verification

The attachment received on 14 October has the same SHA-256 as the existing timetable:

`0e65e7d9144b4054d9c41d31b4fb7ddb2dfeadd13b1b58eb593b9894a0496b25`

It passed source recovery validation. The website retains the original revision date because no newer timetable content was found.

### Validation

- Source recovery: complete 2,133,554-byte round-trip and 27,242 reconstructed calendar checks passed.
- Fifteen unit/reference tests passed with no skips, including all published student entries and lecturer datasets against browser decoding.
- Fourteen browser workflows passed locally, including automated axe checks on the selected planner/dialog states.
- Four enhancement/accessibility workflows passed against the deployed GitHub Pages site.
- GitHub Pages deployment succeeded: https://github.com/lollllz/gmi-student-timetable/actions/runs/38515955570

### Known limits

Native DaVinci acceptance and scheduling behavior of edited files remain unverified. DAV editing/export is experimental. Room, lecturer, subject, recurrence-mask, holiday, linked-group and lesson creation/deletion editing are unsupported. Calendar downloads remain tentative snapshots. Automated accessibility checks are not a full WCAG conformance claim or a replacement for assistive-technology testing.
