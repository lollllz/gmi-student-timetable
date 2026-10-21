# Anonymous campus lift reporting

The timetable remains a static GitHub Pages site. Only the optional lift dialog calls the separate Netlify service. Students need no login, account, GitHub identity, email or student ID. Local DAV files remain on the device and never go to this service.

## Reporting behavior

- Each report is an observation made now: building label, lift identifier/location, condition, server timestamp and generated report ID. No photos, comments or contact details are accepted or stored.
- The public feed returns at most 100 observations from the last 24 hours. The website displays the latest observation per case-insensitive building/lift label; spelling variations can still describe the same lift separately. No official campus inventory was supplied.
- Reports older than two hours are flagged as older observations. A working report is not a maintenance certification. Unknown, empty and unavailable states never imply that a lift is working.
- Building and lift text is public; the form asks students not to include personal information. All displayed text is HTML-escaped. Moderation/deletion is available to the site owner through Netlify's Blobs dashboard; students cannot edit or delete others' reports.
- Stored reports are removed by a daily scheduled function after 7–8 days. Only the last 24 hours are publicly returned. Hosting-provider connection/security logs have their own retention policies.

## Deployment

1. Create a dedicated Netlify project in the chosen connected account. Do not reuse an unrelated application's storage.
2. Deploy this repository with the root `netlify.toml`. It builds only the reporting-service information page and the two Functions, not a second copy of the timetable.
3. The `lifts` Function serves `/api/lifts`; production uses the site-wide `lift-reports` Blobs store. Preview requests use a separate store. The scheduled cleanup runs only in production.
4. Set `public/data/lift-service.json` to `{"endpoint":"https://ACTUAL-PROJECT.netlify.app/api/lifts"}` and publish the timetable through its existing Pages workflow. The browser only accepts an HTTPS Netlify project endpoint.
5. Confirm anonymous cross-origin GET/OPTIONS and validation failures on the deployed service. Test real save/read in an isolated preview store, never seed a false production observation. Verify Netlify's generated rate-limit configuration and provider logs.

Until that endpoint is configured, the dialog explicitly says shared reporting is not connected and hides the submission form. Local tests use a mock service; these do not establish a live backend.

## Abuse controls and limits

The Function validates the actual streamed request body (1 KiB maximum), rejects invalid conditions/labels and honeypot submissions, allowlists the GitHub Pages origin for browser writes, returns only allowed fields, and has a native Netlify limit of 15 requests per minute per IP/domain. Shared-campus connections may reach this limit; the UI asks students to wait and retry. CORS is a browser boundary, not authentication: a determined non-browser client can forge Origin. Login-free reporting cannot establish identity or guarantee truth. A human verification challenge or moderation queue may be needed if abuse develops.

No private key is shipped in the website. Blobs credentials are injected into the Function by Netlify. Anonymous visitors have no direct storage read/write/delete access. The service returns generic operational errors and records no custom IP logs. Normal hosting usage and billing limits still apply.
