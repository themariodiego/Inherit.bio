import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createConfirmedUser, signIn } from "./helpers";

// A10 — Tier 2: a BAM within cap uploads resumably direct to storage over
// TUS. The upload is interrupted (second PATCH aborted at the network
// layer) and the tus client resumes; the file is hashed, listed as
// stored-not-analyzed, and re-downloadable byte-for-byte.

const USER = { email: "tier2@e2e.local", password: "e2e-tier2-pw" };
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/tiny.bam");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await createConfirmedUser(USER.email, USER.password);
  // Generate a ~14 MB BAM-magic file (bgzf-style gzip member wrapping
  // "BAM\1"), big enough for 3 TUS chunks at 6 MiB.
  if (!fs.existsSync(FIXTURE)) {
    execSync(
      `python3 -c "
import gzip, os, struct
raw = b'BAM\\x01' + struct.pack('<i', 0) + struct.pack('<i', 0) + os.urandom(14 * 1024 * 1024)
open('${FIXTURE}','wb').write(gzip.compress(raw, 0))
"`,
    );
  }
});

test("BAM uploads resumably (interrupted + resumed), is hashed, listed, and re-downloadable", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signIn(page, USER.email, USER.password);

  // Interrupt the SECOND chunk PATCH once; tus-js-client must retry and
  // resume from the offset rather than restarting.
  let patchCount = 0;
  let aborted = false;
  await page.route("**/upload/resumable/**", async (route) => {
    if (route.request().method() === "PATCH") {
      patchCount++;
      if (patchCount === 2 && !aborted) {
        aborted = true;
        await route.abort("connectionfailed");
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/uploads");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles(FIXTURE);

  await expect(page.getByText(/Uploading directly to storage/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByText("Stored and hashed. Analyze it with the self-host worker", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 240_000 });
  expect(aborted, "the test must actually have interrupted a chunk").toBe(
    true,
  );
  expect(patchCount).toBeGreaterThanOrEqual(3);

  // Listed with tier-2 status, sha256, and size.
  await page.reload();
  await expect(page.getByText("Stored (Tier 2)")).toBeVisible();
  await expect(page.getByText(/sha256/)).toBeVisible();

  // Re-download and compare bytes. (The Download control is an anchor to
  // /api/files/[id]/download — role "link", not "button".)
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const download = await downloadPromise;
  const downloaded = await download.path();
  const original = fs.readFileSync(FIXTURE);
  const roundTripped = fs.readFileSync(downloaded);
  expect(roundTripped.equals(original)).toBe(true);
});
