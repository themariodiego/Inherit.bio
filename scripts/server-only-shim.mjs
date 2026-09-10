/**
 * `server-only` is a Next.js marker package resolved by the bundler's
 * `react-server` condition, not by Node. `vitest.config.ts` already aliases it
 * to the same empty module Next uses so the unit suite can run server modules
 * directly; this is the equivalent for a plain `node --import tsx` script, so a
 * measurement harness can exercise the real server function rather than a copy
 * of it. It changes no behaviour: the marker has no runtime side effects.
 *
 * Usage: node --import ./scripts/server-only-shim.mjs --import tsx <script>
 */
import { registerHooks } from "node:module";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const empty = require.resolve("next/dist/compiled/server-only/empty.js");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: `file://${empty}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
