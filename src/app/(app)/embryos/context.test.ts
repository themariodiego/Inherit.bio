import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getUser: vi.fn(), capability: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }) }));
vi.mock("@/lib/embryos/access", () => ({ EMBRYO_ANALYSIS: "embryo_analysis", embryoCapability: m.capability }));
vi.mock("@/lib/embryos/cohorts", () => ({ listCohortsForAccount: vi.fn() }));
import { loadViewer } from "./context";
import { AUTH_RECHECK_PAUSE_MS, AuthServiceUnavailableError } from "@/lib/supabase/auth-check";

/**
 * Owner decision 2026-11-19 (D-142): every Embryo page answers a null viewer
 * with sign-in, so a sign-in check that failed for a moment twice throws
 * instead of reading as null, and no jurisdiction is read for it.
 */
const temporary = { data: { user: null }, error: new AuthRetryableFetchError("Service Unavailable", 503) };

beforeEach(() => { vi.clearAllMocks(); m.capability.mockResolvedValue({ status: "permitted" }); });
afterEach(() => { vi.useRealTimers(); });

describe("the Embryo pages' viewer", () => {
  it("is null for no session, as before", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(loadViewer()).resolves.toBeNull();
    expect(m.capability).not.toHaveBeenCalled();
  });

  it("throws after two temporary answers, reading no jurisdiction", async () => {
    vi.useFakeTimers();
    m.getUser.mockResolvedValue(temporary);
    const settled = expect(loadViewer()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await settled;
    expect(m.getUser).toHaveBeenCalledTimes(2);
    expect(m.capability).not.toHaveBeenCalled();
  });

  it("is the viewer and their decision when the second answer confirms them", async () => {
    vi.useFakeTimers();
    m.getUser.mockResolvedValueOnce(temporary).mockResolvedValueOnce({ data: { user: { id: "viewer" } }, error: null });
    const pending = loadViewer();
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await expect(pending).resolves.toEqual({ user: { id: "viewer" }, decision: { status: "permitted" } });
  });
});
