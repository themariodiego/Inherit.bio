import assert from "node:assert/strict";

/** Every standard project belongs here. Adding a project requires extending
 * this list with its config entry; discovery and coverage refuse silent drift. */
export const STANDARD_CI_BROWSER_PROJECTS = Object.freeze([
  "chromium", "jurisdiction-off", "copilot-local", "prepared-source", "embryo-ingest", "embryo-mixed-qc",
]);
export function assertStandardCiBrowserProjects(names: string[]) {
  assert.deepEqual([...names].sort(), [...STANDARD_CI_BROWSER_PROJECTS].sort(), "Standard browser projects differ");
}
