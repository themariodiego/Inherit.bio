import type { Browser, BrowserContext, Page } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openParticipantCReadSession } from "../../e2e/participant-c-harness";
import { openLiveSession, type LiveSessionSetupStage } from "./live-browser";
import { createHostedBootstrapDiagnostics, emitHostedBootstrapFailure, HOSTED_BOOTSTRAP_PREFIX } from "./hosted-owned-diagnostics";
import { freshRuntimeFailureClassification } from "./fresh-t6-resources";
import type { ParticipantCReadDiagnostic, ParticipantCReadStage } from "./participant-c-seed";
import { NO_ROWS_SENTENCE } from "../../src/copy/embryos/compare";

// Real production wrappers with injected public browser interfaces only.
// No browser, native API, provider, account or participant evidence is created.
const control = vi.hoisted(() => ({ fault: "", gate: true, events: [] as string[],
  operation: new Error("synthetic-private-read-canary"), cleanup: new Error("synthetic-private-cleanup-canary") }));
vi.mock("../../e2e/helpers", () => ({ SUPABASE_URL: "http://127.0.0.1:54321",
  signIn: async () => { control.events.push("sign-in"); if (control.fault === "read-sign-in") throw control.operation; } }));
vi.mock("../../e2e/audited-test", () => ({ expect: (value: { count(): Promise<number>; allTextContents(): Promise<string[]> }) => ({
  toBeVisible: async () => { if (control.fault === "read-no-model-surface") throw control.operation; },
  toHaveText: async (text: string) => { if ((await value.allTextContents())[0] !== text) throw control.operation; },
  toHaveCount: async (count: number) => { if (await value.count() !== count) throw control.operation; },
}) }));

const ids = Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const publishedAt = "2026-10-01T00:00:00.123456+00:00";
function publication() {
  return { cohort: { id: ids[0], owner_account_id: ids[1], status: "active", publication_revision: 1, uploaded_at: publishedAt },
    embryos: [0, 1].map(ordinal => ({ id: ids[2 + ordinal], subject_id: ids[4 + ordinal], sample_ordinal: ordinal, status: "qc_pass" })),
    files: [0, 1].map(ordinal => ({ id: ids[7 + ordinal], user_id: ids[1], subject_id: ids[4 + ordinal], status: "stored", file_type: "vcf",
      sample_count: 1, cohort_id: null, is_cohort_file: false, source_publication_state: "published", source_publication_revision: 1,
      source_binding_fingerprint: String(ordinal + 1).repeat(64), source_sha256: String(ordinal + 1).repeat(64), canonical_build: "GRCh38",
      upload_revision: 1, normalization_completed_at: publishedAt, normalization_source_revision: 1,
      single_logical_sample_verified_at: publishedAt, processing_started_at: null, processing_finished_at: publishedAt,
      bucket_path: `embryo-source/${ids[7 + ordinal]}`, sha256: null, storage_object_id: null })),
    proof: { jobs: 1, sessions: 1, cohorts: 1, sources: 2, parts: 2, allPartsCurrent: true, scores: 0,
      ordinals: [0, 1].map(ordinal => ({ ordinal, status: "qc_pass", sources: 1, parts: 1 })), pendingOrdinals: 0, pendingVariants: 0 } };
}
function injectedBrowser() {
  let pages = 0, contexts = 0;
  const locator = (selector: string) => ({
    first() { return this; },
    count: async () => selector.includes("result-gate") ? Number(control.gate)
      : selector.includes("cohort-permission") ? Number(control.fault === "read-permission") : 0,
    allTextContents: async () => [NO_ROWS_SENTENCE],
    evaluateAll: async (read: (nodes: { getAttribute(name: string): string | null }[]) => unknown) => read([
      { getAttribute: name => name === "data-figure-kind" ? control.fault === "no-model-contract" ? "absolute" : "coverage"
        : name === "data-figure-class" ? "quality" : null },
    ]),
    getByRole: () => ({ check: async () => { control.events.push("gate-check"); },
      click: async () => { control.events.push("gate-click"); if (control.fault !== "read-result-gate") control.gate = false; } }),
  });
  const page = (): Page => {
    let url = "about:blank";
    return {
      locator, on: () => {}, mainFrame: () => null,
      goto: async (target: string) => {
        control.events.push(`goto:${target}`);
        const stage = target.startsWith("/embryos/compare") ? "read-comparison-navigation" : "read-browser-start-page";
        if (control.fault === stage) throw control.operation;
        url = new URL(target, "http://localhost:3105").href;
      }, url: () => url,
      close: async () => { control.events.push("prepare-close"); if (control.fault === "read-browser-prepare-close") throw control.operation; },
    } as unknown as Page;
  };
  const context = {
    route: async () => { control.events.push("route"); if (control.fault === "read-browser-route") throw control.operation; },
    newPage: async () => { pages++; control.events.push(`page:${pages}`);
      if (control.fault === "read-browser-page-open" && pages === 2) throw control.operation; return page(); },
    addInitScript: async () => { control.events.push("init-script"); if (control.fault === "read-browser-init-script") throw control.operation; },
    on: () => {},
    close: async () => { control.events.push("context-close"); if (control.fault === "cleanup") throw control.cleanup; },
  } as unknown as BrowserContext;
  return { browser: { newContext: async () => { contexts++; control.events.push("context-open");
    if (control.fault === "read-browser-context") throw control.operation; return context; } } as unknown as Browser,
    contextCount: () => contexts };
}
function capture() {
  const collector = createHostedBootstrapDiagnostics(), lines: string[] = [];
  const diagnostic: ParticipantCReadDiagnostic = (stage, error, cleanup) => {
    control.events.push(`report:${stage}`);
    emitHostedBootstrapFailure(stage, freshRuntimeFailureClassification(error), cleanup, line => {
      lines.push(line); expect(Buffer.byteLength(line)).toBeLessThanOrEqual(512);
      for (const byte of Buffer.from("\n" + line + "\n")) collector.push(Uint8Array.of(byte));
    });
  };
  return { diagnostic, finish: () => collector.finish(), lines };
}
beforeEach(() => { control.fault = ""; control.gate = true; control.events = []; });
const readOptions = (browser: Browser, diagnostic?: ParticipantCReadDiagnostic) => ({ browser, sessionId: ids[6],
  ownerId: ids[1], cohortId: ids[0], email: "cmp-t6-00000000-0000-4000-8000-000000000007@e2e.local",
  password: "synthetic-control", read: async () => publication(), diagnostic });

