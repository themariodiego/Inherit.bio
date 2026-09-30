import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The checkout root, found from the working directory.
 *
 * Every entry point starts at the root: the pnpm scripts, vitest and the
 * Playwright runner. Playwright loads a spec and everything it imports as
 * CommonJS, where `import.meta` is a syntax error, so no module the live
 * runner (`e2e/comprehension-run.spec.ts`) imports may use it.
 */
export function findRepositoryRoot(start = process.cwd()): string {
  for (let current = path.resolve(start); ; current = path.dirname(current)) {
    if (existsSync(path.join(current, "scripts/comprehension/bindings.json")) && existsSync(path.join(current, "package.json"))) return current;
    if (path.dirname(current) === current) throw new Error("Run from inside the repository checkout");
  }
}
