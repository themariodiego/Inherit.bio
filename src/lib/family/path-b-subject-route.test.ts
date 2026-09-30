import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ own: vi.fn(), classify: vi.fn(), metadata: vi.fn(), family: vi.fn() }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.own }));
vi.mock("@/lib/uploads/path-b-report-reader", () => ({ isPathBSubject: mocks.classify, listPathBReportMetadata: mocks.metadata }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "reader" } } }) } }) }));
vi.mock("@/lib/family/graph", () => ({ resolveFamilyPerson: mocks.family }));
import { resolveSubjectRoute } from "./subject-route";

beforeEach(() => { vi.resetAllMocks();
  mocks.own.mockResolvedValue({ id: "subject", subjectClass: "other_adult", dataSubjectId: "subject", routeSegment: "s-subject" });
  mocks.classify.mockResolvedValue(true);
  mocks.metadata.mockResolvedValue([{ subjectId: "subject", label: "Synthetic adult", direction: "uploader", purposes: ["reports.monogenic"] }]);
});
describe("confirmed Path B subject route scope", () => {
  it.each([undefined, ["raw.browse"], ["ancestry"]])("denies unimplemented scope %s before any metadata or ordinary reader", async anyOf => {
    expect(await resolveSubjectRoute("s-subject", { anyOf: anyOf as ["raw.browse"] | undefined })).toEqual({ kind: "not-found" });
    expect(mocks.metadata).not.toHaveBeenCalled(); expect(mocks.family).not.toHaveBeenCalled();
  });
  it("requires the specific current completed report layer, not ownership alone", async () => {
    expect(await resolveSubjectRoute("s-subject", { anyOf: ["reports.polygenic"] })).toEqual({ kind: "not-found" });
    const read = await resolveSubjectRoute("s-subject", { anyOf: ["reports.monogenic"] });
    expect(read).toMatchObject({ kind: "ok", pathB: { direction: "uploader", purposes: ["reports.monogenic"] }, person: null });
    expect(mocks.family).not.toHaveBeenCalled();
  });
  it("fails closed on classification or current metadata errors", async () => {
    mocks.classify.mockRejectedValueOnce(new Error("classification outage"));
    expect(await resolveSubjectRoute("s-subject", { anyOf: ["reports.monogenic"] })).toEqual({ kind: "not-found" });
    mocks.metadata.mockRejectedValueOnce(new Error("permission outage"));
    expect(await resolveSubjectRoute("s-subject", { anyOf: ["reports.monogenic"] })).toEqual({ kind: "not-found" });
  });
});
