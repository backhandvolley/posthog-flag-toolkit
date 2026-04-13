import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/posthog/types.ts", "src/registry/types.ts", "src/adapters/**"],
      thresholds: {
        lines: 50,
        branches: 75,
        functions: 65,
        statements: 50,
      },
    },
  },
});
