import { expect, test } from "@playwright/test";

/**
 * The six `versioned-document` routes in their `complete` state: a committed
 * artifact rendered, at a specific version, with a permanent link back to that
 * version.
 *
 * The permalink is the assertion with teeth here, and it is why these are six
 * tests rather than one. All four document routes render the same
 * `LegalArtifactDocument`; what differs is the `routeBase` and `versionPath`
 * each hands it, so `/legal/<key>` must link to `/legal/<key>/versions/N` and
 * `/legal/consent/<key>` to `/legal/consent/<key>/v/N`. A permanent link to a
 * consent version is the evidence trail for what a person agreed to, so one
 * surface silently linking into the other's base is worth catching.
 *
 * `consent.own-polygenic` is shipped at version 2 with version 1 superseded by
 * `20260906135854_own_report_layer_language.sql`, so every one of these six
 * URLs resolves in any database the migrations built — the diffs included,
 * which need two versions to be anything but a 404.
 */
const KEY = "consent.own-polygenic";
const SUMMARY = "Plain-language summary";
const PERMALINK = "Permanent link to this version";

async function expectArtifact(
  page: import("@playwright/test").Page,
  url: string,
  permalinkBase: string,
) {
  const response = await page.goto(url);
  expect(response?.status(), `${url} resolves to a committed artifact`).toBe(200);
  await expect(page.locator("main h1")).toHaveText(KEY);
  await expect(page.getByText(SUMMARY)).toBeVisible();
  const permalink = page.getByRole("link", { name: PERMALINK });
  await expect(permalink).toBeVisible();
  // The version it links to is the version it rendered, under this route's own
  // base — never the sibling surface's.
  await expect(permalink).toHaveAttribute("href", new RegExp(`^${permalinkBase}/\\d+$`));
}

test("/legal/[artifact] complete: the current committed artifact and its permanent link", async ({ page }) => {
  await expectArtifact(page, `/legal/${KEY}`, `/legal/${KEY}/versions`);
});

test("/legal/[artifact]/versions/[version] complete: one named version of the artifact", async ({ page }) => {
  await expectArtifact(page, `/legal/${KEY}/versions/1`, `/legal/${KEY}/versions`);
  await expect(page.getByRole("link", { name: PERMALINK }))
    .toHaveAttribute("href", `/legal/${KEY}/versions/1`);
});

test("/legal/consent/[key] complete: the same artifact under the consent base", async ({ page }) => {
  await expectArtifact(page, `/legal/consent/${KEY}`, `/legal/consent/${KEY}/v`);
});

test("/legal/consent/[key]/v/[version] complete: one named version under the consent base", async ({ page }) => {
  await expectArtifact(page, `/legal/consent/${KEY}/v/1`, `/legal/consent/${KEY}/v`);
  await expect(page.getByRole("link", { name: PERMALINK }))
    .toHaveAttribute("href", `/legal/consent/${KEY}/v/1`);
});

test("/legal/[artifact]/diff/[from]/[to] complete: the two versions it names", async ({ page }) => {
  const response = await page.goto(`/legal/${KEY}/diff/1/2`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("main")).toContainText("Version comparison");
  await expect(page.locator("main"), "the pair it compares, named on the page")
    .toContainText(`${KEY}: v1 → v2`);
});

test("/legal/consent/[key]/diff/[from]/[to] complete: the two versions it names", async ({ page }) => {
  const response = await page.goto(`/legal/consent/${KEY}/diff/1/2`);
  expect(response?.status()).toBe(200);
  // "Consent comparison", not the artifact surface's "Version comparison":
  // the consent route words its own heading, and pinning both separately is
  // what keeps that deliberate difference from being flattened later.
  await expect(page.locator("main")).toContainText("Consent comparison");
  await expect(page.locator("main"), "the pair it compares, named on the page")
    .toContainText(`${KEY}: v1 → v2`);
});
