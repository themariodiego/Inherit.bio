import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { BrowserContext, Page, Request as BrowserRequest, Route } from "@playwright/test";
import type { HistoricalProducerInput, HistoricalParentReceipt } from "../../scripts/tools/claimed-provenance-historical-fixture";
import { assertHistoricalConcurrencyFixture, assertHistoricalParentReceipt, historicalAccountOwnedTarget,
  sqlLiteral } from "../../scripts/claimed-provenance-historical-contract.mjs";

type CapturedPost = {
  method: "POST"; url: "http://127.0.0.1:3105/api/account/delete";
  headers: { origin: string | null; fetchSite: string | null; contentType: "application/json" };
  body: { confirmation: "account.delete.confirmation"; nonce: string };
  outcome: "observed-aborted-before-dispatch";
};
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const hash = /^[0-9a-f]{64}$/u;
const root = new URL("../..", import.meta.url);

/** Sensitive IPC enters stdin only. SDK/SQL diagnostics and token/cookie values
 * never become error text, argv, a saved receipt or browser output. */
function ownerIpc(step: "create" | "prepare", input: unknown, environment: NodeJS.ProcessEnv): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "./scripts/server-only-shim.mjs",
      "--import", "tsx", "./scripts/tools/historical-account-request.run.mts"],
    { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", diagnostic = false, finished = false;
    const finish = (value?: unknown) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (value === undefined) { child.kill("SIGTERM"); reject(new Error("Historical request unavailable")); }
      else resolve(value);
    };
    const timer = setTimeout(() => finish(), 60_000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (Buffer.byteLength(output) > 65_536) finish(); });
    child.stderr.on("data", () => { diagnostic = true; });
    child.once("error", () => finish()); child.stdin.once("error", () => finish());
    child.once("close", code => {
      if (code !== 0 || diagnostic) { finish(); return; }
      try { finish(JSON.parse(output)); } catch { finish(); }
    });
    const payload = JSON.stringify({ step, input });
    if (Buffer.byteLength(payload) > 32_768) { finish(); return; }
    child.stdin.end(payload);
  });
}

function ownerHash(sql: string, dbContainer: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", dbContainer, "psql", "-XAtq", "--set=ON_ERROR_STOP=1",
      "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", diagnostic = false, finished = false;
    const finish = (value?: string) => {
      if (finished) return; finished = true; clearTimeout(timer);
      if (value === undefined) { child.kill("SIGTERM"); reject(new Error("Historical metadata unavailable")); }
      else resolve(value);
    };
    const timer = setTimeout(() => finish(), 15_000);
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); if (output.length > 128) finish(); });
    child.stderr.on("data", () => { diagnostic = true; });
    child.once("error", () => finish()); child.stdin.once("error", () => finish());
    child.once("close", code => finish(code === 0 && !diagnostic && hash.test(output.trim()) ? output.trim() : undefined));
    child.stdin.end(`begin read only; set local statement_timeout='15s'; set local lock_timeout='2s';
${sql}; rollback;\n`);
  });
}

function accountStateSql(accountId: string): string {
  assert(uuid.test(accountId));
  return `select encode(extensions.digest(convert_to(jsonb_build_object(
    'profile',(select to_jsonb(p) from public.profiles p where p.id=${sqlLiteral(accountId)}::uuid),
    'authSessions',(select jsonb_agg(to_jsonb(s) order by s.id) from auth.sessions s where s.user_id=${sqlLiteral(accountId)}::uuid),
    'nonces',(select jsonb_agg(to_jsonb(n) order by n.nonce_hash) from public.account_operation_nonces n where n.account_id=${sqlLiteral(accountId)}::uuid),
    'requests',(select jsonb_agg(to_jsonb(d) order by d.id) from public.account_deletion_requests d where d.account_id=${sqlLiteral(accountId)}::uuid),
    'retention',(select jsonb_agg(to_jsonb(r) order by r.id) from public.retention_rows r where r.target_kind='account' and r.target_id=${sqlLiteral(accountId)}::uuid),
    'phases',(select jsonb_agg(to_jsonb(f) order by f.retention_row_id,f.phase_id,f.phase_revision) from public.retention_due_phases f
      join public.retention_rows r on r.id=f.retention_row_id where r.target_kind='account' and r.target_id=${sqlLiteral(accountId)}::uuid),
    'mail',(select jsonb_agg(to_jsonb(m) order by m.id) from public.mail_outbox m where m.target_kind='account' and m.target_id in(
      select d.id from public.account_deletion_requests d where d.account_id=${sqlLiteral(accountId)}::uuid)))::text,'UTF8'),'sha256'),'hex')`;
}

function immutableSubjectSql(subjectId: string): string {
  assert(uuid.test(subjectId));
  return `with custody as(select c.* from private.future_person_custody_slices c where c.subject_id=${sqlLiteral(subjectId)}::uuid),
    sources as(select s.* from private.embryo_canonical_sources s join custody c on c.source_file_id=s.file_id),
    membership as(select m.* from private.embryo_canonical_source_parts m join sources s on s.file_id=m.file_id),
    parts as(select p.* from private.embryo_canonical_parts p join membership m on m.part_id=p.id)
    select encode(extensions.digest(convert_to(jsonb_build_object(
      'custody',(select jsonb_agg(to_jsonb(c) order by c.subject_id) from custody c),
      'sources',(select jsonb_agg(to_jsonb(s) order by s.file_id) from sources s),
      'membership',(select jsonb_agg(to_jsonb(m) order by m.part_id) from membership m),
      'parts',(select jsonb_agg(to_jsonb(p) order by p.id) from parts p))::text,'UTF8'),'sha256'),'hex')`;
}

