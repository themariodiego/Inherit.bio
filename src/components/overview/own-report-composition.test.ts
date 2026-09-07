import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartHere } from "./start-here";
import { StarterReports } from "./starter-reports";
import { ProcessingPanel } from "./processing-panel";
import { Count } from "@/components/reports/count";
import type { AncestryResultRow } from "@/lib/ancestry/own-results";
import { PREPARED_REPORTS, STATE_C } from "@/copy/overview";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), ancestry: vi.fn(), confirm: vi.fn(), fileRows: [] as unknown[], calls: [] as string[] }));
vi.mock("@/lib/ancestry/own-results", () => ({ loadAncestryResultSnapshot: mocks.ancestry }));
vi.mock("./own-report-summary", () => ({ loadOwnOverviewReports: mocks.summary }));
vi.mock("@/lib/subjects", () => ({
  resolveSubjectForAccount: async () => ({ id: "self", routeSegment: "me", displayLabel: "Self" }),
  listSubjectsForAccount: async () => [],
}));
vi.mock("@/lib/family/graph", () => ({ listFamilyPeople: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: [] }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "account" } } }) },
  from: (table: string) => {
    mocks.calls.push(table);
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.fileRows }).then(resolve) };
    return q;
  },
}) }));
import OverviewPage from "@/app/(app)/overview/page";

type NodeProps = { children?: ReactNode; href?: string; reports?: unknown[]; value?: number; layerClass?: string };
function nodes(node: ReactNode): Array<React.ReactElement<NodeProps>> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<NodeProps>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement<NodeProps>(node) ? text(node.props.children) : "";
}
const preparedFile = { id: "file", subject_id: "self", original_name: "Genome file", status: "stored", tier: 1 };
const ancestryRow: AncestryResultRow = { kind: "admixture", file_id: "file", result: { markersUsed: 1 },
  support_note: "Low coverage", model_id: "panel", model_version: "version", created_at: "2026-09-07T00:00:00Z" };
function capturedAncestry(confirmed: AncestryResultRow[] = [ancestryRow]) {
  mocks.ancestry.mockResolvedValue({ rows: [ancestryRow], confirm: mocks.confirm });
  mocks.confirm.mockResolvedValue(confirmed);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.calls.length = 0; mocks.fileRows = [];
  mocks.ancestry.mockResolvedValue({ rows: [], confirm: mocks.confirm });
  mocks.confirm.mockResolvedValue([]);
  mocks.summary.mockResolvedValue({ hasReports: false, hasPreparedSource: false, estimateCount: 0, variantCallCount: 0, showStarter: false, starter: [] });
});
describe("Overview own-report composition", () => {
  it("preserves no-file Start here without genetic or ancestry reads", async () => {
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(1);
    expect(text(tree)).not.toContain(PREPARED_REPORTS.action);
    expect(mocks.calls).toEqual(["genome_files"]);
    expect(mocks.ancestry).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("provides one actionable report choice entry for a prepared but ungenerated file", async () => {
    mocks.fileRows = [preparedFile];
    mocks.summary.mockResolvedValue({ hasReports: false, hasPreparedSource: true });
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(0);
    expect(nodes(tree).filter(node => node.props.href === "/genome/me/reports" && text(node) === PREPARED_REPORTS.action)).toHaveLength(1);
    expect(nodes(tree).filter(node => node.type === StarterReports)).toHaveLength(0);
  });
  it("renders only the safe selected starter list supplied by the summary", async () => {
    mocks.fileRows = [preparedFile];
    const starter = [{ slug: "example", title: "Example", layer: "estimate" }];
    mocks.summary.mockResolvedValue({ hasReports: true, hasPreparedSource: true, estimateCount: 10, variantCallCount: 2, showStarter: true, starter });
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === StarterReports).map(node => node.props.reports)).toEqual([starter]);
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(0);
    expect(nodes(tree).filter(node => node.type === Count).map(node => [node.props.layerClass, node.props.value]))
      .toEqual([["estimate", 10], ["variant-call", 2]]);
    expect(text(tree)).toContain("Open my reports");
    expect(text(tree)).not.toContain(PREPARED_REPORTS.action);
  });
  it("preserves in-flight precedence instead of showing the prepared choice panel", async () => {
    mocks.fileRows = [{ id: "upload", subject_id: "self", original_name: "Genome file", status: "uploaded", tier: 1 }];
    mocks.summary.mockResolvedValue({ hasReports: false, hasPreparedSource: true });
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === ProcessingPanel)).toHaveLength(1);
    expect(text(tree)).not.toContain(PREPARED_REPORTS.action);
  });
  it("does not use another subject's file to start an own ancestry read", async () => {
    mocks.fileRows = [{ ...preparedFile, subject_id: "other" }];
    await OverviewPage();
    expect(mocks.ancestry).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("presents confirmed ancestry-only readiness without report counts or a starter", async () => {
    mocks.fileRows = [preparedFile];
    mocks.summary.mockResolvedValue({ hasReports: false, hasPreparedSource: true });
    capturedAncestry();
    const tree = await OverviewPage();
    expect(mocks.ancestry).toHaveBeenCalledOnce();
    expect(mocks.ancestry.mock.calls[0][2]).toBe("self");
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(text(tree)).toContain("Your ancestry result is ready");
    expect(text(tree)).toContain(STATE_C.ancestryTooFew);
    expect(nodes(tree).filter(node => node.props.href === "/genome/me/ancestry" && text(node) === "View ancestry")).toHaveLength(1);
    expect(nodes(tree).filter(node => node.type === Count || node.type === StarterReports || node.type === StartHere)).toHaveLength(0);
    expect(text(tree)).not.toContain(PREPARED_REPORTS.action);
  });
  it.each([false, true])("withholds a captured ancestry result at final withdrawal while independent reports=%s survive", async hasReports => {
    mocks.fileRows = [preparedFile];
    const starter = [{ slug: "kept", title: "Kept report", layer: "estimate" }];
    mocks.summary.mockResolvedValue({ hasReports, hasPreparedSource: true,
      estimateCount: hasReports ? 10 : 0, variantCallCount: 0, showStarter: hasReports, starter: hasReports ? starter : [] });
    capturedAncestry([]);
    const tree = await OverviewPage();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(text(tree)).not.toContain("Your ancestry result is ready");
    expect(text(tree)).not.toContain(STATE_C.ancestryTooFew);
    expect(nodes(tree).filter(node => node.props.href === "/genome/me/ancestry" && text(node) === "View ancestry")).toHaveLength(0);
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(0);
    if (hasReports) {
      expect(text(tree)).toContain("Open my reports");
      expect(nodes(tree).filter(node => node.type === StarterReports).map(node => node.props.reports)).toEqual([starter]);
      expect(nodes(tree).filter(node => node.type === Count).map(node => [node.props.layerClass, node.props.value])).toEqual([["estimate", 10]]);
      expect(text(tree)).not.toContain(PREPARED_REPORTS.action);
    } else {
      expect(text(tree)).toContain(PREPARED_REPORTS.action);
      expect(nodes(tree).filter(node => node.type === Count || node.type === StarterReports)).toHaveLength(0);
    }
  });

});
