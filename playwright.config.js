import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4173/gmi-student-timetable/', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, viewport: { width: 1440, height: 1000 } },
  reporter: 'list',
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4173/gmi-student-timetable/', reuseExistingServer: true },
});
