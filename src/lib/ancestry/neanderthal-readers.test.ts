import { describe, expect, it } from "vitest";
import { capturedAncestryRows, capturedNeanderthalEstimate } from "./captured-rows";
import { ownAncestryCapturedContentSchema } from "../uploads/own-ancestry-captured-content";
import { computeOwnAncestryContentV4 } from "../uploads/own-ancestry-content-v4";
import { computeOwnAncestryContentV5 } from "../uploads/own-ancestry-content-v5";
import { SEVEN_OWN_ANCESTRY_PANEL } from "../uploads/own-ancestry-content-v3";
import { NEANDERTHAL_PANEL } from "../genome/neanderthal-panel";
import { capturedAncestryResult } from "../copilot/own-chat-ancestry-content";

/**
 * Every TypeScript reader of captured ancestry content accepts revision 5 and
 * either reads its Neanderthal block (the ancestry page's own loader, through
 * `capturedNeanderthalEstimate`) or deliberately ignores it (Family's shared
 * reader and Copilot, through `capturedAncestryRows`, which never emits it).
 * The export reader is pinned in `src/lib/exports/own-subject-content.test.ts`;
 * the SQL readers (generation, Family, account archive) share the validator
 * pinned in `supabase/tests/neanderthal_ancestry_content.sql`. Synthetic only.
 */
const SOURCE = {
  fileId: "11111111-1111-4111-8111-111111111111", subjectId: "22222222-2222-4222-8222-222222222222",
  normalizedBuild: "GRCh38" as const, callEncoding: "vcf-literal" as const, sourceRevision: 1,
  sourceSha256: "a".repeat(64), normalizedAt: "2026-10-22T00:00:00.000Z",
};
const COMPLETED = "2026-10-22T00:01:00.000Z";
const v4 = computeOwnAncestryContentV4({ source: SOURCE, calls: [], lineageCalls: [], panel: SEVEN_OWN_ANCESTRY_PANEL });
const v5 = computeOwnAncestryContentV5(v4, { panelSites: NEANDERTHAL_PANEL.siteCount, coveredSites: 180,
  archaicSites: 73, estimate: 73 / 180, interval: { low: 0.333, high: 0.461 }, resamples: 200 });

describe("TypeScript readers of revision-5 ancestry content", () => {
  it("the shared reader union (page, Family, Copilot, export) accepts revision 5 unchanged", () => {
    expect(ownAncestryCapturedContentSchema.parse(v5)).toEqual(v5);
    expect(ownAncestryCapturedContentSchema.parse(v4)).toEqual(v4);
  });

  it("the row projection Family and Copilot use ignores the Neanderthal block", () => {
    const rows = capturedAncestryRows(ownAncestryCapturedContentSchema.parse(v5), COMPLETED);
    expect(rows.map(row => row.kind)).toEqual(["admixture", "mtdna", "ydna"]);
    expect(JSON.stringify(rows)).not.toContain("neanderthal");
    // The admixture row keeps the revision-4 figure basis on revision 5.
    expect(rows[0]).toMatchObject({ basis: "modelled", coverageBasis: "observed" });
    expect(capturedAncestryRows(v4, COMPLETED)).toEqual(rows);
  });

  it("the ancestry page's loader reads the estimate from revision 5 only", () => {
    expect(capturedNeanderthalEstimate(v5, COMPLETED)).toEqual({ file_id: SOURCE.fileId, created_at: COMPLETED,
      panelId: NEANDERTHAL_PANEL.id, panelVersion: NEANDERTHAL_PANEL.version, panelSites: NEANDERTHAL_PANEL.siteCount,
      coveredSites: 180, archaicSites: 73, estimate: 73 / 180, interval: { low: 0.333, high: 0.461 }, basis: "modelled" });
    expect(capturedNeanderthalEstimate(v4, COMPLETED)).toBeNull();
  });

  it("Copilot reads revision 5 as the seven-region result it is and does not surface the estimate", () => {
    const receipt = { fileId: SOURCE.fileId, runId: "33333333-3333-4333-8333-333333333333",
      resultHash: "c".repeat(64), completedAt: COMPLETED };
    const fromV5 = capturedAncestryResult({ ...receipt, content: v5 });
    const fromV4 = capturedAncestryResult({ ...receipt, content: v4 });
    expect(fromV5).toEqual(fromV4);
    expect(JSON.stringify(fromV5)).not.toContain("neanderthal");
  });
});
