import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { watchGenomeNavigation } from "../e2e/genome-navigation-diagnostics";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://fixture.invalid") return route.abort();
    if (url.pathname === "/files/upload") return route.abort();
    return route.fulfill({ contentType: "text/html", body: "<h1>Synthetic navigation</h1>" });
  });
  try { await page.goto("http://fixture.invalid/genome/me/data/browser"); await run(page); }
  finally { await context.close(); }
}

describe("genome navigation failure receipt", () => {
  it("records route stages, statuses and failures without private request or error content", async () => {
    await fixture(async page => {
      const navigation = watchGenomeNavigation(page);
      await page.evaluate(async () => {
        await fetch("/genome/me?private=PRIVATE_FIXTURE_MARKER", {
          method: "POST", headers: { "x-private-fixture": "PRIVATE_FIXTURE_MARKER" }, body: "PRIVATE_FIXTURE_MARKER",
        });
        await fetch("/other/PRIVATE_FIXTURE_MARKER");
        history.replaceState(null, "", "/genome/me?private=PRIVATE_FIXTURE_MARKER");
      });
      navigation.stage("upload");
      await page.evaluate(async () => {
        await fetch("/files/upload?private=PRIVATE_FIXTURE_MARKER").catch(() => {});
        console.error("PRIVATE_FIXTURE_MARKER");
        setTimeout(() => { throw new Error("PRIVATE_FIXTURE_MARKER"); }, 0);
      });
      await expect.poll(() => navigation.snapshot().pageErrors).toBe(1);
      const receipt = navigation.snapshot();
      expect(receipt).toMatchObject({ stage: "upload", currentRoute: "my-genome", droppedEvents: 0, pageErrors: 1 });
      expect(receipt.consoleErrors).toBeGreaterThanOrEqual(1);
      expect(receipt.events).toEqual([
        { stage: "my-genome", kind: "request", route: "my-genome" },
        { stage: "my-genome", kind: "response", route: "my-genome", status: 200 },
        { stage: "upload", kind: "request", route: "upload" },
        { stage: "upload", kind: "request-failed", route: "upload" },
      ]);
      const serialized = JSON.stringify(receipt);
      for (const forbidden of ["PRIVATE_FIXTURE_MARKER", "fixture.invalid", "x-private", "Error:", "?private", "/other/"]) {
        expect(serialized).not.toContain(forbidden);
      }
      navigation.stop();
    });
  });

  it("bounds retained events and detaches every listener when the navigation check ends", async () => {
    await fixture(async page => {
      const kinds = ["request", "response", "requestfailed", "pageerror", "console"] as const;
      // The installed Page emitter has this runtime method; its public type
      // omits it. Count the real listeners rather than replacing event methods.
      const emitter = page as unknown as { listenerCount(event: string): number };
      const counts = () => kinds.map(kind => emitter.listenerCount(kind));
      const before = counts();
      const navigation = watchGenomeNavigation(page);
      expect(counts()).toEqual(before.map(count => count + 1));
      await page.evaluate(async () => {
        for (let index = 0; index < 30; index++) await fetch(`/genome/me?synthetic=${index}`);
      });
      await expect.poll(() => navigation.snapshot().droppedEvents).toBe(10);
      expect(navigation.snapshot().events).toHaveLength(50);
      navigation.stop();
      expect(counts()).toEqual(before);
      const stopped = navigation.snapshot();
      await page.evaluate(async () => { await fetch("/genome/me"); console.error("Synthetic after stop"); });
      expect(navigation.snapshot()).toEqual(stopped);
    });
  });
});
