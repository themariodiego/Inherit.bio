/** Inside-only aggregate reader. Never accepts a path or exposes writer identity. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readPreparedArtifactProof } from "./prepared-artifact-proof";

try {
  assert(process.argv.length === 2 && process.platform === "linux" && process.getuid!() > 0);
  assert.match(readFileSync("/proc/self/status", "utf8"), /^CapEff:\s+0+$/m);
  process.stdout.write(`${JSON.stringify(readPreparedArtifactProof())}\n`);
} catch {
  process.stderr.write("prepared_artifact_proof_unavailable\n");
  process.exitCode = 1;
}
