/** Real concurrent backends, local Docker only; no extension or privilege grants.
 * Proves lock participation before authority reads, not atomic provider delivery.
 * Every probe is cancelled inside an uncommitted transaction. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const project = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id = "([A-Za-z0-9_-]+)"$/m)?.[1];
assert(project, "A local Supabase project ID is required");
const probes = [
  "create_embryo_cohort_draft_v1(null,null,null,null,null,null,null,null,null,null,false)",
  "sign_embryo_artifact_v1(null,null,null,null,null,null,null,null,null,null)",
  "create_embryo_draft_invitation_v1(null,null,null,null,null,null,false)",
  "finalize_embryo_cohort_v1(null,null,null,null,null,null)",
  "activate_rights_session_v1(null,null,null)",
  "accept_embryo_co_parent_invitation_v1(null,null,null,null,null,null,null,null)",
  "create_adult_subject_invitation_v1(null,null,null,null,false)",
  "respond_adult_subject_invitation_v1(null,null,null,null)",
  "expire_due_adult_subject_invitations_v1()",
  "claim_mail_outbox()",
  "authorize_mail_submission_v1(null,null)",
  "read_co_parent_refusal_v1(null)",
  "refuse_co_parent_invitation_session_v1(null,null)",
  "run_due_embryo_retention_phases_v1()",
  "claim_refused_invitation_draft_purge_v1(repeat('a',64))",
  "finish_refused_invitation_draft_purge_v1(null,null)",
];

function session() {
  const child = spawn("docker", ["exec", "-i", `supabase_db_${project}`,
    "psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose",
    "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
  let pending;
  let stderr = "";
  let closed = false;
  let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  lines.on("line", (line) => {
    if (!pending) return;
    if (line === pending.marker) {
      const result = pending;
      pending = undefined;
      clearTimeout(result.timer);
      result.resolve(result.lines.join("\n").trim());
    } else pending.lines.push(line);
  });
  const completion = new Promise((resolve) => {
    const finish = () => {
      closed = true;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(stderr || "Database session ended"));
        pending = undefined;
      }
      resolve();
    };
    child.once("error", (error) => { stderr += error.message; finish(); });
    child.once("close", finish);
  });
  return {
    query(sql) {
      assert(!pending && !closed, "Database session is unavailable or busy");
      return new Promise((resolve, reject) => {
        const marker = `invitation_probe_${++sequence}`;
        const timer = setTimeout(() => {
          child.stdin.end();
          reject(new Error("Bounded database probe timed out"));
        }, 12_000);
        pending = { marker, resolve, reject, timer, lines: [] };
        child.stdin.write(`${sql};\n\\echo ${marker}\n`);
      });
    },
    async close() { child.stdin.end(); await completion; lines.close(); },
  };
}

const holder = session();
try {
  await holder.query("set statement_timeout='8s'; set idle_in_transaction_session_timeout='15s'");
  await holder.query("select pg_advisory_lock(1869509217,1)");
  for (const probe of probes) {
    const peer = session();
    try {
      const pid = Number(await peer.query("select pg_backend_pid()"));
      assert(Number.isSafeInteger(pid) && pid > 0);
      await peer.query("begin; set local role service_role; set local statement_timeout='5s'; set local idle_in_transaction_session_timeout='10s'");
      // Attach the rejection handler immediately: cancellation is expected.
      const attempt = peer.query(`select public.${probe}`).then(
        () => ({ error: null }), (error) => ({ error }),
      );
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        waiting = await holder.query(`select exists(select 1 from pg_locks where pid=${pid}
          and locktype='advisory' and classid=1869509217 and objid=1 and objsubid=2 and not granted)`) === "t";
        if (waiting) break;
        await delay(20);
      }
      // Cancel this exact test backend before releasing the holder's lock.
      await holder.query(`select pg_cancel_backend(${pid})`);
      const result = await attempt;
      assert(waiting, `${probe}: did not wait on the transition lock; ${result.error ?? "returned early"}`);
      assert.match(String(result.error), /57014/, "Probe must end by query cancellation");
      console.log(`PASS ${probe.split("(")[0]} waits before authority access`);
    } finally { await peer.close(); }
  }
  assert.equal(await holder.query("select pg_advisory_unlock(1869509217,1)"), "t");
  console.log(`${probes.length}/${probes.length} independent-session lock checks passed.`);
} finally { await holder.close(); }
