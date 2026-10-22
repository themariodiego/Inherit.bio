import http from "node:http";
import crypto from "node:crypto";
import { expect, test } from "./audited-test";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import bindings from "../scripts/comprehension/bindings.json";
import { participantCSeed, participantCPublication, participantCNoModelSurface } from "../scripts/comprehension/participant-c-seed";
import { saveQcSeedReceipt } from "./helpers/embryo-qc-seed-receipt";
import { provePublishedQcCrossSurface } from "./helpers/embryo-qc-cross-surface";
import { auditPublishedEmbryoSurfaces } from "./helpers/embryo-published-audits";
import { proveNativeDispositionAndProfile } from "./helpers/embryo-profile-journey";
import { readTaskSixTrace, startTaskSixTrace, readTaskSevenTrace, startTaskSevenTrace } from "./embryo-task-depth";
import { NO_ROWS_SENTENCE } from "@/copy/embryos/compare";
import { PRIMARY } from "@/copy/overview";
import { availabilityStatement, CANNOT_HAVE_BEST_OF_EACH, NO_RANKING_STATEMENT,
  TRADEOFF_LINE_ONE, TRADEOFFS_NONE_MEASURABLE } from "@/copy/embryos/tradeoffs";
import { openParticipantCReadSession } from "./participant-c-harness";
import { seedParticipantC } from "./participant-c-journey";
import { viewSchema } from "../scripts/comprehension/conductor-contract";
import { openNativeStatisticalCoverageAudit, openNativeFittedStatisticalCoverageAudit } from "./helpers/embryo-statistical-coverage-audit";
import { EMBRYO_PAIR_TABLE_FIXTURE } from "../scripts/embryo-pair-table-fixture";

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
      await test.step("task depth T7 reaches the registered no-model comparison through one actual action", async () => {
        const task = bindings.tasks.find(candidate => candidate.id === "T7")!;
        expect(task.account).toBe("participant-c");
        expect(task.fixtures).toEqual([fixture]);
        expect(task.routes).toEqual(["/embryos/compare"]);
        expect(task.unavailableState).toEqual({ selector: '[data-slot="no-rows"]',
          copySource: "src/copy/embryos/compare.ts", copyExport: "NO_ROWS_SENTENCE",
          nativeRead: "participantCPublication and participantCNoModelSurface" });
        const before = participantCPublication(await readPublication(), owner, cohortId);
        // Reaching the current result gate and signing in are setup, as for T6.
        // The measured task begins at Overview, without a typed-URL entry.
        await page.goto("/overview");
        await expect(page.locator("main h1")).toBeVisible();
        await startTaskSevenTrace(page);
        const compareLink = page.getByRole("link", { name: PRIMARY.compareEmbryos, exact: true })
          .and(page.locator('main a[data-slot="button"]'));
        await expect(compareLink).toHaveCount(1);
        await expect(compareLink).toHaveAttribute("href", task.routes[0]);
        await compareLink.click();
        await expect(page).toHaveURL(url => url.pathname === task.routes[0]);
        await expect(page.locator(task.unavailableState!.selector).first()).toBeVisible();
        await expect(page.locator(task.unavailableState!.selector).first()).toHaveText(NO_ROWS_SENTENCE);
        const noModel = participantCNoModelSurface({
          notices: await page.locator(task.unavailableState!.selector).allTextContents(),
          conditionRows: await page.locator("[data-condition-id]").count(),
          figures: await page.locator("[data-figure-kind]").evaluateAll(nodes => nodes.map(node => ({
            kind: node.getAttribute("data-figure-kind"), class: node.getAttribute("data-figure-class"),
          }))),
        });
        // Native file quality is observable. It supplies no personal risk,
        // condition estimate, absolute difference or selection recommendation.
        await expect(page.locator('[data-figure-kind="absolute"], [data-figure-kind="interval"]')).toHaveCount(0);
        const taskDepth = await readTaskSevenTrace(page);
        expect(taskDepth.actions).toBe(1);
        expect(taskDepth.trace).toEqual([{ event: "click", path: "/overview" }]);
        expect(participantCPublication(await readPublication(), owner, cohortId)).toEqual(before);
        await testInfo.attach("task-depth-T7", { contentType: "application/json", body: JSON.stringify({
          taskId: task.id, source: "actual-native-signed-parent-publication", fixture, cohortId, ownerId: owner,
          publicationRevision: before.cohort.publication_revision,
          start: "/overview", end: task.routes[0], unavailableState: task.unavailableState,
          noModel, ...taskDepth,
        }) });
        // This separate live context acts on the actual snapshot control ID.
        // Its native read checks run at observe, action and final record time.
        const taskReader = await openParticipantCReadSession({ browser, sessionId: "native-participant-c-T7",
          ownerId: owner, cohortId, email: ownerEmail, password, read: readPublication });
        try {
          const overview = viewSchema.parse(await taskReader.observe());
          const link = overview.visibleText.split("\n").find(line => line.endsWith(PRIMARY.compareEmbryos));
          const target = link?.match(/^\[([^ ]+) link\]/)?.[1];
          expect(target, "T7 must act on the actual Overview comparison control").toBeTruthy();
          await taskReader.act({ kind: "click", target: target! });
          const comparison = viewSchema.parse(await taskReader.observe());
          expect(comparison.path).toBe(task.routes[0]);
          expect(comparison.visibleText).toContain(NO_ROWS_SENTENCE);
          const record = await taskReader.record();
          expect(record).toEqual({ completed: true, path: ["/overview", "/embryos/compare"],
            actions: 1, entries: 0, confirmationExclusions: [] });
          expect(participantCPublication(await readPublication(), owner, cohortId)).toEqual(before);
          await testInfo.attach("participant-c-T7-harness-read", { contentType: "application/json", body: JSON.stringify({
            taskId: task.id, source: "actual-current-published-seed", cohortId, ownerId: owner,
            publicationRevision: before.cohort.publication_revision, fixture,
            unavailableState: task.unavailableState, ...record,
          }) });
        } finally { await taskReader.close(); }
      });
      for (const embryo of embryos) {
        await page.goto(`/embryos/${embryo.id}`);
        await expect(page.getByRole("heading", { level: 1, name: `Embryo ${embryo.sample_ordinal + 1}` })).toBeVisible();
        await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
      }
      const auditedSurfaces = await test.step("/embryos/upload complete; /embryos/compare complete; /embryos/[embryoId] complete from native parent-authorized publication", async () =>
        await auditPublishedEmbryoSurfaces({ page, ownerId: owner, cohortId, read: readPublication }));
      await testInfo.attach("published-embryo-surface-audits", { contentType: "application/json",
        body: JSON.stringify({ source: "actual-native-signed-parent-publication", cohortId,
          surfaces: auditedSurfaces, scientificCoverageStates: "held: no eligible result producer" }) });
      const repeatedQc = await provePublishedQcCrossSurface({ page, ownerId: owner, cohortId, read: readPublication });
      await testInfo.attach("published-qc-cross-surface", { contentType: "application/json", body: JSON.stringify(repeatedQc) });
      saveQcSeedReceipt("a", testInfo, runtime.runtimeOwner, repeatedQc);
      await runtime.runStatisticalWorker(cohortId);
      // Owner decision 2026-10-22 (G1.7, G1.12, G2.2): this TEST-only producer,
      // whose synthetic markers miss the whole invented panel, proves the three
      // not-covered pairs. One current read spans all three named steps.
      const statisticalAudits = await test.step("synthetic statistical coverage-failure audits on the hub, comparison and individual embryo views", async () => {
        const notCovered = await openNativeStatisticalCoverageAudit({ page, cohortId, embryos, proof: () => runtime.statisticalProof(cohortId) });
        await test.step("/embryos not-covered: the hub reads each embryo's synthetic TEST score at 0 of its 10 positions, marks it Not read with the too-little-coverage sentence, and renders no result figure",
          async () => await notCovered.route("/embryos"));
        await test.step("/embryos/compare not-covered: both compared embryos read 0 of the TEST score's 10 positions, each cell says Not read with the too-little-coverage sentence, and no result figure renders",
          async () => await notCovered.route("/embryos/compare"));
        await test.step("/embryos/[embryoId] not-covered: the one embryo reads 0 of the TEST score's 10 positions, says Not read with the too-little-coverage sentence, and renders no result figure",
          async () => await notCovered.route("/embryos/[embryoId]"));
        return await notCovered.finish();
      });
      await testInfo.attach("native-statistical-coverage-audits", { contentType: "application/json", body: JSON.stringify(statisticalAudits) });
      await proveNativeDispositionAndProfile({ owner: page, other, browser, cohortId,
        embryoId: embryos[0].id, siblingId: embryos[1].id });
      await runtime.withFittedJourney(cohortId, async fitted => {
        const second = await seedParticipantC({ page, browser, ownerEmail: "fitted-test@e2e.local",
          parentEmail: "fitted-test-parent@e2e.local", password, messages, runtime: fitted, fittedSeed: "partial" });
        try {
          await fitted.runStatisticalWorker(second.cohortId);
          // The same decision: the fitted partial journey, whose synthetic file
          // carries 8 of the panel's 10 positions, proves the three
          // partial-coverage pairs. One current read spans all three steps.
          const fittedAudits = await test.step("invented fitted TEST partial coverage and MODELLED interval audits on the hub, comparison and individual embryo views", async () => {
            const partial = await openNativeFittedStatisticalCoverageAudit({ page, cohortId: second.cohortId, embryos: second.embryos,
              proof: () => fitted.statisticalProof(second.cohortId) });
            await test.step("/embryos partial-coverage: the hub reads each embryo's fitted TEST score at 8 of its 10 positions, says the missing positions stay in the denominator, and shows only the MODELLED invented interval",
              async () => await partial.route("/embryos"));
            await test.step("/embryos/compare partial-coverage: both compared embryos read 8 of the fitted TEST score's 10 positions, each says the missing positions stay in the denominator beside its MODELLED invented interval",
              async () => await partial.route("/embryos/compare"));
            await test.step("/embryos/[embryoId] partial-coverage: the one embryo reads 8 of the fitted TEST score's 10 positions, says the missing positions stay in the denominator, and shows its MODELLED invented interval",
              async () => await partial.route("/embryos/[embryoId]"));
            return await partial.finish();
          });
          await testInfo.attach("native-fitted-test-statistical-audits", { contentType: "application/json",
            body: JSON.stringify(fittedAudits) });
        } finally { await second.closeCoParent(); }
      });
      // ADR 0037: the same synthetic pair as a laboratory table. The file
      // names its result column `Bases` and states no build, so the reader
      // answers one column question and the build question in the browser
      // before any chunk; the actual worker then publishes both sources.
      await test.step("a laboratory table answers its column and build questions and reaches native publication", async () => {
        testInfo.setTimeout(testInfo.timeout + 180_000);
        await runtime.withTableJourney(cohortId, async table => {
          const third = await seedParticipantC({ page, browser, ownerEmail: "table-test@e2e.local",
            parentEmail: "table-test-parent@e2e.local", password, messages, runtime: table, tableSeed: "unstated-build" });
          try {
            for (const embryo of third.embryos) {
              await page.goto(`/embryos/${embryo.id}`);
              await expect(page.getByRole("heading", { level: 1, name: `Embryo ${embryo.sample_ordinal + 1}` })).toBeVisible();
              await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
            }
            await testInfo.attach("laboratory-table-publication", { contentType: "application/json", body: JSON.stringify({
              source: "actual-native-signed-parent-publication", fixture: EMBRYO_PAIR_TABLE_FIXTURE, cohortId: third.cohortId,
              proof: await table.proof(third.cohortId) }) });
          } finally { await third.closeCoParent(); }
        });
      });
    } finally { await closeCoParent(); }
  });
});
