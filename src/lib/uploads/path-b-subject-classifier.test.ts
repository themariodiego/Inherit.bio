import { beforeEach, describe, expect, it, vi } from "vitest";

// The classifier the subject route asks before any ordinary own-record
// loader may address a record (src/lib/family/subject-route.ts). D-165: a
// record made from a reviewed permission document is a Path B record exactly
// as an e-signature record is, so it goes to the dedicated Path B reader and
// never to an ordinary own-record loader.
const mocks = vi.hoisted(() => ({ calls: [] as unknown[][], row: null as unknown, error: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const builder = {
    from: (...args: unknown[]) => { mocks.calls.push(["from", ...args]); return builder; },
    select: (...args: unknown[]) => { mocks.calls.push(["select", ...args]); return builder; },
    eq: (...args: unknown[]) => { mocks.calls.push(["eq", ...args]); return builder; },
    in: (...args: unknown[]) => { mocks.calls.push(["in", ...args]); return builder; },
    maybeSingle: async () => ({ data: mocks.row, error: mocks.error }),
  };
  return builder;
} }));
vi.mock("@/lib/uploads/other-adult-upload-server", () => ({ currentPathBAccount: vi.fn(), heldUploadRpc: vi.fn() }));
vi.mock("@/lib/family/tier2", () => ({ acknowledged: vi.fn() }));
import { isPathBSubject } from "./path-b-report-reader";

const subjectId = "33333333-3333-4333-8333-333333333333";
beforeEach(() => { mocks.calls.length = 0; mocks.row = null; mocks.error = null; });

describe("isPathBSubject", () => {
  it("asks for the record's draft of either Path B flow, and nothing else", async () => {
    mocks.row = { id: "44444444-4444-4444-8444-444444444444" };
    expect(await isPathBSubject(subjectId)).toBe(true);
    expect(mocks.calls).toEqual([["from", "adult_subject_drafts"], ["select", "id"], ["eq", "subject_id", subjectId],
      ["in", "adult_flow", ["path-b-subject-esignature", "path-b-reviewed-document"]]]);
  });

  it("is not Path B when the record has no draft of either flow (an own record, or Path A)", async () => {
    expect(await isPathBSubject(subjectId)).toBe(false);
  });

  it("throws when the classification fails, so no ordinary reader is admitted", async () => {
    mocks.error = { message: "unavailable" };
    await expect(isPathBSubject(subjectId)).rejects.toThrow("subject_unavailable");
  });
});
