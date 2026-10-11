import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import { densityCapturePlan, type DensityStateCase, type DENSITY_VIEWPORTS } from "../../scripts/density-capture-plan";
import { FINALIZED_EMBRYO_EMPTY_DENSITY_SOURCES, checkedFinalizedEmbryoEmptyFacts,
  finalizedEmbryoEmptyDensityRecipe, type FinalizedEmbryoEmptyFacts } from "../../scripts/density-finalized-embryo-empty-states";
import type { DensityRegister } from "../../scripts/density-current";
import type { OwnedLinuxCapability } from "../../scripts/owned-linux-runtime";
import type { ParticipantCMail } from "../participant-c-journey";
import type { DensityStateFixture } from "./density-current-capture";

type Viewport = typeof DENSITY_VIEWPORTS[number];
type Environment = Readonly<Record<string, string | undefined>>;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** One genuinely finalized/no-file cohort for each fixed capture viewport.
 * The existing before-file helper supplies actual owner/native row facts and
 * continues its original upload, worker, whole publication and cleanup. */
export function realFinalizedEmbryoEmptyDensityFixtures(input: {
  root: string; browser: Browser; origin: string; register: DensityRegister;
  actualMessages: ParticipantCMail[]; jobsSecret: string;
  withFreshNativeRuntime: <T>(row: DensityStateCase, viewport: Viewport,
    work: (environment: Environment, operator?: OwnedLinuxCapability) => Promise<T>) => Promise<T>;
  observeState: (row: DensityStateCase, page: Page, fixtureSourceSha256: string,
    facts: { accountId: string; cohortId: string; nativeSnapshot: FinalizedEmbryoEmptyFacts }) => Promise<unknown>;
}): DensityStateFixture[] {
  assert(input.origin === "http://localhost:3105", "Original owned native embryo app required");
  if (FINALIZED_EMBRYO_EMPTY_DENSITY_SOURCES.some(name => !fs.existsSync(path.join(input.root, name)))) return [];
  const sourcePath = "e2e/helpers/density-finalized-embryo-empty-state-fixtures.ts";
  const sourceSha256 = digest(fs.readFileSync(path.join(input.root, sourcePath)));
  const sources = [sourcePath, "scripts/density-finalized-embryo-empty-states.ts", ...FINALIZED_EMBRYO_EMPTY_DENSITY_SOURCES]
    .map(name => ({ name, sha256: digest(fs.readFileSync(path.join(input.root, name))) }));
  const assertSource = () => { for (const source of sources)
    assert(digest(fs.readFileSync(path.join(input.root, source.name))) === source.sha256,
      "Original finalized native journey, scope or complete row reader changed"); };
  return densityCapturePlan(input.register, []).states.flatMap(row => {
    if (finalizedEmbryoEmptyDensityRecipe(row) === null) return [];
    return [{ routeId: row.route.id, state: row.state, sourcePath, sourceSha256, serviceOrigin: input.origin,
      withState: async ({ viewport }, capture) => {
        assertSource();
        await input.withFreshNativeRuntime(row, viewport, async (environment, operator) => {
          assert(fs.realpathSync(process.cwd()) === fs.realpathSync(input.root), "Exact composed native source required");
          for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
            "INHERIT_UPLOAD_SIGNING_JWK", "RUNNER_TEMP", "INHERIT_CI_RUNTIME_UID", "INHERIT_CI_RUNTIME_GID",
            "INHERIT_CI_BROWSER_RUNTIME", "INHERIT_LOCAL_E2E_PROJECT", "INHERIT_LOCAL_E2E_WORKDIR", "DOCKER_HOST", "DOCKER_CONTEXT"])
            assert(environment[name] === process.env[name], "Native parent, worker and SQL caller must share actual admission");
          const { localE2eProject } = await import("../../scripts/local-e2e-project");
          assert(localE2eProject(environment).projectId === "sequence"
            && localE2eProject(process.env).projectId === "sequence", "Original disposable native project required");
          assert(input.jobsSecret.length > 0 && input.jobsSecret === environment.JOBS_SECRET, "Actual app mail/jobs caller required");
          if (operator) {
            const { ownedLinuxEnvironment } = await import("../../scripts/owned-linux-runtime");
            for (const [name, value] of Object.entries(ownedLinuxEnvironment(operator)))
              assert(process.env[name] === value, "Native whole-row reader requires actual owned daemon and scratch");
          }
          // Import the existing env-sensitive native helper only after its
          // real runtime and source have been admitted. No session adoption.
          const { withFinalizedEmbryoEmpty } = await import("../density-embryo-empty-state-fixtures");
          const context = await input.browser.newContext({ baseURL: input.origin, viewport, deviceScaleFactor: 1,
            colorScheme: "light", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC", serviceWorkers: "block" });
          let captures = 0;
          try {
            const page = await context.newPage();
            await page.goto(input.origin);
            await withFinalizedEmbryoEmpty({ page, browser: input.browser, environment, operator,
              ownerEmail: "participant-c@e2e.local", parentEmail: "participant-c-parent@e2e.local",
              messages: input.actualMessages, jobsSecret: input.jobsSecret,
              capture: async scope => {
                assert(++captures === 1, "One actual finalized empty callback required");
                const expected = { accountId: scope.accountId, cohortId: scope.cohortId, embryoId: scope.embryoId,
                  subjectId: scope.subjectId, nativeSessionId: scope.nativeSessionId, completeNativeBag: scope.wholeBag };
                const observe = async () => {
                  assertSource();
                  const pendingInput = await scope.read();
                  const nativeSnapshot = checkedFinalizedEmbryoEmptyFacts({ pendingInput,
                    nativeSessionId: scope.nativeSessionId, completeNativeBag: scope.wholeBag }, expected);
                  await expect(scope.page).toHaveURL(`${input.origin}/embryos/${scope.embryoId}`);
                  return input.observeState(row, scope.page, sourceSha256,
                    { accountId: scope.accountId, cohortId: scope.cohortId, nativeSnapshot });
                };
                await observe();
                await capture({ page: scope.page, observe });
                await observe();
              },
            });
            assert(captures === 1, "The original upload, worker and publication must finish after the one empty capture");
          } finally { await context.close(); }
        });
        assertSource();
      },
    } satisfies DensityStateFixture];
  });
}
