import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { APPEAL_REVIEW_DENSITY_NATIVE_SOURCES, APPEAL_REVIEW_DENSITY_TABLES, appealReviewDensityFactsSchema,
  isAppealReviewProcessingDensityState, isAppealReviewCompleteDensityState, type AppealReviewDensityFacts } from "../../scripts/density-appeal-review-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The original helper already holds the single real decision POST. Its
 * complete authorization, theme, native outcome and cleanup remain intact. */
export function realAppealReviewProcessingDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { reviewerId: string; caseId: string; nativeSnapshot: AppealReviewDensityFacts }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3102", "Original isolated appeal reviewer app required");
  if (APPEAL_REVIEW_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-appeal-review-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [sourcePath, ...APPEAL_REVIEW_DENSITY_NATIVE_SOURCES, "scripts/density-appeal-review-states.ts", "scripts/density-claim-states.ts"]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => { for (const source of sources)
    assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Original appeal reviewer source changed"); };
  return densityCapturePlan(input.register, []).states.filter(row => isAppealReviewProcessingDensityState(row) || isAppealReviewCompleteDensityState(row)).map(row => ({
    routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
    withState: async ({ viewport }, capture) => {
      assertSource();
      await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
        assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed native source required");
        for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
          "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
          "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
          assert(environment[name] === process.env[name], "Actual Auth, app, native reader and owned runtime must share admission");
        const { localE2eProject } = await import("../../scripts/local-e2e-project");
        assert(localE2eProject(environment).projectId === "sequence" && localE2eProject(process.env).projectId === "sequence",
          "Original disposable native project required");
        if (operator) {
          const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
          for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
            assert(process.env[name] === value, "Native reviewer reader requires actual owned daemon and scratch");
        }
        const { reviewFixtureSql, signInReviewer } = await import("./claim-review-fixture");
        const { auditAssignedAppeal } = await import("./public-appeal-review-audit");
        const { createServerClient } = await import("@supabase/ssr");
        const { ANON_KEY, SUPABASE_URL } = await import("../helpers");
        const context = await input.browser.newContext({ baseURL: input.origin, viewport, deviceScaleFactor: 1,
          colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
        const page = await context.newPage();
        try {
          const reviewer = await signInReviewer(context, input.origin);
          assert(UUID.test(reviewer), "Actual reviewer account required");
          // The original caller grants this same genuine account before
          // invoking the helper; assignment and scope still remain native.
          await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}'::uuid);`);
          let captured = 0;
          const captureReviewedState = async (assertions: () => Promise<void>) => {
            await assertions(); assertSource();
            const url = new URL(page.url());
            const caseId = url.pathname.match(/^\/reviews\/appeals\/([^/]+)$/)?.[1];
            assert(url.origin === input.origin && !url.search && !url.hash && caseId && UUID.test(caseId), "Actual assigned native case page required");
            const claims = async () => {
              const cookies = await context.cookies();
              const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
                setAll: () => { throw new Error("Actual reviewer session cannot rotate during density proof"); } } });
              const verified = await auth.auth.getClaims();
              assert(!verified.error && verified.data, "Actual reviewer session verification unavailable");
              const value = verified.data.claims;
              assert(value.sub === reviewer && value.aal === "aal2" && typeof value.session_id === "string"
                && UUID.test(value.session_id), "Genuine reviewer account, MFA and native session required");
              return value.session_id;
            };
            const originalSession = await claims();
            const read = async () => appealReviewDensityFactsSchema.parse(JSON.parse(
              await reviewFixtureSql(appealFactsSql(caseId, reviewer, await claims()))));
            const original = await read();
            const observe = async () => {
              assertSource(); assert(await claims() === originalSession, "Original stepped-up reviewer session changed");
              const nativeSnapshot = await read();
              expect(nativeSnapshot, "Every complete case, decision, target, authority, document and audit row remains exact while the original POST is held")
                .toEqual(original);
              if (row.state === "processing") await assertPendingReview(page);
              else await assertCompleteReview(page);
              return input.observeState(row, page, sourceSha256, { reviewerId: reviewer, caseId, nativeSnapshot });
            };
            assert(++captured === 1, "One actual held review state, without replay, required");
            await observe(); await capture({ page, observe }); await observe();
          };
          await auditAssignedAppeal(page, input.browser, reviewer, async assertions => {
            if (row.state === "processing") await captureReviewedState(assertions);
            else await assertions();
          }, row.state === "complete" ? captureReviewedState : undefined);
          assert(captured === 1, "The original pending callback must have completed capture exactly once");
          // Original helper has settled the same POST, verified native closed
          // case/key/session cleanup and unchanged full targets, and restored
          // the original closed fixture configuration before returning.
          assertSource();
        } finally { await context.close(); }
      });
      assertSource();
    },
  } satisfies DensityStateFixture));
}

