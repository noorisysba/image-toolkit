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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.TEST_URL
    ? undefined
    : {
        command:
          "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort",
        url: "http://127.0.0.1:4173/image-toolkit/",
        reuseExistingServer: !process.env.CI,
      },
});
