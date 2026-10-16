/** Explicit public-only owner operation. No credential/configuration file,
 * inference adapter, spending reservation or automatic recovery is opened. */
import assert from "node:assert/strict";
import { establishOwnedLinuxRuntime, readPrivateOperatorPipe, releaseOwnedLinuxRuntime } from "../owned-linux-runtime";
import { reconcileKeyFreeDryJournal } from "./manual-reconciliation";

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === "--owner", "Exact public owner request required");
  const owner = establishOwnedLinuxRuntime(JSON.parse(Buffer.from(args[1], "base64url").toString("utf8")));
  process.stderr.write(`OWNED_LINUX_RECONCILIATION_READY:${owner.proof.nonce}\n`);
  try {
    const result = await reconcileKeyFreeDryJournal(owner, await readPrivateOperatorPipe());
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    // Release only the new owner lease on actual empty-daemon proof. Both old
    // and new one-use challenge markers, scratch and run records survive.
    releaseOwnedLinuxRuntime(owner);
  }
}
if (process.argv[1]?.endsWith("/run-manual-dry-reconciliation.mts")) {
  main().catch(() => { console.error("Manual dry reconciliation refused; no journal or private values printed"); process.exitCode = 1; });
}
