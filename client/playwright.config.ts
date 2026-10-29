import { defineConfig } from "@playwright/test";

// E2E runs against the mock dataset (NEXT_PUBLIC_USE_MOCKS=1) so the journey
// works without the full docker stack; a live-stack suite can reuse the same
// spec against real endpoints later.

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3124",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "NEXT_PUBLIC_USE_MOCKS=1 NEXT_PUBLIC_FEATURE_V2_AI_USAGE_METER=1 npx next dev -p 3124",
    url: "http://localhost:3124/app",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
