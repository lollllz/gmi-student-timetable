# Rust timetable runtime

The browser application and server application logic are implemented in Rust. The browser runs `timetable-web` as WebAssembly; `timetable-engine` supplies the same validated DAV reader/editor to a lazy browser worker and server Functions. Static HTML/CSS remain presentation assets. Generated wasm-bindgen JavaScript and small platform I/O adapters are necessary to connect browser APIs and Netlify's JavaScript-only Blobs SDK; they do not contain timetable, reporting or publishing business rules.

## Containers and interfaces

- `rust/core`: dates, forgiving class search, calendar generation, overlap sweep, DOE normalization and validated V30 decode/edit. No network or hosting dependencies.
- `rust/web`: browser state, rendering, forms, accessibility/theme preferences, class/lecturer switching, local-file worker coordination, campus updates, reporting and publishing UI.
- `rust/engine`: WASM exports and Rust HTTP request handling, origin checks, streamed-body size policy, report validation/freshness, public caching policy, revision checks, immutable release staging, conditional publication and retention cleanup.
- `netlify/lib/rust-adapter.mjs`: bounded HTTP byte reads, platform metadata and generic Blobs SDK operations. The five Functions are thin routes into the Rust handler. Existing production store names and the backend hostname are unchanged; deploy permalinks use isolated test stores.
- The short site serves compiled assets directly from Netlify. Only the hourly air snapshot is proxied from Pages. GitHub Pages serves the same Rust build as an alternative address. Frontend changes require a separate staged Netlify deployment as well as the existing Pages workflow.

The original JavaScript helpers/handlers in `tests/reference/` are regression oracles, not application runtime code. They establish source-field and file-format parity; retaining them does not cause them to be shipped to browsers or invoked by production Functions.

## Server work and caching

The previous short address proxied every asset to Pages. Every visit also called the uncached timetable Function. The inspected one-hour sample had 47 short-site edge requests and eight timetable Function invocations. That sample did not establish an overload or a monthly cost forecast.

The Rust viewer uses direct static CDN assets, content-fingerprinted WASM/modules, immutable browser caching for those assets, a five-minute per-device shared-manifest cache, and durable CDN caching of public server reads. Public metadata uses a 120-second shared TTL with background revalidation; lift lists use 60 seconds; release datasets use immutable caching. Origin and query are cache-key inputs. Writes/errors are not cached. Successful publishers and explicit refresh controls bypass read caches with a fresh query; other viewers can briefly retain an older source. About → Check for timetable updates explicitly bypasses the per-device source cache.

DAV code is not downloaded during normal calendar startup. All local decoding/editing remains on the device in a terminable worker. Server publishing avoids constructing unused per-event editor metadata. Interval overlaps use a sorted sweep, reducing the old per-day quadratic scan to O(n log n).

The hourly Pages job reuses the compiled app keyed by commit SHA, refreshes the air snapshot and republishes it. It does not reinstall the Rust compiler or recompile the same source each hour.

## Limits and risks

This is Rust/WASM, not a native Rust daemon: Netlify still hosts thin JavaScript platform adapters. A language rewrite cannot remove traffic or guarantee a lower bill. Cold WASM transfer/initialization is a tradeoff and is measured separately from cached visits and server invocations.

Supported file formats, 20 MiB local import, 4 MiB shared upload, public/anonymous reporting, existing source-date validation, unverified native holiday/override semantics and owner recovery rules remain as documented in `docs/lift-reporting.md`. Anonymous uploads cannot authenticate their issuer. Public source caches intentionally trade immediate propagation for fewer requests. The short site needs explicit redeployment for future code releases; its hourly air snapshot continues updating independently.

## Deployment verification, 22 October 2026

The Rust backend and direct short-site artifacts were published. The production community source hash remained `9ebe338b1e98fe7b5618bc96537e98c9852fe326e23c3a278ba5219501625457`; repeated reads returned `Netlify Edge; hit`. Full R04D publishing was confirmed idempotent in an isolated deployment store. The portable backend artifact avoids requiring a Rust compiler in the hosted builder; the initial source-build attempt failed before publication.

Cold-load comparison (three fresh Chrome contexts, cache disabled, 150 ms network latency, 200 KiB/s download, 4× CPU throttle): previous JavaScript lesson readiness 3120/1132/1116 ms, initial Rust deployment 2683/2790/1884 ms. These small synthetic samples show a cold-load regression, not a speed improvement. WASM is a larger initial payload; CDN read caching and five-minute source-check reuse address repeated backend work independently. Subsequent fixes eliminate a duplicate manifest fetch; the final serial sample was 1977/1980/1980 ms (median 1.98 seconds), still slower than the JavaScript baseline. Ten deployed browser workflows passed together; cancellation passed separately after correcting worker interception to use browser-context routing. No monthly billing reduction is claimed.
