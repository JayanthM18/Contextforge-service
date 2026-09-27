import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests import workspace packages from source. Resolving them through
    // package.json would load the compiled dist/, which is stale until the
    // next build, and tests would silently run against old code.
    alias: {
      "@contextforge/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
      "@contextforge/cli": fileURLToPath(new URL("./packages/cli/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "examples/*/test/**/*.test.ts"],
    environment: "node",
    // No network in unit tests (docs/RULES.md). A test that hangs on a socket
    // should fail fast and loudly rather than stall CI.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts", "examples/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.d.ts"],
    },
  },
});
