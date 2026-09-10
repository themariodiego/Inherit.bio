import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { localE2eProject } from "../scripts/local-e2e-project";
import { adminClient, createConfirmedUser, signIn } from "./helpers";
import { uploadOwnFileWithChosenReports } from "./own-report-helpers";
import { OWN_REPORT_CHOICES } from "../src/lib/uploads/own-report-purpose";

/**
 * A published consent document is immutable: `consent_artifacts_immutable`
 * rejects every update with SQLSTATE 55000, and that is true of the service
 * role too, so PostgREST cannot supersede one. The shipped supersede in
 * `20260906135854_own_report_layer_language.sql` is the only sanctioned shape —
 * lock the table, drop the guard, update, put the guard back — and this
 * mirrors it rather than inventing a second one. Learned by trying the
 * ordinary update first and getting "immutable row" back.
 */
const sql = async (query: string): Promise<string> => (await promisify(execFile)("docker",
  ["exec", localE2eProject(process.env).dbContainer, "psql", "-U", "postgres", "-d", "postgres",
    "-XAt", "--set=ON_ERROR_STOP=1", "--command", query], { timeout: 15_000, maxBuffer: 65_536 })).stdout.trim();

/**
 * G5.2 in a browser. The database contract is already held by
 * `supabase/tests/consent_artifact_word_budgets.sql` and by
 * `private.current_own_report_grant_v1`, which stops resolving a grant the
 * moment its version is superseded. What no test reached was the part a person
 * actually meets: whether the surface tells them the document moved, what
 * changed, and where to read what they originally agreed to.
 *
 * The brief asks E2E to prove six things — version, effective date, summary,
 * the stored signed version, forced re-consent, and the change summary — so
 * this drives a real supersede rather than asserting against seeded state.
 *
 * `consent.own-polygenic` is superseded here rather than `consent.own-ancestry`
 * because the polygenic generation path is the one `tiny-grch38.vcf` is known
 * to complete; the point under test is the consent contract, not the analysis.
 * The artifact table is restored exactly in `afterAll`, and the grants this
 * spec creates are removed, because superseding a shipped document is global
 * state that later specs share.
 */
const PURPOSE = "reports.polygenic";
const KEY = OWN_REPORT_CHOICES[PURPOSE].artifactKey;
const LABEL = OWN_REPORT_CHOICES[PURPOSE].label;
const NEW_BODY = "Synthetic superseding body for the browser re-consent proof.";
const CHANGE_SUMMARY = "Adds a synthetic clause so this version differs from the one already agreed to.";

let signedVersion: number;
let publishedVersion: number;
let subjectId: string;

test.beforeAll(async () => {
  const live = await adminClient().from("consent_artifacts")
    .select("version").eq("artifact_key", KEY).is("superseded_at", null).single();
  expect(live.error, "the document under test must be published").toBeNull();
  signedVersion = live.data!.version;
  publishedVersion = signedVersion + 1;
});

test.afterAll(async () => {
  // Undo the supersede exactly. Anything less leaves a shipped consent
  // document altered for every spec that runs after this one.
  //
  // Order is the whole difficulty, and both edges were found by hitting them.
  // consent_signatures and purpose_grants both point at (artifact_key,
  // version), so the synthetic version cannot go first; and purpose_grants
  // .signature_id points at consent_signatures, so the grant must go before
  // the signature it was signed with. One transaction, so a missed dependency
  // rolls back rather than leaving the table half-restored.
  await sql(`begin;
    create temp table doomed on commit drop as
      select grant_id from public.purpose_grants
       where artifact_key='${KEY}' and artifact_version=${publishedVersion};
    delete from public.purpose_grant_nonces where grant_id in (select grant_id from doomed);
    delete from private.own_analysis_runs where grant_id in (select grant_id from doomed);
    delete from private.family_report_grant_snapshots where grant_id in (select grant_id from doomed);
    delete from private.family_portrait_grant_snapshots where grant_id in (select grant_id from doomed);
    delete from private.health_picture_grant_snapshots where grant_id in (select grant_id from doomed);
    delete from public.directional_grants where grant_id in (select grant_id from doomed);
    delete from public.purpose_grants where artifact_key='${KEY}' and artifact_version=${publishedVersion};
    delete from public.consent_signatures where artifact_key='${KEY}' and artifact_version=${publishedVersion};
    delete from public.consent_artifacts where artifact_key='${KEY}' and version=${publishedVersion};
    alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
    update public.consent_artifacts set superseded_at=null
     where artifact_key='${KEY}' and version=${signedVersion};
    alter table public.consent_artifacts enable trigger consent_artifacts_immutable;
  commit;`);
  // Verify the cleanup rather than assume it: the synthetic version is gone,
  // nothing still references it, and the version that was live is live again.
  expect(await sql(`select
      (select count(*) from public.consent_artifacts where artifact_key='${KEY}' and version=${publishedVersion})
    ||'/'||(select count(*) from public.consent_signatures where artifact_key='${KEY}' and artifact_version=${publishedVersion})
    ||'/'||(select count(*) from public.purpose_grants where artifact_key='${KEY}' and artifact_version=${publishedVersion})
    ||'/'||(select version from public.consent_artifacts where artifact_key='${KEY}' and superseded_at is null);`),
  "artifact/signature/grant rows for the synthetic version, then the live version")
    .toBe(`0/0/0/${signedVersion}`);
});

