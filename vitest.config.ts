import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` is a Next.js marker package resolved by the bundler's
      // `react-server` condition, not by Node. The unit suite runs server
      // modules (src/lib/family/*, src/lib/subjects.ts) directly, so it
      // resolves the marker to the same empty module Next uses.
      "server-only": path.resolve(
        __dirname,
        "node_modules/next/dist/compiled/server-only/empty.js",
      ),
    },
  },
});
