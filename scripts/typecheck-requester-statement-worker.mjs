// Source-authored CI composition. Not executed in this source packet.
// Generate real runtime types from the closed configuration, then check this
// Worker independently. No hand-authored Cloudflare ambient types or deploy.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const worker = resolve(root, "workers/requester-statement-archive");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
function run(args, cwd) {
  const result = spawnSync(pnpm, args, {
    cwd, stdio: "inherit", shell: false,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
run(["dlx", "wrangler@4.134.0", "types", "--include-env=false"], worker);
run(["exec", "tsc", "--noEmit", "-p", "workers/requester-statement-archive/tsconfig.json"], root);
