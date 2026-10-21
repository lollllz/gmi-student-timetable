# Loading improvements, 21 October 2026

The existing static JavaScript app was measured before choosing a rewrite. Initial loading included separate core, calendar, class-search, air-quality, DAV writer and DAV decoder modules. Optional editor code downloaded even for students only viewing a provided calendar.

The new esbuild pipeline minifies and bundles startup modules, splits optional features into on-demand chunks, preserves the separate DAV worker, and minifies CSS. Calendar export generation, class search, DAV writing and lift reporting load when requested. Air-quality initialization starts after initial timetable initialization. The manifest is preloaded from the document head to overlap its network request with startup code.

A full Rust/Wasm rewrite was deferred: it would not remove the measured module/data request waterfall by itself. Rust remains an option for a measured CPU-bound decoder bottleneck. No Rust code or native decoder equivalence is claimed.

## Local lab evidence

Three fresh Chrome contexts per version; cache disabled, 150 ms network latency, 200 KB/s download, 100 KB/s upload, 4x CPU slowdown. Same local static server, class `99178435`, week `2026-10-19`; ready means the first lesson becomes visible. This is a small synthetic sample, not production real-user monitoring.

Before bundling, lesson-ready times were 3679, 2311 and 2111 ms (median 2311 ms). After the initial optimization and dark theme, times were 1828, 1849 and 1826 ms (median 1828 ms): about 21% lower median. Decoded resource bytes observed around lesson readiness fell from about 195 KB to 160 KB. Optional air-quality requests may finish on either side of that measurement. The first before sample was substantially slower than the others; no significance claim is made.

All 22 reference-enabled unit tests and 22 browser workflows passed, including on-device DAV import/edit/export and automated dark-mode contrast checks. The reporting-service deployment and real shared storage must be verified separately.
