# Short website address

Public address: https://gmi-schedule.netlify.app/
Netlify project: `gmi-schedule` (`65e0cdaa-609f-47f5-8006-00f966d7e58e`), Primary account, john team.

Deploy this directory as its own Netlify project. `netlify.toml` publishes `public/`; the forced 200 rewrite serves the existing GitHub Pages assets while retaining the short address in the browser. Query parameters are preserved, including class, lecturer and week links. There is no duplicate timetable build or copy of shared storage. Normal upstream/CDN cache delays may apply after Pages deployments.

The GitHub Pages address remains https://lollllz.github.io/gmi-timetable/. Future Pages updates are served through this proxy. Changes to the proxy configuration require a separate Netlify deployment. The `gmi-campus-reports` backend remains separate and explicitly allows browser requests from both public origins. Do not add arbitrary origins to that allowlist or rename the backend project; its production hostname selects existing storage.

Local storage is origin-specific: students opening the short address may need to select their class/theme again. Existing GitHub Pages links and preferences continue to work at that address.
