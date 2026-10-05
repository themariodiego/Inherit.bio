/** Manual offline refresh; no network, credentials or GitHub-only discovery. */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeOfflineHistory } from "./ci-browser-duration-history-io";

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const args = process.argv.slice(2);
  assert(args.length === 3 || args.length === 4, "Usage: saved-capture1 saved-capture2 [saved-capture3] fresh-output-directory");
  assert(args.every(value => value.length > 0 && !value.startsWith("--")), "Only explicit offline paths accepted");
  writeOfflineHistory(args.slice(0, -1), args.at(-1)!, sourceDirectory);
  console.log("Offline history proposal saved. Source review and complete hosted qualification remain required.");
}
