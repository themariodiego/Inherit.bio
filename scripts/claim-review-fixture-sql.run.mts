/** Plan the browser's actual read proof against this job's migrated database.
 * EXPLAIN without ANALYZE reads no claim data and performs no fixture writes.
 * This catches schema mistakes before seeding, building or running browsers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { keylessEffectProofSql } from "../e2e/helpers/keyless-effect-proof-sql";

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === "--project"), "Unknown arguments");
const project = args[1] ?? readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(project && /^[A-Za-z0-9_-]+$/.test(project), "A local Supabase project ID is required");
const query = keylessEffectProofSql("00000000-0000-4000-8000-000000000001");
const result = spawnSync("docker", ["exec", "-i", `supabase_db_${project}`,
  "psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
  input: `begin; set local statement_timeout='8s'; set local lock_timeout='2s';\nEXPLAIN (FORMAT JSON, COSTS OFF) ${query};\nrollback;\n`,
  encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024,
});
if (result.error || result.status !== 0) {
  process.stderr.write(result.stderr || result.error?.message || "Claim review read-proof planning failed\n");
  process.exit(1);
}
const plan = JSON.parse(result.stdout);
assert(Array.isArray(plan) && plan.length === 1 && typeof plan[0].Plan?.["Node Type"] === "string",
  "The actual complete claim review SQL must produce one database plan");
console.log("Actual complete claim review read-proof SQL planned against the migrated local schema; no claim data executed");
