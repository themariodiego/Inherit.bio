/**
 * Copies `docs/export-member-plan.json` into the generated block of
 * `supabase/tests/export_member_plan.sql`, where pgTAP checks it against the
 * real catalog. The test runner cannot read a repository file, so the plan
 * travels inside the test; `src/lib/export/member-plan.test.ts` fails when
 * the two copies differ.
 *
 *   pnpm exec tsx scripts/export-member-plan.ts
 *
 * Run it after adding a table to the plan. It changes nothing else.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLAN_JSON = "docs/export-member-plan.json";
export const PLAN_TEST = "supabase/tests/export_member_plan.sql";
export const BEGIN = "-- BEGIN GENERATED from docs/export-member-plan.json by scripts/export-member-plan.ts; do not edit by hand.";
export const END = "-- END GENERATED";
const QUOTE = "$plan$";

/** The generated block: the plan, verbatim, as a temporary table. */
export function planBlock(json: string): string {
  if (json.includes(QUOTE)) throw new Error(`${PLAN_JSON} must not contain ${QUOTE}`);
  JSON.parse(json);
  return `${BEGIN}\ncreate temporary table export_member_plan as select ${QUOTE}\n${json.trimEnd()}\n${QUOTE}::jsonb as plan;\n${END}`;
}

/** The test file with its generated block replaced by the current plan. */
export function withPlanBlock(sql: string, json: string): string {
  const start = sql.indexOf(BEGIN);
  const end = sql.indexOf(END, start);
  if (start < 0 || end < 0 || sql.indexOf(BEGIN, start + 1) >= 0) {
    throw new Error(`${PLAN_TEST} must hold exactly one generated block`);
  }
  return sql.slice(0, start) + planBlock(json) + sql.slice(end + END.length);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const testPath = path.join(root, PLAN_TEST);
  const before = readFileSync(testPath, "utf8");
  const after = withPlanBlock(before, readFileSync(path.join(root, PLAN_JSON), "utf8"));
  if (after !== before) writeFileSync(testPath, after);
  console.log(after === before ? `${PLAN_TEST} already carries the plan` : `${PLAN_TEST} updated`);
}
