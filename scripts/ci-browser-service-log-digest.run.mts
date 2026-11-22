/** Write the digested auth-service and gateway logs of this job's own local
 * Supabase into test-results/service-logs/ for the failure-only evidence
 * upload (scripts/ci-browser-service-log-digest.ts says what is kept and why
 * nothing else can be). Runs `if: always()` in the workflow, because only an
 * artifact upload may be failure-only, and does nothing once the job has
 * succeeded. Never reads a container's environment and never prints a raw
 * line; an absent container is recorded and skipped, a grammar breach throws. */
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SERVICE_LOG_SOURCES, SERVICE_LOG_TAIL_LINES, digestServiceLog } from "./ci-browser-service-log-digest";

const status = process.env.INHERIT_JOB_STATUS;
if (status === "success") {
  console.log("Service log digest skipped: the job succeeded, so no failure evidence is uploaded.");
  process.exit(0);
}
const project = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(project, "The repository's local Supabase project id is required");
const directory = path.join("test-results", "service-logs");
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const source of SERVICE_LOG_SOURCES) {
  const container = `supabase_${source}_${project}`;
  let owned = false;
  try {
    // Identity and liveness only, never Config.Env: the CLI names its
    // containers after the project and labels them with it.
    owned = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "com.supabase.cli.project"}}', container],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim() === project;
  } catch { owned = false; }
  const target = path.join(directory, `${source}.txt`);
  if (!owned) {
    writeFileSync(target, `# digest ${source} unavailable: no ${container} container of this project\n`, { mode: 0o600, flag: "wx" });
    console.log(`Service log digest: ${container} unavailable.`);
    continue;
  }
  const logs = spawnSync("docker", ["logs", "--timestamps", "--tail", String(SERVICE_LOG_TAIL_LINES), container],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  if (logs.error || logs.status !== 0) {
    writeFileSync(target, `# digest ${source} unavailable: docker logs did not complete\n`, { mode: 0o600, flag: "wx" });
    console.log(`Service log digest: ${container} logs unavailable.`);
    continue;
  }
  const digest = digestServiceLog(source, `${logs.stdout}\n${logs.stderr}`);
  writeFileSync(target, digest, { mode: 0o600, flag: "wx" });
  console.log(`Service log digest: ${digest.split("\n", 1)[0]}`);
}