test("a superseded document forces re-consent and says what changed beside the accept control", async ({ page }) => {
  const user = { email: `consent-version-${randomUUID()}@e2e.local`, password: "e2e-consent-pw" };
  const userId = await createConfirmedUser(user.email, user.password);
  await signIn(page, user.email, user.password);
  await uploadOwnFileWithChosenReports(page, path.join(process.cwd(), "e2e/fixtures/tiny-grch38.vcf"),
    { fileType: "vcf", purposes: [PURPOSE] });

  const admin = adminClient();
  // Scoped to this account's own subject. Earlier specs in the shared database
  // hold live grants for the same purpose, so an unscoped read finds theirs.
  const self = await admin.from("subjects").select("id")
    .eq("subject_account_id", userId).eq("subject_class", "self").single();
  expect(self.error).toBeNull();
  subjectId = self.data!.id;
  const granted = await admin.from("purpose_grants").select("artifact_version, revoked_at")
    .eq("target_id", subjectId).eq("purpose", PURPOSE).eq("artifact_key", KEY).is("revoked_at", null).single();
  expect(granted.error).toBeNull();
  // The stored signed version, which is what a supersede is measured against.
  expect(granted.data!.artifact_version, "the grant records the version signed").toBe(signedVersion);
  await expect(page.getByRole("region", { name: "Choose your reports", exact: true })
    .getByRole("button", { name: `Turn off ${LABEL}`, exact: true })).toBeVisible();

  // Publish a superseding version, the way a material change reaches people.
  await sql(`do $supersede$ declare affected integer; begin
    lock table public.consent_artifacts in access exclusive mode;
    alter table public.consent_artifacts disable trigger consent_artifacts_immutable;
    update public.consent_artifacts set superseded_at=clock_timestamp()
     where artifact_key='${KEY}' and version=${signedVersion} and superseded_at is null;
    get diagnostics affected=row_count;
    if affected<>1 then raise exception 'expected exactly one live version to supersede'; end if;
    alter table public.consent_artifacts enable trigger consent_artifacts_immutable;
    insert into public.consent_artifacts
      (artifact_key,version,body_sha256,body_markdown,summary_markdown,effective_on,summary_of_changes)
    values('${KEY}',${publishedVersion},'${createHash("sha256").update(NEW_BODY).digest("hex")}',
      $body$${NEW_BODY}$body$,$summary$A synthetic summary for the superseding version.$summary$,
      current_date,$changes$${CHANGE_SUMMARY}$changes$);
  end $supersede$;`);
  expect(await sql(`select version from public.consent_artifacts
    where artifact_key='${KEY}' and superseded_at is null;`),
  "exactly one live version, and it is the new one").toBe(String(publishedVersion));

  await page.goto("/genome/me/reports");
  const choices = page.getByRole("region", { name: "Choose your reports", exact: true });

  // Forced re-consent: the capability is off despite an unrevoked grant.
  await expect(choices.getByRole("button", { name: `Turn off ${LABEL}`, exact: true }),
    "a superseded document must withdraw the capability").toHaveCount(0);
  await expect(choices.getByRole("button", { name: `Enable ${LABEL}`, exact: true })).toBeVisible();
  const stillGranted = await admin.from("purpose_grants").select("revoked_at")
    .eq("target_id", subjectId).eq("purpose", PURPOSE).is("revoked_at", null);
  expect(stillGranted.data, "the grant is not revoked — it stops resolving").not.toHaveLength(0);

  // The change summary, in the same block as the accept control.
  const notice = choices.getByTestId("reconsent-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(`You agreed to version ${signedVersion}`);
  await expect(notice.getByTestId("reconsent-change")).toHaveText(new RegExp(CHANGE_SUMMARY.slice(0, 40)));
  const block = notice.locator("xpath=..");
  await expect(block.getByRole("checkbox", { name: LABEL, exact: true }),
    "the accept control must sit in the block carrying the change summary").toBeVisible();
  await expect(block.getByRole("button", { name: `Enable ${LABEL}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const found = document.querySelector('[data-testid="reconsent-notice"]');
    const control = found?.parentElement?.querySelector('input[type="checkbox"]');
    if (!found || !control) return false;
    return Boolean(found.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), "the change summary must precede the control it explains").toBe(true);

  // The full previous version at a stable permalink: version, date, summary.
  const permalink = notice.getByTestId("reconsent-previous");
  await expect(permalink).toHaveAttribute("href", `/legal/consent/${KEY}/v/${signedVersion}`);
  const response = await page.goto(`/legal/consent/${KEY}/v/${signedVersion}`);
  expect(response?.status(), "the version that was signed must stay readable").toBeLessThan(400);
  const document_ = page.locator("main");
  await expect(document_).toContainText(`Version ${signedVersion}`);
  await expect(document_.locator("time")).toBeVisible();
  await expect(document_.locator("[data-legal-summary]")).not.toBeEmpty();

  // Re-consent restores the capability and records the new version.
  await page.goto("/genome/me/reports");
  await choices.getByRole("checkbox", { name: LABEL, exact: true }).check();
  const signature = page.waitForResponse(r => r.url().endsWith("/api/consents") && r.request().method() === "POST");
  await choices.getByRole("button", { name: `Enable ${LABEL}`, exact: true }).click();
  expect((await signature).status()).toBe(201);
  await expect(choices.getByRole("button", { name: `Turn off ${LABEL}`, exact: true })).toBeVisible();
  await expect(choices.getByTestId("reconsent-notice"),
    "an agreed-to current version must stop asking").toHaveCount(0);
  const resigned = await admin.from("purpose_grants").select("artifact_version")
    .eq("target_id", subjectId).eq("purpose", PURPOSE).is("revoked_at", null)
    .order("artifact_version", { ascending: false }).limit(1).single();
  expect(resigned.data!.artifact_version, "the new signature records the new version").toBe(publishedVersion);
});
