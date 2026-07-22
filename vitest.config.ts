import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Mirror the "@/*" -> "./*" path alias from tsconfig.json so lib modules
    // import the same way under test as they do in the app.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
