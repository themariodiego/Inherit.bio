import { describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { expectAxeClean } from "../e2e/helpers";
import { observeNativeResponses } from "../e2e/helpers/native-response-observer";

const audit = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock("@axe-core/playwright", () => ({ default: class {
  withTags() { return this; }
  analyze = audit.analyze;
} }));

describe("fresh themed audits of ephemeral documentary evidence", () => {
  it("reopens evidence after each genuine reload before every viewport and motion audit", async () => {
    let ready = true;
    const events: string[] = [];
    audit.analyze.mockImplementation(async () => {
      events.push("audit");
      return { violations: ready ? [] : [{ id: "missing-documentary-controls", nodes: [], help: "Evidence lost" }] };
    });
    const page = {
      emulateMedia: vi.fn(async () => {}), viewportSize: () => ({ width: 1280, height: 800 }),
      setViewportSize: vi.fn(async () => {}), waitForFunction: vi.fn(async () => {}),
      reload: async () => { ready = false; events.push("reload"); },
      waitForLoadState: async () => { events.push("loaded"); }, url: () => "http://localhost/reviews/future-person/claims/synthetic",
    } as unknown as Page;
    await expect(expectAxeClean(page)).rejects.toThrow();
    events.length = 0;
    await expectAxeClean(page, async () => {
      expect(ready).toBe(false);
      events.push("restored"); ready = true;
    });
    expect(events).toEqual(["reload", "loaded", "restored", ...Array(4).fill("audit"),
      "reload", "loaded", "restored", ...Array(4).fill("audit")]);
    expect(page.emulateMedia).toHaveBeenLastCalledWith({ colorScheme: "light" });
  });

  it("refuses the audit when the fresh evidence restoration fails", async () => {
    const failure = new Error("complete document read refused");
    audit.analyze.mockClear();
    const page = { emulateMedia: async () => {}, reload: async () => {}, waitForLoadState: async () => {} } as unknown as Page;
    await expect(expectAxeClean(page, async () => { throw failure; })).rejects.toBe(failure);
    expect(audit.analyze).not.toHaveBeenCalled();
  });
});

describe("native observer cleanup preserves the original closed-page failure", () => {
  it.each(["already closed", "closed during cleanup", "still open"])("handles %s without suppressing an open-page error", async mode => {
    let closed = false;
    const failure = new Error("cleanup evaluate failed");
    const evaluate = vi.fn(async () => {});
    const page = { evaluate, isClosed: () => closed } as unknown as Page;
    const observed = await observeNativeResponses(page, { save: "^/api/synthetic/save$" });
    evaluate.mockImplementationOnce(async () => {
      closed = mode === "closed during cleanup"; throw failure;
    });
    if (mode === "already closed") closed = true;
    if (mode === "still open") await expect(observed.dispose()).rejects.toBe(failure);
    else await expect(observed.dispose()).resolves.toBeUndefined();
    expect(evaluate).toHaveBeenCalledTimes(mode === "already closed" ? 1 : 2);
  });
});
