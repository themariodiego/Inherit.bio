import type { Browser, BrowserContext, Page } from "@playwright/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openParticipantCReadSession } from "../../e2e/participant-c-harness";
import { openLiveSession, type LiveSessionSetupStage } from "./live-browser";
import { createHostedBootstrapDiagnostics, emitHostedBootstrapFailure, HOSTED_BOOTSTRAP_PREFIX } from "./hosted-owned-diagnostics";
import { freshRuntimeFailureClassification } from "./fresh-t6-resources";
import { participantCNoModelSurface, type ParticipantCReadDiagnostic, type ParticipantCReadStage } from "./participant-c-seed";
import { NO_ROWS_SENTENCE } from "../../src/copy/embryos/compare";

// Real production wrappers with injected public browser interfaces only.
// No browser, native API, provider, account or participant evidence is created.
const control = vi.hoisted(() => ({ fault: "", gate: true, events: [] as string[],
  operation: new Error("synthetic-private-read-canary"), cleanup: new Error("synthetic-private-cleanup-canary") }));
vi.mock("../../e2e/helpers", () => ({ SUPABASE_URL: "http://127.0.0.1:54321",
  signIn: async () => { control.events.push("sign-in"); if (control.fault === "read-sign-in") throw control.operation; } }));
vi.mock("../../e2e/audited-test", () => ({ expect: (value: { count(): Promise<number>; allTextContents(): Promise<string[]> }) => ({
  toBeVisible: async () => { if (["read-no-model-surface", "no-model-visible"].includes(control.fault)) throw control.operation; },
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
      : selector.includes("cohort-permission") ? Number(control.fault === "read-permission")
        : selector === "[data-condition-id]" ? (control.events.push("surface:conditions"), Number(control.fault === "no-model-condition-rows")) : 0,
    allTextContents: async () => {
      control.events.push("surface:notices");
      return control.fault === "no-model-text" ? ["synthetic-private-wrong-notice"]
        : control.fault === "no-model-notices" ? [NO_ROWS_SENTENCE, "synthetic-private-extra-notice"] : [NO_ROWS_SENTENCE];
    },
    evaluateAll: async (read: (nodes: { getAttribute(name: string): string | null }[]) => unknown) => {
      control.events.push("surface:figures");
      if (control.fault === "no-model-dom") throw control.operation;
      return read(control.fault === "no-model-empty-figures" ? [] : [
        { getAttribute: name => name === "data-figure-kind" ? control.fault === "no-model-contract" ? "absolute" : "coverage"
          : name === "data-figure-class" ? "quality" : null },
      ]);
    },
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
      expect(recorded.finish().map(value => value.stage)).toEqual(stage === "read-no-model-surface"
        ? ["read-no-model-visible", stage, "read-browser-prepare"] : [stage, "read-browser-prepare"]);
      expect(control.events.indexOf(`report:${stage}`)).toBeLessThan(control.events.indexOf("context-close"));
      expect(control.events.filter(value => value === "context-close")).toHaveLength(1);
      expect(recorded.lines.join()).not.toContain("synthetic-private");
    });
  it("keeps strict no-model surface parsing instead of accepting an invented risk figure", async () => {
    control.fault = "no-model-contract";
    const actual = injectedBrowser(), recorded = capture();
    await expect(openParticipantCReadSession(readOptions(actual.browser, recorded.diagnostic))).rejects.toThrow();
    expect(recorded.finish().map(value => value.stage)).toEqual(["read-no-model-figures", "read-no-model-surface", "read-browser-prepare"]);
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


describe("actual nested no-model operations keep strict failure and public five-field frames", () => {
  it.each([
    ["no-model-visible", "read-no-model-visible"],
    ["no-model-text", "read-no-model-text"],
    ["no-model-dom", "read-no-model-dom"],
    ["no-model-notices", "read-no-model-notices"],
    ["no-model-condition-rows", "read-no-model-condition-rows"],
    ["no-model-empty-figures", "read-no-model-figures"],
    ["no-model-contract", "read-no-model-figures"],
  ] as const)("refuses actual %s without removing the outer assertion or cleanup", async (fault, stage) => {
    control.fault = fault;
    const actual = injectedBrowser(), recorded = capture();
    const operation = openParticipantCReadSession(readOptions(actual.browser, recorded.diagnostic));
    if (["no-model-visible", "no-model-text", "no-model-dom"].includes(fault))
      await expect(operation).rejects.toBe(control.operation);
    else await expect(operation).rejects.toThrow();
    expect(recorded.finish()).toEqual([stage, "read-no-model-surface", "read-browser-prepare"].map(value => ({
      stage: value, classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned",
    })));
    expect(control.events.indexOf(`report:${stage}`)).toBeLessThan(control.events.indexOf("context-close"));
    expect(control.events.filter(value => value === "context-close")).toHaveLength(1);
    expect(recorded.lines.join()).not.toContain("synthetic-private");
    if (["no-model-notices", "no-model-condition-rows", "no-model-empty-figures", "no-model-contract"].includes(fault)) {
      expect(control.events.filter(value => value.startsWith("surface:")).slice(-3))
        .toEqual(["surface:notices", "surface:conditions", "surface:figures"]);
      expect(control.events.indexOf("surface:figures")).toBeLessThan(control.events.indexOf(`report:${stage}`));
    }
  });
  it("forwards neither schema paths nor values and preserves a throwing diagnostic's original rejection", () => {
    const value = { notices: [NO_ROWS_SENTENCE], conditionRows: 0,
      figures: [{ kind: "coverage", class: "quality", "synthetic-private-path": "synthetic-private-value" }] };
    let original: unknown;
    try { participantCNoModelSurface(value); } catch (error) { original = error; }
    const recorded = capture();
    let caught: unknown, supplied: unknown;
    try { participantCNoModelSurface(value, (stage, error) => {
      supplied = error; recorded.diagnostic(stage, error, "unreturned"); throw control.cleanup;
    }); } catch (error) { caught = error; }
    expect(caught).toBe(supplied); expect(caught).not.toBe(control.cleanup);
    expect(caught).toBeInstanceOf((original as Error).constructor);
    expect(recorded.finish()).toEqual([{ stage: "read-no-model-figures", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
    expect(recorded.lines.join()).not.toContain("synthetic-private");
  });
  it("strict unknown root metadata stays a refusal with only the fixed shape category", () => {
    const recorded = capture();
    expect(() => participantCNoModelSurface({ notices: [NO_ROWS_SENTENCE], conditionRows: 0,
      figures: [{ kind: "coverage", class: "quality" }], secret: "synthetic-private-value" },
    (stage, error) => recorded.diagnostic(stage, error, "unreturned"))).toThrow();
    expect(recorded.finish()).toEqual([{ stage: "read-no-model-shape", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
    expect(recorded.lines.join()).not.toContain("synthetic-private");
  });
  it("an accessor refusal keeps its exact error without evaluating error metadata", () => {
    let metadataReads = 0; Object.defineProperty(control.operation, "privateMetadata", { configurable: true, get() { metadataReads++; throw control.cleanup; } });
    const recorded = capture();
    const value = { get notices() { throw control.operation; }, conditionRows: 0, figures: [] };
    expect(() => participantCNoModelSurface(value, (stage, error) => recorded.diagnostic(stage, error, "unreturned"))).toThrow(control.operation);
    expect(metadataReads).toBe(0);
    expect(recorded.finish()).toEqual([{ stage: "read-no-model-shape", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
    expect(recorded.lines.join()).not.toContain("synthetic-private");
  });
  it("new actual stages retain strict five fields, fragmented collection and the sixteen-frame limit", () => {
    const stages: ParticipantCReadStage[] = ["read-no-model-visible", "read-no-model-text", "read-no-model-dom",
      "read-no-model-notices", "read-no-model-condition-rows", "read-no-model-figures", "read-no-model-shape"];
    const collector = createHostedBootstrapDiagnostics();
    const value = { stage: stages[0], classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" };
    for (const changed of [{ ...value, stage: "synthetic-private-stage" }, { ...value, detail: "synthetic-private-value" },
      { ...value, classification: "synthetic-private-category" }])
      collector.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + JSON.stringify(changed) + "\n"));
    collector.push(Buffer.from(HOSTED_BOOTSTRAP_PREFIX + "x".repeat(513) + "\n"));
    for (let index = 0; index < 17; index++) {
      const recorded = capture(); recorded.diagnostic(stages[index % stages.length], control.operation, "unreturned");
      for (const byte of Buffer.from(recorded.lines[0] + "\n")) collector.push(Uint8Array.of(byte));
    }
    const frames = collector.finish(); expect(frames).toHaveLength(16);
    expect(frames.map(frame => frame.stage)).toEqual(Array.from({ length: 16 }, (_, index) => stages[index % stages.length]));
    expect(frames.every(frame => Object.keys(frame).length === 5)).toBe(true);
    expect(JSON.stringify(frames)).not.toContain("synthetic-private");
  });
  it("a ZodError-shaped accessor is never evaluated or substituted for the original refusal", () => {
    let schemaError: unknown;
    try { participantCNoModelSurface(null); } catch (error) { schemaError = error; }
    const operation = Object.create(Object.getPrototypeOf(schemaError as object)) as Error;
    let reads = 0;
    Object.defineProperty(operation, "issues", { get() { reads++; throw control.cleanup; } });
    const recorded = capture(); let caught: unknown;
    try { participantCNoModelSurface({ get notices() { throw operation; }, conditionRows: 0, figures: [] },
      (stage, error) => recorded.diagnostic(stage, error, "unreturned")); } catch (error) { caught = error; }
    expect(caught).toBe(operation); expect(reads).toBe(0);
    expect(recorded.finish()).toEqual([{ stage: "read-no-model-shape", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
    expect(recorded.lines.join()).not.toContain("synthetic-private");
  });
  it("non-object roots refuse with the fixed shape label and no arbitrary root output", () => {
    for (const value of [null, [], 1, "synthetic-private-root"]) {
      const recorded = capture();
      expect(() => participantCNoModelSurface(value,
        (stage, error) => recorded.diagnostic(stage, error, "unreturned"))).toThrow();
      expect(recorded.finish()).toEqual([{ stage: "read-no-model-shape", classification: "setup-refused", exitCode: null, signal: null, cleanup: "unreturned" }]);
      expect(recorded.lines.join()).not.toContain("synthetic-private");
    }
  });
  it("clean original no-model completion remains exact and produces no nested failure", () => {
    const value = { notices: [NO_ROWS_SENTENCE], conditionRows: 0,
      figures: [{ kind: "coverage", class: "quality" }, { kind: "measure", class: "quality" }] };
    const diagnostic = vi.fn();
    expect(participantCNoModelSurface(value, diagnostic)).toEqual(value);
    expect(diagnostic).not.toHaveBeenCalled();
  });
});
