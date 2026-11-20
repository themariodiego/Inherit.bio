import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser, getSession: m.getSession } }) }));
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { getPageAccountContext } from "./page-account-context";
import { AUTH_RECHECK_PAUSE_MS, AuthServiceUnavailableError } from "@/lib/supabase/auth-check";

/**
 * Owner decision 2026-11-19 (D-142): a page's reading of the account session
 * throws on a sign-in check that failed for a moment twice, while the shared
 * resolver every route handler and the CSRF gate use keeps reading it as no
 * account.
 */
const USER = { id: "12345678-1234-4234-8234-000000000001" };
const SESSION_ID = "12345678-1234-4234-8234-0000000000aa";
const token = `h.${Buffer.from(JSON.stringify({ session_id: SESSION_ID })).toString("base64url")}.s`;
const temporary = { data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) };

beforeEach(() => { vi.clearAllMocks(); m.getSession.mockResolvedValue({ data: { session: { access_token: token } } }); });
afterEach(() => { vi.useRealTimers(); });

describe("a page's reading of the account session", () => {
  it("is the same context the shared resolver reads, for a confirmed user", async () => {
    m.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    await expect(getPageAccountContext()).resolves.toEqual({ user: USER, sessionId: SESSION_ID });
    await expect(getSensitiveAccountContext()).resolves.toEqual({ user: USER, sessionId: SESSION_ID });
  });

  it("is null for no session, as the shared resolver's is", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(getPageAccountContext()).resolves.toBeNull();
    expect(m.getUser).toHaveBeenCalledTimes(1);
  });

  it("throws after two temporary answers, where the shared resolver still answers null", async () => {
    vi.useFakeTimers();
    m.getUser.mockResolvedValue(temporary);
    const settled = expect(getPageAccountContext()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await settled;
    expect(m.getUser).toHaveBeenCalledTimes(2);
    m.getUser.mockClear();
    await expect(getSensitiveAccountContext()).resolves.toBeNull();
    expect(m.getUser).toHaveBeenCalledTimes(1);
  });
});
