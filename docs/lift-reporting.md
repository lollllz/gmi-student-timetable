# Anonymous campus lift reporting

The Rust/WASM timetable is delivered as static assets from Netlify and GitHub Pages. Optional shared source checks, publishing and lift reports call the separate Netlify service. Students need no login, account, GitHub identity, email or student ID. Local DAV imports remain on the device; only an explicit shared publication uploads a file.

## Reporting behavior

- Each report is an observation made now: building label, lift identifier/location, condition, server timestamp and generated report ID. No photos, comments or contact details are accepted or stored.
- The public feed returns at most 100 observations from the last 24 hours. The website displays the latest observation per case-insensitive building/lift label; spelling variations can still describe the same lift separately. No official campus inventory was supplied.
- Reports older than two hours are flagged as older observations. A working report is not a maintenance certification. Unknown, empty and unavailable states never imply that a lift is working.
- Building and lift text is public; the form asks students not to include personal information. All displayed text is HTML-escaped. Moderation/deletion is available to the site owner through Netlify's Blobs dashboard; students cannot edit or delete others' reports.
- Stored reports are removed by a daily scheduled function after 7–8 days. Only the last 24 hours are publicly returned. Hosting-provider connection/security logs have their own retention policies.

## Deployment

1. Create a dedicated Netlify project in the chosen connected account. Do not reuse an unrelated application's storage.
2. Build and test the Rust runtime, then stage a portable backend with `node scripts/stage-backend.mjs /absolute/path/rust-api-release`. Generate its dependency lockfile and deploy that directory to the existing backend project. The artifact contains five thin Functions, the SDK adapter and verified Rust WASM; hosted compilation is unnecessary.
3. The `lifts` Function serves `/api/lifts`; production uses the site-wide `lift-reports` Blobs store. Preview requests use a separate store. The scheduled cleanup runs only in production.
4. Set `public/data/lift-service.json` to `{"endpoint":"https://ACTUAL-PROJECT.netlify.app/api/lifts"}` and publish the timetable through its existing Pages workflow. The browser only accepts an HTTPS Netlify project endpoint.
5. Confirm anonymous cross-origin GET/OPTIONS and validation failures on the deployed service. Test real save/read in an isolated preview store, never seed a false production observation. Verify Netlify's generated rate-limit configuration and provider logs.

The reporting service is deployed at https://gmi-campus-reports.netlify.app in the selected Primary account (john team). Its existing production stores are retained across the rewrite. Immutable deployment permalinks use a separate store per deployment, so live storage tests do not create false production observations. Native rate-limit metadata was confirmed in the deployed configuration.

## Abuse controls and limits

The Function validates the actual streamed request body (1 KiB maximum), rejects invalid conditions/labels and honeypot submissions, allowlists the owned GitHub Pages and short-site origins for browser writes, returns only allowed fields, and has a native Netlify limit of 15 requests per minute per IP/domain. Shared-campus connections may reach this limit; the UI asks students to wait and retry. CORS is a browser boundary, not authentication: a determined non-browser client can forge Origin. Login-free reporting cannot establish identity or guarantee truth. A human verification challenge or moderation queue may be needed if abuse develops.

No private key is shipped in the website. Blobs credentials are injected into the Function by Netlify. Anonymous visitors have no direct storage read/write/delete access. The service returns generic operational errors and records no custom IP logs. Normal hosting usage and billing limits still apply.


## Shared timetable publishing

Anyone can submit a DAV through **Update shared timetable**, without signing in. The owner explicitly selected automatic publishing after validation. A valid submission becomes the shared default; this is not an approval or authentication of the issuer.

- The binary publishing endpoint is `/api/publish-timetable`, separate from read-only `/api/timetable`. It is limited to three requests per five minutes per IP/domain; preflights may also count. No browser credentials are sent. Cross-origin browser writes are restricted to the project's GitHub Pages and short-site origins.
- Shared uploads are capped at 4 MiB (within Netlify's synchronous binary request limit); local DAV import still supports 20 MiB. Filenames must contain a revision and DDMMYYYY date. Dates must be valid, no earlier than the bundled 15 Oct 2026 baseline or the current community revision, and no later than today in Malaysia. Equal-date revisions can replace one another; filename dates are claims, not proof of authenticity.
- The supported V30 decoder must parse through EOF. Empty schedules and excessively large record sets are rejected. Unscheduled/flagged slots are omitted consistently with the existing decoder and counted in metadata; native DaVinci holiday/override semantics remain unverified.
- Class datasets, stable lecturer datasets, original DAV and a release manifest are stored under the SHA-256 hash. The current pointer changes only after all writes succeed. A conditional ETag write rejects conflicting concurrent publications. A failed or timed-out upload should be checked by refreshing before retrying.
- The calendar renders the bundled timetable first, then checks the shared manifest. A different community source loads per-class data on demand and is explicitly labelled **not verified by GMI**. Calendar exports use the loaded community events. If the service is unavailable, the bundled revision remains explicitly labelled.
- Superseded completed releases are retained for seven days, then removed by the daily cleanup; the current release is kept. Incomplete orphaned uploads are not automatically pruned and can be inspected/deleted by the owner through Blobs. This prototype has no public moderation, issuer verification or anonymous identity guarantees.
- Owner recovery: update the `current` object in the `community-timetables` Blobs store to a retained release manifest, or empty the endpoint in `public/data/lift-service.json` and redeploy Pages to return to the bundled source. Do not expose a Netlify token in the website. Normal hosting quotas apply; anonymous publishing can be abused despite rate limiting.

The service was deployed manually using the authenticated deployment tool. Future Function changes require a separate Netlify deployment; the existing GitHub Actions workflow publishes the timetable frontend to Pages. A full R04D DAV was published to an isolated deployment store in about 10.4 seconds, then class 99178435 was read back with 139 entries. Production remained empty during these tests. Scheduled cleanup has been deployed but its later scheduled execution has not yet been observed.

## Rust runtime and caching (22 October 2026)

Browser behavior, DAV processing and HTTP business rules now run in Rust/WASM. Generated browser bindings and the Netlify SDK adapter remain JavaScript. Public manifest reads use a 120-second durable CDN cache; lift reads use 60 seconds; immutable release datasets use long-lived caches. Origin/query variation preserves CORS and explicit refresh behavior. Writes and errors are not cached. The browser also reuses a shared-source check for five minutes; About → Check for timetable updates forces a check. Existing source data was preserved during deployment. The earlier empty-feed test statements above describe the original deployment, not the current feed.
