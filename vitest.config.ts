import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    // No network in unit tests (docs/RULES.md). A test that hangs on a socket
    // should fail fast and loudly rather than stall CI.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.d.ts"],
    },
  },
});
