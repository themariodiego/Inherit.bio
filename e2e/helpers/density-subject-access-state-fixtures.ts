import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { SUBJECT_ACCESS_DENSITY_NATIVE_SOURCES, SUBJECT_ACCESS_DENSITY_TABLES, subjectAccessDensityFactsSchema,
  isSubjectAccessProcessingDensityState, type SubjectAccessDensityFacts } from "../../scripts/density-subject-access-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { DensityStateFixture } from "./density-current-capture";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A fresh original intake journey owns each viewport. The POST continues
 * afterward through the original real commit, activation and human refusal. */
export function realSubjectAccessProcessingDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { reviewerId: string; nativeSnapshot: SubjectAccessDensityFacts; originalRequestCount: number }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3102", "Original isolated public appeal app required");
  if (SUBJECT_ACCESS_DENSITY_NATIVE_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-subject-access-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [sourcePath, ...SUBJECT_ACCESS_DENSITY_NATIVE_SOURCES, "scripts/density-subject-access-states.ts",
    "scripts/density-appeal-review-states.ts", "scripts/density-claim-states.ts"]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => { for (const source of sources)
    assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256, "Original public intake source changed"); };
  return densityCapturePlan(input.register, []).states.filter(isSubjectAccessProcessingDensityState).map(row => ({
    routeId: row.route.id, state: row.state, sourcePath, sourceSha256,
    withState: async ({ viewport }, capture) => {
      assertSource();
      await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
        assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed native source required");
        for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
          "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
          "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
          assert(environment[name] === process.env[name], "Actual app, reviewer, native reader and owned admission must match");
        const { localE2eProject } = await import("../../scripts/local-e2e-project");
        assert(localE2eProject(environment).projectId === "sequence" && localE2eProject(process.env).projectId === "sequence",
          "Original disposable native project required");
        if (operator) {
          const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
          for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
            assert(process.env[name] === value, "Actual owned native daemon and scratch required");
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
          assert(UUID.test(reviewer), "Actual independent reviewer account required");
          await reviewFixtureSql(`select private.grant_claim_reviewer_v1('${reviewer}'::uuid);`);
          const claims = async () => {
            const cookies = await context.cookies();
            const auth = createServerClient(SUPABASE_URL, ANON_KEY, { cookies: { getAll: () => cookies,
              setAll: () => { throw new Error("Actual reviewer session cannot rotate during intake density proof"); } } });
            const verified = await auth.auth.getClaims();
            assert(!verified.error && verified.data, "Actual reviewer session verification unavailable");
            const value = verified.data.claims;
            assert(value.sub === reviewer && value.aal === "aal2" && typeof value.session_id === "string"
              && UUID.test(value.session_id), "Actual reviewer, MFA and current native session required");
            return value.session_id;
          };
          const originalSession = await claims();
          const read = async () => {
            assertSource(); assert(await claims() === originalSession, "Original reviewer session changed");
            return subjectAccessDensityFactsSchema.parse(JSON.parse(await reviewFixtureSql(intakeFactsSql(reviewer, originalSession))));
          };
          let before: SubjectAccessDensityFacts | undefined, captured = 0;
          await auditAssignedAppeal(page, input.browser, reviewer, async assertions => { await assertions(); }, undefined, {
            before: async () => {
              assert(before === undefined, "Exactly one original pre-intake native snapshot required"); before = await read();
            },
            held: async assertions => {
              await assertions(); assertSource();
              assert(++captured === 1 && before, "Exactly one capture inside the original intake POST required");
              const original = before;
              const observe = async () => {
                await assertions(); assertSource();
                const url = new URL(page.url());
                assert(url.origin === input.origin && url.pathname === row.route.path && !url.search && !url.hash,
                  "Exact served public appeals route required");
                const nativeSnapshot = await read();
                expect(nativeSnapshot, "All original target, intake, decision, mail, authority and source row bags stay exact before intake continuation")
                  .toEqual(original);
                await expect(page.locator("main h1")).toHaveText("Appeals and corrections");
                await expect(page.getByText("This form is for the test service. Do not send DNA or identity documents here.", { exact: true })).toBeVisible();
                await expect(page.locator("main [data-figure-kind], main [data-personal-preview]")).toHaveCount(0);
                return input.observeState(row, page, sourceSha256, { reviewerId: reviewer, nativeSnapshot, originalRequestCount: 1 });
              };
              await observe(); await capture({ page, observe }); await observe();
            },
          });
          assert(captured === 1, "The original complete intake/reviewer helper must settle after one capture");
          expect(await reviewFixtureSql("select enabled::text from private.new_public_appeal_config where singleton"))
            .toBe("false");
        } finally { await context.close(); }
      });
      assertSource();
    },
  } satisfies DensityStateFixture));
}

function intakeFactsSql(reviewer: string, session: string) {
  assert([reviewer, session].every(value => UUID.test(value)), "Only actual native account/session values required");
  const complete = Object.entries(SUBJECT_ACCESS_DENSITY_TABLES).map(([name, table]) => `'${name}',
    (select jsonb_build_object('count',count(*),'sha256',encode(extensions.digest(convert_to(
      coalesce(jsonb_agg(row order by row::text collate "C"),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex'))
     from (select to_jsonb(r) row from ${table} r) full_rows)`).join(",");
  return `select jsonb_build_object('completeBags',jsonb_build_object(${complete}),'scope',jsonb_build_object(
    'reviewerConfigured',(select count(*)=1 from private.new_public_appeal_reviewers r join public.subject_principals p
      on p.id=r.principal_id where p.account_id='${reviewer}'::uuid and r.active),
    'liveSession',exists(select 1 from auth.sessions s where s.id='${session}'::uuid and s.user_id='${reviewer}'::uuid
      and (s.not_after is null or s.not_after>clock_timestamp())),
    'noCaseForReviewer',not exists(select 1 from private.new_public_appeal_intakes i join public.subject_principals p
      on p.id=i.reviewer_principal_id where p.account_id='${reviewer}'::uuid),
    'intakeEnabled',(select enabled from private.new_public_appeal_config where singleton)));`;
}
