# Changelog

## 22 October 2026 - Timetable read reliability and badge removal

- Scope Blobs clients to each Function request instead of retaining clients and their captured credentials across warm invocations. This addresses uncached timetable reads failing while previously cached classes still loaded. Production source data is retained.
- Hide the injected Netlify promotion frame in the website stylesheet and remove the mobile spacing workaround. The dashboard badge setting remains unchanged; the overlay is hidden for website visitors.
- Added request-credential lifetime and mobile badge/export regression coverage.

## 22 October 2026 - Rust runtime and lower repeated server work

- Replaced browser and server application logic with Rust compiled to WebAssembly, retaining static HTML/CSS and thin platform adapters. Class/lecturer search, exports, local DAV editing, accessibility, themes, air updates and anonymous campus features remain available.
- Serve the short site directly from the CDN, fingerprint compiled assets, defer the DAV engine until needed and reuse shared-source checks for five minutes. Added an explicit timetable refresh.
- Cache public backend reads at the CDN, preserve existing storage and conditional publication, and replace quadratic overlap scans with a sorted sweep. Reuse compiled Pages artifacts on hourly air refreshes.
- Validation: 31 reference-enabled Node checks, two native Rust tests and 24 browser workflows passed. Rust decoding matches all 23,203 R04D student events against the independent decoder. Live repeated manifest reads returned a CDN cache hit while preserving the existing source hash. These checks establish behavior and reduced repeated work, not a measured billing reduction.

## 21 October 2026 - Free short address

- Added https://gmi-schedule.netlify.app/ as a short public address that serves the existing Pages site through a Netlify rewrite, preserving class/week query links and future Pages updates. The GitHub Pages address continues to work.
- Allowed only the two owned public origins on the existing shared reporting/publishing backend, with regression coverage for accepted and rejected origins. Shared storage and the backend hostname are unchanged.
- Updated the primary README link and documented separate hosting configuration and origin-specific browser preferences.


## 21 October 2026 - Shorter website address

- Renamed the repository to `gmi-timetable` and updated the website address to https://lollllz.github.io/gmi-timetable/.
- Updated project links, the air-quality snapshot fallback, reporting-service information page and local development/test paths. The reporting service and stored observations/timetables keep their existing address and storage.
- Previously shared GitHub Pages links need the new address; repository links redirect through GitHub.


## 21 October 2026 - Faster startup, dark mode and anonymous lift reporting

- Bundled and minified startup code and deferred optional search, calendar/DAV editing and campus-report modules. Preloaded the manifest and moved air-quality initialization after the initial timetable. Local throttled median lesson readiness improved from 2.31 s to 1.83 s in a three-run comparison; this is a lab result.
- Added device-aware light/dark themes, a quick theme button and a saved appearance setting in Accessibility. Updated lesson colors, native controls, high contrast and printing.
- Added a compact campus-lift entry and an anonymous reporting dialog, with public observation times, explicit unknown/error states and older-report labels. No student login or personal details are required.
- Added automatic community DAV publishing with server decoding, bounded uploads, revision-date checks, complete dataset staging, conditional pointer publication, community labels and class/lecturer calendar export.
- Prepared a separate Netlify reporting service with private Blobs storage, validated bounded submissions, rate limiting, isolated preview storage and scheduled retention cleanup. Connected the dedicated Primary-account reporting service.
- Validation: 24 reference-enabled unit tests and 23 browser workflows, including dark-mode accessibility and anonymous report/publishing workflows. Anonymous lift save/read and DAV publication/read were verified against isolated deployed storage; the production feed was confirmed empty.


## 18 October 2026 - Compact campus updates

- Replaced the initially expanded haze and air-quality panels with one collapsed Air & campus updates strip, giving the timetable substantially more space.
- Kept the reference station, API/category, observation time and stale/unavailable status visible in the compact summary, with a short active haze reminder.
- Moved guidance, source links, station selection and refresh controls into the expandable content. It starts collapsed on each page load and supports native keyboard activation.
- Validation: all 20 browser workflows passed, including compact height at 320px, keyboard expansion, accessibility and existing timetable/export flows.


## 18 October 2026 - Latest official station air-quality readings

- Added a regional reference card with Putrajaya/Cheras station selection, Malaysian API/IPU value and category, observation time in MYT and DOE/APIMS attribution.
- Added hourly server-side snapshots via the existing Pages workflow, with no exposed keys or per-user requests to DOE. Snapshot refresh is independent of timetable loading and class delivery decisions.
- Added loading, refresh-failure, outdated (>3 hours) and unavailable (>24 hours) states. Last-known observation timestamps are preserved on upstream failure. Future/null/inconsistent data is rejected.
- Normalised the official feed's offset-free Malaysian timestamps explicitly to UTC+8 and published only an allowlist of station fields.
- Added unit and browser coverage for timestamp conversion, invalid data, freshness, station selection, failed refresh, phone layout and accessibility. No timetable data or calendar/DAV exports changed.


## 18 October 2026 - Haze precautions and class delivery reminders

- Added a collapsible Kajang haze precaution with a mask/respirator reminder, official MOH guidance and an APIMS link. It does not display an unverified air-quality reading or claim institutional approval.
- Prompted users to check lecturer messages or GMI announcements because classes may change delivery mode. Upcoming lessons in the active window show “Confirm class delivery”; only explicit source notes produce an “Online · source note” label.
- Added explanatory lesson details, accessible toggle state and saved collapse preferences. The initial reminder expires after 25 October 2026 to avoid a stale indefinite notice.
- Left timetable data, DAV files and calendar exports unchanged.
- Validation: 17 reference-enabled unit tests and 17 browser workflows passed, including haze expiry, ambiguous/negated online wording, collapse persistence, narrow-phone layout and automated accessibility checks.


## 15 October 2026 - R04D timetable and revision notification

- Replaced the provided schedule with `TT JULYSEPT 2026_R04D_15102026.dav`, revision R04D dated 15 October 2026 (2,264,770 bytes).
- Source SHA-256: `c03eccde201485bf286172202bfc96ab16210d4730e7a2daaf5ee9aa072c8174`.
- Regenerated 178 class datasets/calendars: 23,203 student entries, a net increase of ten. The full reconstruction contains 27,252 dated blocks; lecturer/resource datasets contain 26,453 entries across 246 display labels.
- Compared schedules excluding source-specific event IDs and derived overlap flags: 144 class schedules differ, with 564 added/changed and 554 removed/changed student blocks. These are block comparisons, not counts of individual administrative edits.
- Added a small `R04D · 15 Oct 2026` indicator. Its New dot clears when source details are opened, remains acknowledged after refresh, and returns for a different source hash. Local file imports are labelled separately.
- Added a current-revision DAV data generator with explicit filename/hash/revision/date/count metadata, regenerated calendar snapshots, and removal of obsolete generated datasets.
- Updated revision information and browser tests so calendar checks follow the loaded dataset rather than a previous fixed event count.
- Validation: complete structural decoding through EOF, class/lecturer parity with the supplied DAV, dataset/calendar checks and browser/accessibility workflows. Native DaVinci holiday/override semantics remain unverified; no new byte-round-trip or native application verification is claimed for R04D.


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
