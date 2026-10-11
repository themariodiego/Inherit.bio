import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page, type Response, type Route } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { CLAIM_DENSITY_NATIVE_SOURCES, CLAIM_DENSITY_PROTECTED_TABLES, claimStartDensityFactsSchema,
  isClaimStartProcessingDensityState, type ClaimStartDensityFacts } from "../../scripts/density-claim-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const refusal = [
  "We release a record only to the adult it was made from. A person on our team checks a photo ID and a birth record before we release anything. We refuse a claim if you are under 18, if your papers do not link you to the record, or if more than one record could be yours. We never guess between records, and we never say whether a record exists.",
  "A parent may have told us the date and place of birth and the parents’ names. If no parent did, a claim without the Record Key Card cannot be matched to a record.",
  "Without the Record Key Card we cannot tell which record is yours, and we will not guess.",
];

function bagSql(query: string) {
  return `(select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
    coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))
    from (${query}) full_rows)`;
}
/** Whole row hashes are computed natively. No ciphertext, cookie, raw key,
 * claim papers, identity or unrelated personal row leaves this read. */
function claimFactsSql(input?: { sessionHash: string; keyHash: string; auditMark: string }) {
  if (input) assert(/^[a-f0-9]{64}$/.test(input.sessionHash) && /^[a-f0-9]{64}$/.test(input.keyHash)
    && /^(0|[1-9][0-9]*)$/.test(input.auditMark), "Only actual fixed claim hashes and audit position required");
  const protectedSql = Object.entries(CLAIM_DENSITY_PROTECTED_TABLES).map(([name, table]) =>
    `'${name}',${bagSql(`select to_jsonb(r) row from ${table} r`)}`).join(",");
  const intake = input ? `(select jsonb_build_object('count',count(*),'sessionMatches',bool_and(i.session_hash='${input.sessionHash}'),
    'keyMatches',bool_and(i.key_hash='${input.keyHash}'),'mode',min(i.mode),'live',bool_and(private.claim_intake_live_v1(i)),
    'incomplete',bool_and(i.completed_at is null),'sealed',bool_and(octet_length(i.identity_ciphertext) between 29 and 16384
      and octet_length(i.wrapped_data_key) between 29 and 256),'hmacRevisionsCurrent',bool_and(i.identifier_key_revision=private.hmac_active_revision_v1('rate-limit')
      and i.network_key_revision=private.hmac_active_revision_v1('rate-limit')),'deadlineIsOneDay',bool_and(i.expires_at=i.created_at+interval '24 hours'),
    'originalClocks',bool_and(i.last_active_at=i.created_at)) from private.future_person_claim_intakes i
    where i.session_hash='${input.sessionHash}')` : "null";
  const append = input ? `jsonb_build_object('prefix',${bagSql(`select to_jsonb(r) row from public.legal_audit_log r where r.seq<=${input.auditMark}`)},
    'count',(select count(*) from public.legal_audit_log where seq>${input.auditMark}),
    'exactStart',(select bool_and(event_code='claim.intake.started' and route_id='api.future-person-claim'
      and outcome_code='accepted' and coded_context='{}'::jsonb) from public.legal_audit_log where seq>${input.auditMark}))` : "null";
  return `select jsonb_build_object('protected',jsonb_build_object(${protectedSql}),
    'intakes',${bagSql("select to_jsonb(r) row from private.future_person_claim_intakes r")},
    'counters',${bagSql("select to_jsonb(r) row from public.rate_limit_hmac_buckets r")},
    'audit',${bagSql("select to_jsonb(r) row from public.legal_audit_log r")},
    'auditMark',(select coalesce(max(seq),0)::text from public.legal_audit_log),
    'intake',${intake},'auditAppend',${append});`;
}

