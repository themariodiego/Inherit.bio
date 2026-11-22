import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), own: vi.fn(), family: vi.fn() }));
vi.mock("@/lib/subjects", () => ({ resolveSubjectForAccount: mocks.own }));
vi.mock("@/lib/uploads/path-b-report-reader", () => ({ isPathBSubject: vi.fn(), listPathBReportMetadata: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/family/graph", () => ({ resolveFamilyPerson: mocks.family }));
import { resolveSubjectRoute } from "./subject-route";
import { AUTH_RECHECK_PAUSE_MS, AuthServiceUnavailableError } from "@/lib/supabase/auth-check";

/**
 * Owner decision 2026-11-19 (D-142): the resolver's sign-in check answers a
 * real "no session" with not-found, as before, and a check that failed for a
 * moment twice by throwing to the page's error boundary, before any record is
 * looked up.
 */
const temporary = { data: { user: null }, error: new AuthRetryableFetchError("Bad Gateway", 502) };
const own = { id: "subject", subjectClass: "self", dataSubjectId: "subject", routeSegment: "me", displayLabel: "You" };

beforeEach(() => { vi.resetAllMocks(); mocks.own.mockResolvedValue(own); });
afterEach(() => { vi.useRealTimers(); });

describe("the subject route's sign-in check", () => {
  it("answers no session with not-found, asking once and reading no record", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect(await resolveSubjectRoute("me")).toEqual({ kind: "not-found" });
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.own).not.toHaveBeenCalled();
  });

  it("throws, rather than answering not-found, after two temporary answers, and reads no record", async () => {
    vi.useFakeTimers();
    mocks.getUser.mockResolvedValue(temporary);
    const settled = expect(resolveSubjectRoute("me")).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await settled;
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
    expect(mocks.own).not.toHaveBeenCalled();
    expect(mocks.family).not.toHaveBeenCalled();
  });

  it("resolves the record when the second answer confirms the user", async () => {
    vi.useFakeTimers();
    mocks.getUser.mockResolvedValueOnce(temporary).mockResolvedValueOnce({ data: { user: { id: "reader" } }, error: null });
    const pending = resolveSubjectRoute("me");
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    expect(await pending).toMatchObject({ kind: "ok", user: { id: "reader" }, dataSubjectId: "subject" });
    expect(mocks.own).toHaveBeenCalledWith("reader", "me");
  });
});
