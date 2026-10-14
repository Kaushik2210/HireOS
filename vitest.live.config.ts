import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The live suite: real store classes against a real local Supabase stack.
// Not part of `npm test`; run it with `npm run test:live` after `npx supabase start`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One file at a time: the tests share one database and create their own accounts.
    fileParallelism: false,
  },
});
