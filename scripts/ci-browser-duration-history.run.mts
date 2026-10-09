/** Manual offline refresh; no network, credentials or GitHub-only discovery. */
import assert from "node:assert/strict";
import path from "node:path";
import { lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeOfflineHistory } from "./ci-browser-duration-history-io";
import { writeRawHistoryAppend } from "./ci-browser-duration-history-raw";

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
/** Legacy paths retain their original behavior. Raw format is opt-in and cannot
 * be selected by parse failure or an inferred capture filename. */
export function historicalDurationMain(args: string[], root = sourceDirectory): void {
  if (args[0] === "--raw-append") {
    assert(args.length === 4 && path.isAbsolute(args[1]) && path.resolve(args[1]) === args[1]
      && /^[0-9a-f]{64}$/.test(args[2]) && path.isAbsolute(args[3]),
    "Usage: --raw-append absolute-plan.json exact-plan-sha256 fresh-absolute-output");
    const stat = lstatSync(args[1]);
    writeRawHistoryAppend({ path: args[1], bytes: stat.size, sha256: args[2] }, args[3], root);
    return;
  }
  assert(args.length === 3 || args.length === 4, "Usage: saved-capture1 saved-capture2 [saved-capture3] fresh-output-directory");
  assert(args.every(value => value.length > 0 && !value.startsWith("--")), "Only explicit offline paths accepted");
  writeOfflineHistory(args.slice(0, -1), args.at(-1)!, root);
}
if (invoked) {
  historicalDurationMain(process.argv.slice(2));
  console.log("Offline history proposal saved. Source review and complete hosted qualification remain required.");
}
