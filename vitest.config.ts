import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20000, // MCP integration spawns a child process
  },
});
