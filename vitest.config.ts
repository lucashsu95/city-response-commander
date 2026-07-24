import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/test/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "eslint-local-rules/test/**/*.test.ts",
    ],
  },
});
