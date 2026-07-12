const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4190",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npx http-server ./dist -p 4190 -c-1",
    url: "http://127.0.0.1:4190",
    reuseExistingServer: true,
    timeout: 30000
  }
});