describe("precise participant-c read setup keeps the original refusal", () => {
  it("records a failed native read before any browser context can be opened", async () => {
    const actual = injectedBrowser(), recorded = capture();
    await expect(openParticipantCReadSession({ ...readOptions(actual.browser, recorded.diagnostic),
      read: async () => { throw control.operation; } })).rejects.toBe(control.operation);
    expect(actual.contextCount()).toBe(0);
    expect(recorded.finish()).toEqual([{ stage: "read-native-publication", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
  });
  it("a malformed actual publication remains a strict refusal before browser setup", async () => {
    const actual = injectedBrowser(), recorded = capture(), changed = publication(); changed.proof.scores = 1;
    await expect(openParticipantCReadSession({ ...readOptions(actual.browser, recorded.diagnostic), read: async () => changed })).rejects.toThrow();
    expect(actual.contextCount()).toBe(0); expect(recorded.finish().map(value => value.stage)).toEqual(["read-publication-contract"]);
  });
  it.each(["read-sign-in", "read-comparison-navigation", "read-permission", "read-result-gate", "read-no-model-surface"])(
    "keeps the actual %s assertion and records it before context cleanup", async stage => {
      control.fault = stage;
      const actual = injectedBrowser(), recorded = capture();
      await expect(openParticipantCReadSession(readOptions(actual.browser, recorded.diagnostic))).rejects.toBe(control.operation);
      expect(recorded.finish().map(value => value.stage)).toEqual([stage, "read-browser-prepare"]);
      expect(control.events.indexOf(`report:${stage}`)).toBeLessThan(control.events.indexOf("context-close"));
      expect(control.events.filter(value => value === "context-close")).toHaveLength(1);
      expect(recorded.lines.join()).not.toContain("synthetic-private");
    });
  it("keeps strict no-model surface parsing instead of accepting an invented risk figure", async () => {
    control.fault = "no-model-contract";
    const actual = injectedBrowser(), recorded = capture();
    await expect(openParticipantCReadSession(readOptions(actual.browser, recorded.diagnostic))).rejects.toThrow();
    expect(recorded.finish().map(value => value.stage)).toEqual(["read-no-model-surface", "read-browser-prepare"]);
  });
  it("successful original preparation emits no failure or invented completion", async () => {
    const actual = injectedBrowser(), recorded = capture(), read = vi.fn(async () => publication());
    const session = await openParticipantCReadSession({ ...readOptions(actual.browser, recorded.diagnostic), read });
    expect(read).toHaveBeenCalledTimes(2); expect(session.id).toBe(ids[6]); expect(session.paths()).toEqual(["/overview"]);
    expect(control.events).toContain("gate-check"); expect(control.events).toContain("gate-click");
    expect(recorded.finish()).toEqual([]); await session.close();
  });
  it("a throwing diagnostic cannot convert an existing read refusal into success or replace it", async () => {
    const actual = injectedBrowser();
    await expect(openParticipantCReadSession({ ...readOptions(actual.browser, () => { throw control.cleanup; }),
      read: async () => { throw control.operation; } })).rejects.toBe(control.operation);
    expect(actual.contextCount()).toBe(0);
  });
});

describe("original browser setup and suppressed cleanup are independently diagnosed", () => {
  const browserStages: LiveSessionSetupStage[] = ["read-browser-context", "read-browser-route", "read-browser-prepare-close",
    "read-browser-init-script", "read-browser-page-open", "read-browser-start-page"];
  it.each(browserStages)("records the actual %s operation once without exposing exception values", async stage => {
    control.fault = stage;
    const actual = injectedBrowser(), recorded = capture();
    await expect(openLiveSession({ browser: actual.browser, sessionId: ids[6], baseURL: "http://localhost:3105",
      allowedOrigins: ["http://localhost:3105"], startPath: "/overview", textLimit: 12000, actionTimeoutMs: 10000,
      prepare: async () => {}, complete: async () => false, setupDiagnostic: recorded.diagnostic })).rejects.toBe(control.operation);
    expect(recorded.finish().map(value => value.stage)).toEqual([stage]);
    expect(recorded.lines.join()).not.toContain("synthetic-private");
    expect(control.events.filter(value => value === "context-close")).toHaveLength(stage === "read-browser-context" ? 0 : 1);
  });
  it("records original prepare refusal before uncertain cleanup and preserves its original rejection", async () => {
    control.fault = "cleanup";
    const actual = injectedBrowser(), recorded = capture();
    await expect(openLiveSession({ browser: actual.browser, sessionId: ids[6], baseURL: "http://localhost:3105",
      allowedOrigins: ["http://localhost:3105"], startPath: "/overview", textLimit: 12000, actionTimeoutMs: 10000,
      prepare: async () => { throw control.operation; }, complete: async () => false,
      setupDiagnostic: recorded.diagnostic })).rejects.toBe(control.operation);
    expect(recorded.finish()).toEqual([
      { stage: "read-browser-prepare", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" },
      { stage: "read-browser-context-cleanup", classification: "setup-refused", exitCode: null, signal: null, cleanup: "uncertain" },
    ]);
    expect(control.events.indexOf("report:read-browser-prepare")).toBeLessThan(control.events.indexOf("context-close"));
    expect(recorded.lines.join()).not.toContain("synthetic-private");
  });
  it("keeps the strict fixed vocabulary and five fields on fragmented physical frames", () => {
    const closedStages: ParticipantCReadStage[] = ["read-cohort-query", "read-embryos-query", "read-cohort-result", "read-embryos-result",
      "read-files-query", "read-worker-proof", "read-native-publication", "read-publication-contract", "read-sign-in",
      "read-comparison-navigation", "read-permission", "read-result-gate", "read-no-model-surface", ...browserStages,
      "read-browser-prepare", "read-browser-context-cleanup"];
    for (const stage of closedStages) {
      const recorded = capture(); recorded.diagnostic(stage, control.operation, "unreturned");
      expect(recorded.finish()).toEqual([{ stage, classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
    }
    const collector = createHostedBootstrapDiagnostics();
    const value = { stage: "read-sign-in", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" };
    for (const changed of [{ ...value, stage: "synthetic-private-stage" }, { ...value, message: "synthetic-private-canary" }])
      collector.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + JSON.stringify(changed) + "\n"));
    expect(collector.finish()).toEqual([]);
  });
});
