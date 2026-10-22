import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: process.env.TEST_URL ?? "http://127.0.0.1:4173/image-toolkit/",
    trace: "retain-on-failure",
  },
  projects: process.env.AUDIT_BROWSERS
    ? [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        {
          name: "chrome",
          use: { ...devices["Desktop Chrome"], channel: "chrome" },
        },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
        { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
      ]
    : [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.TEST_URL
    ? undefined
    : {
        command:
          "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort",
        url: "http://127.0.0.1:4173/image-toolkit/",
        reuseExistingServer: !process.env.CI,
      },
});
