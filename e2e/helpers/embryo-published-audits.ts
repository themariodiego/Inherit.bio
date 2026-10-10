import { expect, type Page } from "@playwright/test";
import { auditContext, watchContext } from "../audited-test";
import { axeViolations } from "../helpers";
import { POPULATED_EMBRYO_AUDITS } from "../accessibility-sweeps";
import { participantCPublication } from "../../scripts/comprehension/participant-c-seed";
import { NO_RANKING_STATEMENT } from "@/copy/embryos/tradeoffs";
import { REGISTRY_EMPTY_SENTENCE, STANDING_STATEMENT } from "@/copy/embryos/compare";
import { ADD_MORE_EMBRYOS_BUTTON, TESTED_QUESTION_HEADING, UPLOAD_COMPLETE_HEADING, UPLOAD_COMPLETE_SENTENCE } from "@/copy/embryos/upload";
import { QC_PASSED } from "@/copy/embryos/qc";

/** Read-only supplemental sweep in the same authenticated native journey.
 * The exact current producer receipt is required before and after every
 * surface; no QC result, score, source or permission is inserted here. */
export async function auditPublishedEmbryoSurfaces(input: { page: Page; ownerId: string;
  cohortId: string; read(): Promise<unknown> }) {
  const { page, ownerId, cohortId } = input;
  const current = async () => participantCPublication(await input.read(), ownerId, cohortId);
  const original = await current();
  const targets = [
    { route: "/embryos", url: "/embryos", kind: "index" as const },
    { route: "/embryos/upload", url: "/embryos/upload", kind: "upload" as const },
    { route: "/embryos/compare", url: `/embryos/compare?cohort=${cohortId}`, kind: "compare" as const },
    ...original.embryos.map(embryo => ({ route: "/embryos/[embryoId]", url: `/embryos/${embryo.id}`,
      kind: "detail" as const, embryo })),
  ];
  expect([...new Set(targets.map(target => target.route))].sort()).toEqual(Object.keys(POPULATED_EMBRYO_AUDITS).sort());
  const observed = watchContext(page.context());
  const receipts: { route: string; url: string; theme: "light" | "dark" }[] = [];
  for (const target of targets) {
    expect(await current()).toEqual(original);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      observed.origins.clear(); observed.urls.length = 0;
      const response = await page.goto(target.url);
      expect(response?.status(), `${target.route}: real authenticated response`).toBe(200);
      await expect(page).toHaveURL(url => url.pathname + url.search === target.url);
      await expect(page.locator('[data-slot="result-gate"], [data-slot="cohort-permission"], [data-slot="blocking-state"], [data-slot="jurisdiction-unavailable"], [data-slot="stage-read-failed"]')).toHaveCount(0);
      if (target.kind === "index") {
        const card = page.locator(`[data-slot="cohort-card"][data-cohort-id="${cohortId}"]`);
        await expect(card).toHaveCount(1);
        await expect(card).toHaveAttribute("data-cohort-status", "active");
        await expect(card.locator('[data-slot="embryo-label"]')).toHaveText(["Embryo 1", "Embryo 2"]);
        await expect(card.locator('[data-slot="analysis-state"]')).toHaveCount(0);
        await expect(card.locator('[data-slot="compare-link"]')).toHaveAttribute("href", `/embryos/compare?cohort=${cohortId}`);
      } else if (target.kind === "upload") {
        const complete = page.locator('[data-slot="upload-complete"]');
        await expect(complete).toHaveAttribute("data-state", "complete");
        await expect(complete).toHaveAttribute("data-cohort-id", cohortId);
        await expect(complete.getByRole("heading", { name: UPLOAD_COMPLETE_HEADING, exact: true })).toBeVisible();
        await expect(complete.getByRole("status")).toHaveText(UPLOAD_COMPLETE_SENTENCE);
        await expect(complete.locator(`a[href="/embryos/compare?cohort=${cohortId}"]`)).toHaveCount(1);
        await expect(complete.locator('a[href="/embryos"]')).toHaveCount(1);
        await expect(page.locator('[data-slot="upload-flow"], [data-slot="file-form"]')).toHaveCount(0);
        await expect(complete.getByRole("button", { name: ADD_MORE_EMBRYOS_BUTTON, exact: true })).toBeEnabled();
        await expect(page.locator('[data-slot="ingest-availability"], [data-slot="ingest-unavailable"], [data-stage="processing"]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-slot="standing-statement"]')).toHaveText(STANDING_STATEMENT);
        await expect(page.locator('[data-slot="registry-status"]')).toHaveText(REGISTRY_EMPTY_SENTENCE);
        if (target.kind === "compare") {
          const table = page.locator('[data-slot="qc-table"]');
          await expect(table).toBeVisible();
          await expect(page.locator('[data-slot="no-ranking-statement"]')).toHaveText(NO_RANKING_STATEMENT);
          expect(await table.locator('thead th[data-embryo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute("data-embryo-id"))))
            .toEqual(original.embryos.map(embryo => embryo.id));
          await expect(table.locator('thead th[data-embryo-id]')).toHaveCount(2);
          await expect(table.locator('[data-qc-row="qc_verdict"] td')).toHaveText([QC_PASSED, QC_PASSED]);
        } else {
          await expect(page.getByRole("heading", { level: 1, name: `Embryo ${target.embryo.sample_ordinal + 1}`, exact: true })).toBeVisible();
          await expect(page.locator('[data-slot="qc-verdict"]')).toHaveAttribute("data-verdict", "pass");
        }
      }
      await page.waitForLoadState("networkidle");
      expect(await axeViolations(page, theme), `${target.route} populated (${theme})`).toEqual([]);
      await auditContext(page.context(), observed, `${target.route} populated (${theme})`);
      receipts.push({ route: target.route, url: target.url, theme });
      if (target.kind === "upload") {
        await page.getByRole("button", { name: ADD_MORE_EMBRYOS_BUTTON, exact: true }).click();
        await expect(page.locator('[data-slot="upload-flow"]')).toHaveAttribute("data-screen", "tested");
        await expect(page.getByRole("heading", { name: TESTED_QUESTION_HEADING, exact: true })).toBeVisible();
        await expect(page.locator('[data-slot="file-form"]')).toHaveCount(0);
        expect(await current()).toEqual(original);
      }
    }
    expect(await current()).toEqual(original);
  }
  await page.emulateMedia({ colorScheme: "light" });
  expect(receipts).toHaveLength(10);
  return receipts;
}
