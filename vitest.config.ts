import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Standalone test config — separate from Next's build (next.config.ts is
// untouched). Mirrors the tsconfig `@/*` -> repo-root path alias.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Unit/component tests only; Playwright owns e2e/.
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
