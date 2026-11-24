import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:8090',
    // page.route cannot see requests once a service worker controls the page,
    // so tests that mock GitHub block it; share tests opt back in.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'py -m http.server 8090 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8090/index.html',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
