import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { CLAIM_REVIEW_DENSITY_NATIVE_SOURCES, CLAIM_REVIEW_DENSITY_TABLES, checkClaimReviewDensityFacts,
  isClaimReviewDensityState, type ClaimReviewDensityFacts } from "../../scripts/density-claim-review-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";
type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Each pair/viewport uses the original fresh encrypted claimant, Storage,
 * scanner, named reviewer/MFA and actual native delivery/read contract. */
export function realClaimReviewDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { claimId: string; reviewerId: string; nativeSnapshot: ClaimReviewDensityFacts }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3100", "Original isolated claim review app required");
  if (CLAIM_REVIEW_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-claim-review-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [sourcePath, ...CLAIM_REVIEW_DENSITY_NATIVE_SOURCES, "scripts/density-claim-review-states.ts", "scripts/density-claim-states.ts"]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => { for (const source of sources)
    assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Original claim review source changed"); };
  return densityCapturePlan(input.register, []).states.filter(isClaimReviewDensityState).map(row => ({
    routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
    withState: async ({ viewport }, capture) => {
      assertSource();
      await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
        assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed native source required");
        for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
          "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID", "INHERIT_CI_BROWSER_RUNTIME",
          "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
          assert(environment[name] === process.env[name], "Actual Auth, app, native reader and owned runtime must share admission");
        const { localE2eProject } = await import("../../scripts/local-e2e-project");
        assert(localE2eProject(environment).projectId === "sequence" && localE2eProject(process.env).projectId === "sequence",
          "Original disposable native project required");
        if (operator) {
          const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
          for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
            assert(process.env[name] === value, "Native reviewer reader requires actual owned daemon and scratch");
        }
        const { reviewFixtureSql } = await import("./claim-review-fixture");
        const { auditClaimCompleteForDensity, auditClaimProcessingForDensity } = await import("./density-claim-review-audit");
        const { ANON_KEY, SUPABASE_URL } = await import("../helpers");
        const context = await input.browser.newContext({ baseURL: input.origin, viewport, deviceScaleFactor: 1,
          colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage();
        try {
          let captured = 0;
          const captureOriginalState = async (claimId: string, reviewerId: string, session: string) => {
            assert([claimId, reviewerId, session].every(value => UUID.test(value)), "Actual native case, reviewer and MFA session required");
            const claims = async () => {
              const cookies = await context.cookies();
              const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
                setAll: () => { throw new Error("Actual reviewer session cannot rotate during density proof"); } } });
              const verified = await auth.auth.getClaims();
              assert(!verified.error && verified.data, "Actual reviewer session verification unavailable");
              const value = verified.data.claims;
              assert(value.sub === reviewerId && value.aal === "aal2" && value.session_id === session,
                "Original reviewer account, MFA and native session must remain current");
            };
            const read = async () => {
              await claims(); assertSource();
              return checkClaimReviewDensityFacts(JSON.parse(await reviewFixtureSql(claimReviewFactsSql(claimId, reviewerId, session))), row.state);
            };
            const original = await read();
            const observe = async () => {
              const nativeSnapshot = await read();
              expect(nativeSnapshot, "Every complete native target, authority, paper, receipt and audit bag remains exact around capture").toEqual(original);
              await assertReviewState(page, row.state);
              return input.observeState(row, page, sourceSha256, { claimId, reviewerId, nativeSnapshot });
            };
            assert(++captured === 1, "Exactly one capture inside the original audited boundary required");
            await observe(); await capture({ page, observe }); await observe();
          };
          if (row.state === "complete")
            await auditClaimCompleteForDensity(page, context, input.browser, input.origin, captureOriginalState);
          else await auditClaimProcessingForDensity(page, context, input.origin, captureOriginalState);
          assert(captured === 1, "The original complete or held-byte callback must have actually completed capture");
          assertSource();
        } finally { await context.close(); }
      });
      assertSource();
    },
  } satisfies DensityStateFixture));
}