/** Observe a genuine page POST, abort it before dispatch, and require a real
 * requestfailed event. No fulfilled response or HTTP202 lineage is manufactured. */
async function observeAbortedPost(page: Page): Promise<CapturedPost> {
  let captured: CapturedPost | undefined, count = 0, responses = 0, failed = 0;
  const exact = (request: BrowserRequest) => request.method() === "POST"
    && request.url() === "http://127.0.0.1:3105/api/account/delete";
  const response = (value: { request(): BrowserRequest }) => { if (exact(value.request())) responses += 1; };
  const requestFailed = (request: BrowserRequest) => { if (exact(request)) failed += 1; };
  page.on("response", response); page.on("requestfailed", requestFailed);
  const pattern = "http://127.0.0.1:3105/api/account/delete";
  let accept: () => void = () => undefined;
  let refuse: (reason: Error) => void = () => undefined;
  const intercepted = new Promise<void>((resolve, reject) => { accept = resolve; refuse = reject; });
  // Install the handler completely before the native UI action. The actual
  // request failure uses Playwright's existing bound, with no new deadline.
  const intercept = async (route: Route) => {
      const request = route.request();
      if (!exact(request)) { await route.continue(); return; }
      count += 1;
      try {
        const body: unknown = request.postDataJSON();
        assert(body && typeof body === "object" && !Array.isArray(body)
          && Object.keys(body).sort().join(",") === "confirmation,nonce");
        const payload = body as Record<string, unknown>;
        const headers = await request.allHeaders();
        assert(payload.confirmation === "account.delete.confirmation" && typeof payload.nonce === "string"
          && headers["content-type"] === "application/json");
        captured = { method: "POST", url: pattern, headers: { origin: headers.origin ?? null,
          fetchSite: headers["sec-fetch-site"] ?? null, contentType: "application/json" },
        body: { confirmation: "account.delete.confirmation", nonce: payload.nonce }, outcome: "observed-aborted-before-dispatch" };
        await route.abort("aborted"); accept();
      } catch { await route.abort("aborted"); refuse(new Error("Historical page issuance unavailable")); }
  };
  await page.route(pattern, intercept);
  try {
    const actualFailure = page.waitForEvent("requestfailed", exact);
    await Promise.all([intercepted, actualFailure, (async () => {
      await page.getByLabel(/Type/u).fill("delete my genome");
      await page.getByTestId("delete-account").click();
    })()]);
    assert(captured && count === 1 && responses === 0 && failed === 1, "Only the observed aborted POST may supply issuance");
    return captured;
  } finally { await page.unroute(pattern, intercept); page.off("response", response); page.off("requestfailed", requestFailed); }
}

/** Distinct, consumed historical adapter. The current HTTP202 producer and
 * controller remain separate. Provider acknowledgements below are synthetic
 * metadata only; exact prior identity/original Storage absence stays required. */
export async function prepareHistoricalSharedProvenanceFixture(
  page: Page, context: BrowserContext, expectedAccount: string,
  claimant: Omit<HistoricalProducerInput, "parent">, appEnvironment: NodeJS.ProcessEnv,
) {
  assert(uuid.test(expectedAccount));
  const target = historicalAccountOwnedTarget(readFileSync(new URL("../../supabase/config.toml", import.meta.url), "utf8"), appEnvironment);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(new URL(page.url()).origin, "http://127.0.0.1:3105");
  const subjectBefore = await ownerHash(immutableSubjectSql(claimant.subjectId), target.dbContainer);
  await page.goto("/settings/data");
  const accountBefore = await ownerHash(accountStateSql(expectedAccount), target.dbContainer);
  const observation = await observeAbortedPost(page);
  assert.equal(await ownerHash(accountStateSql(expectedAccount), target.dbContainer), accountBefore,
    "Aborted issuance cannot dispatch, consume or create a deletion request");
  const cookies = (await context.cookies()).map(({ name, value }) => ({ name, value }));
  const parent = assertHistoricalParentReceipt(await ownerIpc("create", { accountId: expectedAccount, observation, cookies }, appEnvironment),
    target.projectId, head) as HistoricalParentReceipt;
  assert.equal(await ownerHash(immutableSubjectSql(claimant.subjectId), target.dbContainer), subjectBefore,
    "Historical request cannot rewrite immutable claimant/source history");
  const fixture = assertHistoricalConcurrencyFixture(await ownerIpc("prepare", { ...claimant, parent }, appEnvironment), target.projectId, head);
  assert.equal(await ownerHash(immutableSubjectSql(claimant.subjectId), target.dbContainer), subjectBefore,
    "Actual due/ACK preparation cannot rewrite immutable claimant/source history");
  return fixture;
}