function appealFactsSql(caseId: string, reviewer: string, session: string) {
  assert([caseId, reviewer, session].every(value => UUID.test(value)), "Only actual native identity values required");
  const complete = Object.entries(APPEAL_REVIEW_DENSITY_TABLES).map(([name, table]) => `'${name}',
    (select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
      coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))
     from (select to_jsonb(r) row from ${table} r) full_rows)`).join(",");
  return `select jsonb_build_object('completeBags',jsonb_build_object(${complete}),'scope',
    (select jsonb_build_object('count',count(*),'reviewerMatches',bool_and(p.account_id='${reviewer}'::uuid),
      'liveSession',exists(select 1 from auth.sessions s where s.id='${session}'::uuid and s.user_id='${reviewer}'::uuid
        and (s.not_after is null or s.not_after>clock_timestamp())),
      'committed',bool_and(i.state='committed'),'sealed',bool_and(i.wrapped_case_key is not null and i.working_ciphertext is not null))
     from private.new_public_appeal_intakes i join public.subject_principals p on p.id=i.reviewer_principal_id
     where i.id='${caseId}'::uuid));`;
}

async function assertPendingReview(page: Page) {
  await expect(page.getByRole("heading", { name: "Review request", exact: true })).toBeVisible();
  await expect(page.getByText("Claimant: Synthetic appeal requester.", { exact: true })).toBeVisible();
  const refusal = page.getByRole("heading", { name: "Refuse this request", exact: true }).locator("..");
  await expect(refusal).toHaveAttribute("aria-busy", "true");
  await expect(refusal.getByRole("status")).toHaveText("Saving this choice.");
  await expect(refusal.getByLabel("Reason", { exact: true })).toBeDisabled();
  await expect(refusal.getByRole("checkbox")).toBeDisabled();
  await expect(refusal.getByRole("button", { name: "Refuse request", exact: true })).toBeDisabled();
  for (const text of ["This closes only this request. It does not give access or change anyone's data.",
    "Record what you checked. Do not copy file content into the reason.", "I have read this request and the files that are here."])
    await expect(refusal.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByText("This request was closed.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open file", exact: true })).toHaveCount(0);
  await expect(page.locator("main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
}

async function assertCompleteReview(page: Page) {
  await expect(page.getByRole("heading", { name: "Review request", exact: true })).toBeVisible();
  await expect(page.getByText("Claimant: Synthetic appeal requester.", { exact: true })).toBeVisible();
  const refusal = page.getByRole("heading", { name: "Refuse this request", exact: true }).locator("..");
  await expect(refusal).toHaveAttribute("aria-busy", "false");
  await expect(refusal.getByLabel("Reason", { exact: true })).toBeEnabled();
  await expect(refusal.getByRole("checkbox")).not.toBeChecked();
  await expect(refusal.getByRole("button", { name: "Refuse request", exact: true })).toBeDisabled();
  for (const text of ["This closes only this request. It does not give access or change anyone's data.",
    "Record what you checked. Do not copy file content into the reason.", "I have read this request and the files that are here."])
    await expect(refusal.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByText("Saving this choice.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("This request was closed.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open file", exact: true })).toHaveCount(0);
  await expect(page.locator("main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
}
