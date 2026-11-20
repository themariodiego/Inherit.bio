import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { adminClient, completeOwnUploadConsent, createConfirmedUser, signIn } from "./helpers";
import { OWN_UPLOAD_COPY } from "../src/copy/upload/consent";
import { INGEST_REFUSALS } from "../src/copy/upload/errors";
import { READ_CALLING_COPY } from "../src/copy/upload/read-calling";

/**
 * G7.4 BAM/CRAM read calling on the production build: the same build with
 * the TEST-LOCAL flag unset (`jurisdiction-off`, port 3101). Production keeps
 * today's behaviour (ADR 0038; owner decision of 16 October 2026): the picker
 * offers one file, states that BAM, CRAM and FASTQ are not accepted, and
 * refuses a real, readable synthetic BAM before any upload session is issued.
 * The account's consent is completed on the TEST-LOCAL server, as the other
 * `*.nojurisdiction` specs do their account steps; the control is the same
 * account and file on that server, where the picker offers read calling.
 */

test.use({ trace: "off" });

const MAIN = "http://localhost:3100";
/** Retyped rather than imported, so the assertion checks that the sentence reaches the reader. */
const REFUSED = "Inherit does not accept BAM, CRAM or FASTQ files. Ask your lab for a VCF. Changing the file name does not change its format.";
const BAM = path.join(process.cwd(), "e2e/fixtures/read-calls-product-grch38.bam");
const CRAM = path.join(process.cwd(), "src/lib/genome/reads/fixtures/synthetic-matrix.cram");

test("the production build refuses a readable synthetic BAM and CRAM before any upload session, with the reason stated", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = `read-calls-production-${randomUUID()}@e2e.local`, password = "e2e-read-calls-production-pw";
  const accountId = await createConfirmedUser(email, password);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, email, password);
    await completeOwnUploadConsent(page, `${MAIN}/files/upload`);
    await expect(page.locator('[data-slot="read-calling-available"]'), "the control: TEST-LOCAL offers read calling")
      .toHaveText(READ_CALLING_COPY.available);

    const requests: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/storage/v1/") || url.pathname === "/api/uploads"
        || url.pathname === "/api/files/upload-session" || /\/api\/files\/[^/]+\/(?:finalize|process)$/.test(url.pathname)) {
        requests.push(`${request.method()} ${url.pathname}`);
      }
    });
    const response = await page.goto("/files/upload");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).port).toBe("3101");
    expect(OWN_UPLOAD_COPY.sequenceReadsUnavailable).toBe(REFUSED);
    await expect(page.getByText(REFUSED, { exact: true })).toBeVisible();
    await expect(page.locator('[data-slot="read-calling-available"]')).toHaveCount(0);
    expect(await page.content()).not.toContain(READ_CALLING_COPY.available);
    const input = page.locator('input[type="file"]');
    expect(await input.getAttribute("multiple")).toBeNull();
    for (const file of [BAM, CRAM]) {
      await input.setInputFiles(file);
      await expect(page.getByRole("alert").filter({ hasText: INGEST_REFUSALS.unrecognised_format }))
        .toHaveText(INGEST_REFUSALS.unrecognised_format);
      await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeEnabled();
    }
    await expect(page.locator('[data-slot="read-calls-saved"]')).toHaveCount(0);
    expect(requests).toEqual([]);
    const admin = adminClient();
    const leases = await admin.from("upload_sessions").select("id").eq("account_id", accountId);
    expect(leases.error).toBeNull();
    expect(leases.data).toEqual([]);
    const files = await admin.from("genome_files").select("id").eq("user_id", accountId);
    expect(files.error).toBeNull();
    expect(files.data).toEqual([]);
  } finally {
    await context.close();
  }
});
