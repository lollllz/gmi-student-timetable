# Short address: direct Rust assets

Public address: https://gmi-schedule.netlify.app/
Project ID: `65e0cdaa-609f-47f5-8006-00f966d7e58e`, Primary account, john team.

Run `npm run build`, then `node scripts/stage-short-site.mjs`. Deploy this directory with its `public/` assets to the existing short-address project. It serves the Rust viewer, lazy DAV worker, CSS and timetable files directly from Netlify's CDN. The only proxy rule is the hourly `data/air-quality.json` snapshot from Pages. Hashed WASM/module assets are browser-cached immutably; the HTML and worker entry revalidate.

The alternative Pages address remains https://lollllz.github.io/gmi-timetable/. Code updates require explicit Netlify staging/deployment alongside the Pages workflow; they are no longer automatically proxied. Air readings continue following hourly Pages snapshots. The backend URL and storage are unchanged. Browser preferences remain origin-specific.

The website stylesheet hides the injected `nl-badge-frame` promotion. This is an application display rule; it does not change the Netlify dashboard badge toggle. If dashboard access is available, the provider setting is under Project configuration → General → Powered by Netlify badge.
