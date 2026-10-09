import http from "node:http";
import crypto from "node:crypto";
import { expect, test } from "./audited-test";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import bindings from "../scripts/comprehension/bindings.json";
import { participantCSeed } from "../scripts/comprehension/participant-c-seed";
import { saveQcSeedReceipt } from "./helpers/embryo-qc-seed-receipt";
import { provePublishedQcCrossSurface } from "./helpers/embryo-qc-cross-surface";
import { auditPublishedEmbryoSurfaces } from "./helpers/embryo-published-audits";
import { proveNativeDispositionAndProfile } from "./helpers/embryo-profile-journey";
import { readTaskSixTrace, startTaskSixTrace } from "./embryo-task-depth";
import { PRIMARY } from "@/copy/overview";
import { availabilityStatement, CANNOT_HAVE_BEST_OF_EACH, NO_RANKING_STATEMENT,
  TRADEOFF_LINE_ONE, TRADEOFFS_NONE_MEASURABLE } from "@/copy/embryos/tradeoffs";
import { openParticipantCReadSession } from "./participant-c-harness";
import { seedParticipantC } from "./participant-c-journey";
import { viewSchema } from "../scripts/comprehension/conductor-contract";

/** No product handler, consent, worker or stored result is replaced here.
 * The local mail receiver captures synthetic delivery only. The isolated
 * launcher owns real worker execution; this test never publishes a row. */
const password = "synthetic-embryo-browser-password";
const boundSeed = participantCSeed(bindings.accounts.find(account => account.id === "participant-c"));
const ownerEmail = boundSeed.seed.email;
const parentEmail = boundSeed.seed.coParentEmail;
const fixture = boundSeed.files[0];
let mail: http.Server;
const messages: { to: string | string[]; html?: string }[] = [];

test.beforeAll(async () => {
  mail = http.createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) messages.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: crypto.randomUUID() }));
    });
  });
  await new Promise<void>(resolve => mail.listen(8124, "127.0.0.1", resolve));
});
test.afterAll(async () => { mail?.closeAllConnections(); if (mail) await new Promise<void>(resolve => mail.close(() => resolve())); });

test("participant-c adds the bound embryo pair through both parents, upload and real publication; task depth T6 follows the actual no-ranking statement", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  await withEmbryoJourney(process.env, async runtime => {
    const { owner, cohortId, embryos, readPublication, other, closeCoParent } = await seedParticipantC({ page, browser,
      ownerEmail, parentEmail, password, messages, runtime });
    try {
      // The genuine seed and explicit current parent permissions are setup.
      // T6 starts from the Overview after its real result gate has been passed.
      await page.goto("/overview");
      await expect(page.locator("main h1")).toBeVisible();
      await startTaskSixTrace(page);
      const primaryCompare = page.getByRole("link", { name: PRIMARY.compareEmbryos, exact: true })
        .and(page.locator('main a[data-slot="button"]'));
      await expect(primaryCompare).toHaveCount(1);
      await expect(primaryCompare).toHaveAttribute("href", "/embryos/compare");
      await primaryCompare.click();
      await expect(page).toHaveURL(url => url.pathname === "/embryos/compare");
      await expect(page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
      const tradeOffPanel = page.locator('[data-trade-off-panel]');
      await expect(tradeOffPanel).toHaveCount(1);
      await expect(tradeOffPanel).toBeVisible();
      await expect(tradeOffPanel).toContainText(TRADEOFF_LINE_ONE);
      await expect(tradeOffPanel).toContainText(CANNOT_HAVE_BEST_OF_EACH);
      await expect(tradeOffPanel.locator('[data-slot="trade-off-statement"]')).toHaveText(TRADEOFFS_NONE_MEASURABLE);
      await expect(tradeOffPanel.locator('[data-slot="availability-statement"]')).toHaveText(availabilityStatement(embryos.length));
      await expect(page.locator('details [data-trade-off-panel]')).toHaveCount(0);
      // This genuine published fixture has no approved result condition. It
      // must explain the absent trade-off rather than invent a risk or rank.
      await expect(tradeOffPanel.locator('[data-slot="trade-off-conflicts"]')).toHaveCount(0);
      await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"]')).toHaveCount(0);
      await expect(page.locator('[aria-sort], table th button')).toHaveCount(0);
      for (const role of ["button", "combobox", "checkbox", "radio"] as const) {
        await expect(page.getByRole(role, { name: /rank|best embryo|recommend/i })).toHaveCount(0);
      }
      const measured = await readTaskSixTrace(page);
      expect(measured.actions).toBe(1);
      expect(measured.trace).toEqual([{ event: "click", path: "/overview" }]);
      await testInfo.attach("task-depth-T6", { contentType: "application/json", body: JSON.stringify({
        taskId: "T6", source: "actual-native-signed-parent-publication", fixture, cohortId,
        start: "/overview", end: "/embryos/compare", ...measured,
      }) });
      // Consume the actual published seed through the live harness's fresh
      // context/read/action interface, without invoking any inference process.
      const reader = await openParticipantCReadSession({ browser, sessionId: "native-participant-c-T6",
        ownerId: owner, cohortId, email: ownerEmail, password,
        read: readPublication });
      try {
        const view = viewSchema.parse(await reader.observe());
        const compare = view.visibleText.split("\n").find(line => line.endsWith(PRIMARY.compareEmbryos));
        const id = compare?.match(/^\[([^ ]+) link\]/)?.[1];
        expect(id, "The actual harness snapshot must expose the Overview comparison link").toBeTruthy();
        await reader.act({ kind: "click", target: id! });
        const comparison = viewSchema.parse(await reader.observe());
        expect(comparison.path).toBe("/embryos/compare");
        expect(comparison.visibleText).toContain(NO_RANKING_STATEMENT);
        const record = await reader.record();
        expect(record).toEqual({ completed: true, path: ["/overview", "/embryos/compare"],
          actions: 1, entries: 0, confirmationExclusions: [] });
        await testInfo.attach("participant-c-harness-read", { contentType: "application/json", body: JSON.stringify({
          taskId: "T6", source: "actual-current-published-seed", cohortId, ownerId: owner,
          publicationRevision: 1, fixture, ...record,
        }) });
      } finally { await reader.close(); }
      for (const embryo of embryos) {
        await page.goto(`/embryos/${embryo.id}`);
        await expect(page.getByRole("heading", { level: 1, name: `Embryo ${embryo.sample_ordinal + 1}` })).toBeVisible();
        await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
      }
      const auditedSurfaces = await auditPublishedEmbryoSurfaces({ page, ownerId: owner, cohortId,
        read: readPublication });
      await testInfo.attach("published-embryo-surface-audits", { contentType: "application/json",
        body: JSON.stringify({ source: "actual-native-signed-parent-publication", cohortId,
          surfaces: auditedSurfaces, scientificCoverageStates: "held: no eligible result producer" }) });
      const repeatedQc = await provePublishedQcCrossSurface({ page, ownerId: owner, cohortId, read: readPublication });
      await testInfo.attach("published-qc-cross-surface", { contentType: "application/json", body: JSON.stringify(repeatedQc) });
      saveQcSeedReceipt("a", testInfo, runtime.runtimeOwner, repeatedQc);
      await proveNativeDispositionAndProfile({ owner: page, other, browser, cohortId,
        embryoId: embryos[0].id, siblingId: embryos[1].id });
    } finally { await closeCoParent(); }
  });
});