function claimReviewFactsSql(claim: string, reviewer: string, session: string) {
  assert([claim, reviewer, session].every(value => UUID.test(value)), "Only actual native identity values required");
  const complete = Object.entries(CLAIM_REVIEW_DENSITY_TABLES).map(([name, table]) => `'${name}',
    (select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
      coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))
     from (select to_jsonb(r) row from ${table} r) full_rows)`).join(",");
  return `select jsonb_build_object('completeBags',jsonb_build_object(${complete}),'scope',
    (select jsonb_build_object('count',count(*),'reviewerMatches',
      exists(select 1 from private.claim_reviewers rv where rv.account_id='${reviewer}'::uuid and rv.status='active' and rv.revoked_at is null),
      'liveSession',exists(select 1 from auth.sessions s where s.id='${session}'::uuid and s.user_id='${reviewer}'::uuid
        and (s.not_after is null or s.not_after>clock_timestamp())),
      'currentAssignment',(select count(*)=1 and bool_and(a.reviewer_account_id='${reviewer}'::uuid and a.assignment_revision=1)
        from private.claim_review_assignments a where a.review_id=r.id and a.status='current'),
      'reviewState',min(r.state),'reviewRevision',min(r.review_revision),'mode',min(r.mode),'caseKind',min(r.case_kind),
      'sealed',bool_and(i.identity_key_shredded_at is null and octet_length(i.wrapped_data_key) between 29 and 256
        and octet_length(i.identity_ciphertext) between 29 and 16384),'completedIntake',bool_and(i.completed_at is not null),
      'cleanDocuments',(select count(*) from private.claim_documents d where d.id in(r.photo_document_id,r.birth_record_document_id) and d.state='clean'
        and d.scan_verdict='OK' and d.scanned_sha256=d.sha256 and d.object_deleted_at is null),
      'decisions',(select count(*) from private.claim_review_decisions d where d.review_id=r.id),
      'documentReads',(select count(*) from private.claim_review_reads x where x.review_id=r.id and x.document_id is not null),
      'currentDocumentReads',not exists(select 1 from private.claim_review_reads x
        left join private.claim_documents d on d.id=x.document_id
        where x.review_id=r.id and x.document_id is not null and (x.delivery_verified_at is null
          or x.reviewer_account_id is distinct from '${reviewer}'::uuid or x.auth_session_id is distinct from '${session}'::uuid
          or x.document_sha256 is distinct from d.sha256 or x.review_revision is distinct from r.review_revision
          or not exists(select 1 from private.claim_review_assignments a where a.review_id=r.id and a.status='current'
            and a.reviewer_account_id=x.reviewer_account_id and a.assignment_revision=x.assignment_revision))))
      from private.claim_reviews r join private.future_person_claim_intakes i on i.id=r.id where r.id='${claim}'::uuid group by r.id));`;
}

async function assertReviewState(page: Page, state: string) {
  await expect(page.getByRole("heading", { name: "Review claim", exact: true })).toBeVisible();
  await expect(page.getByText("Claimant: Synthetic Claimant. Birth date: 2000-01-31.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Choice", { exact: true }).locator("option")).toHaveText(["Refuse claim", "Ask for more information"]);
  await expect(page.getByRole("button", { name: "Start owner notice", exact: true })).toHaveCount(0);
  await expect(page.getByText("Decision saved.", { exact: true })).toHaveCount(0);
  await expect(page.locator("main [data-figure-kind], main [data-claim-block]")).toHaveCount(0);
  if (state === "processing") {
    await expect(page.getByRole("button", { name: "Open Picture ID", exact: true })).toHaveText("Reading file…");
    await expect(page.getByRole("button", { name: "Open Picture ID", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Open Birth record", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save choice", exact: true })).toBeDisabled();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("img")).toHaveCount(0);
  } else {
    assert(state === "complete", "Only the original complete reviewer state required");
    await expect(page.getByRole("img", { name: "Photo identity document", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Birth record, page 2", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save choice", exact: true })).toBeEnabled();
    for (const checked of await page.getByRole("checkbox").all()) await expect(checked).toBeChecked();
    await expect(page.getByRole("checkbox")).toHaveCount(2);
  }
}