async function assertClaimPage(page: Page, pending: boolean) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Claim a record created before you were born");
  const section = page.locator("main section[aria-labelledby='refusal-standard']");
  await expect(section.getByRole("heading", { name: "When we refuse a claim", exact: true })).toBeVisible();
  for (const text of refusal) await expect(section.getByText(text, { exact: true })).toBeVisible();
  for (const text of ["If you stop after this step, we delete what you sent within 24 hours.",
    "Questions about a claim go to legal@inherit.bio. Do not send identity papers by email."])
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.locator("main [data-figure-kind], main [data-personal-preview], main [data-claim-block]")).toHaveCount(0);
  if (pending) {
    const form = page.locator("main form");
    await expect(form.getByRole("button", { name: "Working…", exact: true })).toBeVisible();
    await expect(form.getByRole("button", { name: "Working…", exact: true })).toBeDisabled();
    await expect(form.getByRole("button", { name: "Start my claim", exact: true })).toHaveCount(0);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "We have your request", exact: true })).toHaveCount(0);
    await expect(page.locator("main input[type=file]")).toHaveCount(0);
    expect(await page.evaluate(() => {
      const first = document.querySelector("main input, main select, main textarea, main button");
      const before = document.querySelector("main section[aria-labelledby='refusal-standard']");
      return Boolean(first && before && !before.contains(first)
        && (before.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
  } else {
    await expect(page.getByRole("heading", { name: "We have your request", exact: true })).toBeVisible();
    await expect(page.getByText("Next you send a picture ID and a birth record, and a person on our team reviews them. Nothing you sent says whether a record exists.", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Send your files", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "We have your claim", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Working…", exact: true })).toHaveCount(0);
  }
}

/** The original public claim-start POST remains pending at the browser
 * boundary, then commits once. Every state/viewport needs fresh admission. */
export function realClaimProcessingDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { nativeSnapshot: ClaimStartDensityFacts; originalRequestCount: number }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3100", "Original TEST-LOCAL public claim app required");
  if (CLAIM_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-claim-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [...CLAIM_DENSITY_NATIVE_SOURCES, "scripts/density-claim-states.ts"]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => { for (const source of sources)
    assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Real claim source changed"); };
  return densityCapturePlan(input.register, []).states.filter(isClaimStartProcessingDensityState).map(row => ({
    routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
    withState: async ({ viewport }, capture) => {
      assertSource();
      await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
        assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed checkout required");
        for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
          "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID", "INHERIT_CI_BROWSER_RUNTIME",
          "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
          assert(environment[name] === process.env[name], "Actual claim reader and owned caller must match");
        const { localE2eProject } = await import("../../scripts/local-e2e-project");
        assert(localE2eProject(environment).projectId === "sequence"
          && localE2eProject(process.env).projectId === "sequence", "Original disposable native project required");
        if (operator) {
          const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
          for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
            assert(process.env[name] === value, "Native SQL requires actual owned daemon and scratch");
        }
        const { reviewFixtureSql } = await import("./claim-review-fixture");
        const read = async (binding?: { sessionHash: string; keyHash: string; auditMark: string }) => {
          assertSource(); return claimStartDensityFactsSchema.parse(JSON.parse(await reviewFixtureSql(claimFactsSql(binding))));
        };
        const context = await input.browser.newContext({ baseURL: input.origin, viewport, deviceScaleFactor: 1,
          colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage(), block = randomBytes(4).toString("hex");
        // Exactly the original claim fixture's documentation-only /64. No
        // quota is reset and a native capacity refusal still fails capture.
        await context.setExtraHTTPHeaders({ "x-real-ip": `2001:db8:${block.slice(0, 4)}:${block.slice(4)}::1` });
        const key = Array.from({ length: 20 }, () => CROCKFORD[randomInt(CROCKFORD.length)]).join("");
        const email = `claim-${randomBytes(6).toString("hex")}@e2e.local`, endpoint = `${input.origin}/api/future-person/claim`;
        const original: { continuation?: Promise<Response> } = {};
        let release: (() => void) | undefined, intercepted = 0;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        const hold = async (route: Route) => {
          assert(route.request().method() === "POST" && ++intercepted === 1, "Exactly one real claim-start POST required");
          assert(new URL(route.request().url()).search === "" && route.request().headers().origin === input.origin
            && route.request().headers()["sec-fetch-site"] === "same-origin"
            && route.request().headers()["content-type"] === "application/json", "Original served claim signals required");
          assert(Boolean(route.request().headers()["x-inherit-csrf"]), "Original served form token required");
          expect(route.request().postDataJSON()).toEqual({ mode: "record-key", recordKey: key,
            claimantDateOfBirth: "2000-01-31", claimantName: "Synthetic Claimant", contactEmail: email, affirmed: true });
          original.continuation = (async () => {
            await barrier; await route.continue(); const response = await route.request().response();
            assert(response && await response.finished() === null, "Original claim-start response must settle"); return response;
          })();
          void original.continuation.catch(() => {}); await original.continuation;
        };
        try {
          expect((await page.goto(row.route.path))?.status()).toBe(200);
          const cookies = await context.cookies(); expect(cookies.length).toBe(1);
          assert(/^(__Host-)?inherit-claim-form$/.test(cookies[0].name) && cookies[0].httpOnly
            && cookies[0].sameSite === "Strict" && cookies[0].path === "/"
            && /^[A-Za-z0-9_-]{43}$/.test(cookies[0].value), "Original private served form cookie required");
          await page.evaluate(() => fetch("/future-person/claim", { headers: { rsc: "1", "next-router-prefetch": "1" } }));
          assert((await context.cookies()).find(cookie => cookie.name === cookies[0].name)?.value === cookies[0].value,
            "Actual prefetch must preserve the served form credential");
          const formCookies = await context.cookies();
          const form = page.locator("main form");
          await form.getByRole("radio", { name: "I have a Record Key", exact: true }).check();
          await form.getByLabel("Record Key", { exact: true }).fill(key);
          await form.getByLabel("Your full name", { exact: true }).fill("Synthetic Claimant");
          await form.getByLabel("Your date of birth", { exact: true }).fill("2000-01-31");
          await form.getByLabel("Your email address", { exact: true }).fill(email);
          await form.getByRole("checkbox").check();
          const before = await read(); expect(before.intakes.count).toBe(0);
          expect(before.intake).toBeNull(); expect(before.auditAppend).toBeNull();
          await page.route(endpoint, hold); await form.getByRole("button", { name: "Start my claim", exact: true }).click();
          const observe = async () => {
            await expect.poll(() => intercepted).toBe(1); await assertClaimPage(page, true);
            assert(JSON.stringify(await context.cookies()) === JSON.stringify(formCookies), "Pending private form credential changed");
            const nativeSnapshot = await read();
            expect(nativeSnapshot, "The held original POST has changed no complete claim, target, audit or quota row").toEqual(before);
            return input.observeState(row, page, sourceSha256, { nativeSnapshot, originalRequestCount: intercepted });
          };
          await observe(); await capture({ page, observe });
          assert(release && original.continuation, "Only an actually started claim request may settle");
          release(); const response = await original.continuation;
          expect(response.status()).toBe(202); expect(await response.text()).toBe('{"status":"received"}');
          expect(response.headers()["cache-control"]).toBe("private, no-store");
          expect(response.headers()["referrer-policy"]).toBe("no-referrer"); expect(intercepted).toBe(1);
          await assertClaimPage(page, false);
          const session = (await context.cookies()).filter(cookie => /^(__Host-)?inherit-claim$/.test(cookie.name));
          expect(session.length).toBe(1);
          assert(session[0].httpOnly && session[0].sameSite === "Strict" && session[0].path === "/"
            && /^[A-Za-z0-9_-]{43}$/.test(session[0].value), "Actual native private claim session required");
          expect((await context.cookies()).some(cookie => /^(__Host-)?inherit-claim-form$/.test(cookie.name))).toBe(false);
          assert(await page.evaluate(() => document.cookie) === "", "No private claim credential may be readable by page script");
          const after = await read({ sessionHash: digest(session[0].value), keyHash: digest(key), auditMark: before.auditMark });
          expect(after.intakes.count).toBe(1); expect(after.intake).not.toBeNull();
          expect(after.protected, "One encrypted start grants no subject, source, paper, review, match or released result").toEqual(before.protected);
          expect(after.auditAppend?.prefix).toEqual(before.audit); expect(after.auditAppend).not.toBeNull();
        } finally {
          release?.();
          try { if (original.continuation) await original.continuation; }
          finally { await page.unroute(endpoint, hold); await context.close(); }
        }
      });
      assertSource();
    },
  } satisfies DensityStateFixture));
}
