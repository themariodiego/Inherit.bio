import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { historicalAccountObservation, verifyHistoricalAccountAuthority, historicalAccountCreationSql } from "./historical-account-authority";
import { historicalClaimedProvenanceProducerSql, type HistoricalProducerInput } from "./claimed-provenance-historical-fixture";
import { HISTORICAL_LINEAGE, assertHistoricalParentReceipt, assertHistoricalConcurrencyFixture, historicalRequestProjectionSql,
  historicalAccountOwnedTarget } from "../claimed-provenance-historical-contract.mjs";

// Owner fixture IPC only. Internal SDK diagnostics never expose cookies,
// protected contact, a signed token, SQL context or an error object.
console.warn = console.error = console.log = console.debug = () => undefined;
try {
  const target = historicalAccountOwnedTarget(readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8"), process.env);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("../..", import.meta.url), encoding: "utf8" }).trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error("Unavailable");
  const input = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    const timer = setTimeout(() => reject(new Error("Unavailable")), 5000);
    process.stdin.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 32_768) { clearTimeout(timer); process.stdin.destroy(); reject(new Error("Unavailable")); }
      else chunks.push(chunk);
    });
    process.stdin.once("end", () => {
      clearTimeout(timer);
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)
          || Object.keys(value).sort().join(",") !== "input,step") throw new Error("Unavailable");
        resolve(value as Record<string, unknown>);
      } catch { reject(new Error("Unavailable")); }
    });
    process.stdin.once("error", () => { clearTimeout(timer); reject(new Error("Unavailable")); });
  });
  let sql: string;
  if (input.step === "create") {
    const observation = historicalAccountObservation.parse(input.input);
    const client = createServerClient(target.apiOrigin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => observation.cookies,
        setAll: () => { throw new Error("Historical request requires the original fresh SDK session"); } },
    });
    const authority = await verifyHistoricalAccountAuthority(observation, client);
    sql = historicalAccountCreationSql(authority)
      + "create temporary table historical_parent_receipt_result as "
      + historicalRequestProjectionSql(authority.accountId, null, authority.sessionId, authority.nonceHash)
      + `;
do $receipt$ begin
  if (select count(*) from historical_parent_receipt_result)<>1
    or exists(select 1 from historical_parent_receipt_result where jsonb_typeof(receipt) is distinct from 'object'
      or (select count(*) from jsonb_each(receipt))<>13
      or exists(select 1 from jsonb_each(receipt) item where item.value='null'::jsonb)) then
    raise exception using errcode='42501',message='historical request receipt unavailable';end if;
end $receipt$;
select receipt from historical_parent_receipt_result;
commit;
`;
  } else if (input.step === "prepare") {
    sql = historicalClaimedProvenanceProducerSql(input.input as HistoricalProducerInput, target.projectId, head);
  } else throw new Error("Unavailable");
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", target.dbContainer, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    let text = "", diagnostic = false, finished = false;
    const refuse = () => { if (finished) return; finished = true; clearTimeout(timer); child.kill("SIGTERM"); reject(new Error("Unavailable")); };
    const timer = setTimeout(refuse, 60_000);
    child.stdout.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); if (text.length > 65_536) refuse(); });
    child.stderr.on("data", () => { diagnostic = true; });
    child.once("error", refuse); child.stdin.once("error", refuse);
    child.once("close", code => {
      if (finished) return;
      if (code !== 0 || diagnostic) { refuse(); return; }
      finished = true; clearTimeout(timer); resolve(text.trim());
    });
    child.stdin.end(sql);
  });
  const result: unknown = JSON.parse(output);
  const receipt = input.step === "create"
    ? assertHistoricalParentReceipt({ ...(result as object), version: "claimed-provenance-historical-parent-request-v1",
      projectId: target.projectId, sourceCommit: head, lineage: HISTORICAL_LINEAGE,
      nativePost: "observed-aborted-before-dispatch" }, target.projectId, head)
    : assertHistoricalConcurrencyFixture(result, target.projectId, head);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} catch {
  process.stderr.write("historical_account_fixture_unavailable\n");
  process.exitCode = 1;
}
