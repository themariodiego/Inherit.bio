import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartHere } from "./start-here";
import { StarterReports } from "./starter-reports";
import { ProcessingPanel } from "./processing-panel";
import { PREPARED_REPORTS } from "@/copy/overview";

const mocks = vi.hoisted(() => ({ summary: vi.fn(), fileRows: [] as unknown[], calls: [] as string[] }));
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

type NodeProps = { children?: ReactNode; href?: string; reports?: unknown[] };
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
beforeEach(() => {
  vi.clearAllMocks(); mocks.calls.length = 0; mocks.fileRows = [];
  mocks.summary.mockResolvedValue({ hasReports: false, hasPreparedSource: false, estimateCount: 0, variantCallCount: 0, showStarter: false, starter: [] });
});
describe("Overview own-report composition", () => {
  it("preserves no-file Start here without genetic or ancestry reads", async () => {
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(1);
    expect(text(tree)).not.toContain(PREPARED_REPORTS.action);
    expect(mocks.calls).toEqual(["genome_files"]);
  });
  it("provides one actionable report choice entry for a prepared but ungenerated file", async () => {
    mocks.summary.mockResolvedValue({ hasReports: false, hasPreparedSource: true });
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(0);
    expect(nodes(tree).filter(node => node.props.href === "/genome/me/reports" && text(node) === PREPARED_REPORTS.action)).toHaveLength(1);
    expect(nodes(tree).filter(node => node.type === StarterReports)).toHaveLength(0);
  });
  it("renders only the safe selected starter list supplied by the summary", async () => {
    const starter = [{ slug: "example", title: "Example", layer: "estimate" }];
    mocks.summary.mockResolvedValue({ hasReports: true, hasPreparedSource: true, estimateCount: 10, variantCallCount: 2, showStarter: true, starter });
    const tree = await OverviewPage();
    expect(nodes(tree).filter(node => node.type === StarterReports).map(node => node.props.reports)).toEqual([starter]);
    expect(nodes(tree).filter(node => node.type === StartHere)).toHaveLength(0);
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
});
