import { isValidElement } from "react";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getUser: vi.fn(), tokens: vi.fn(), shell: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser } }) }));
vi.mock("@/lib/security/session-csrf", () => ({ accountCsrfTokens: m.tokens }));
vi.mock("@/components/site/app-shell", () => ({ AppShell: m.shell }));
import AppLayout from "./layout";
import { AUTH_RECHECK_PAUSE_MS, AuthServiceUnavailableError } from "@/lib/supabase/auth-check";

/**
 * Owner decision 2026-11-19 (D-142): the layout's own sign-in check answers a
 * real "no session" with sign-in, as before, and a check that failed for a
 * moment twice by throwing, so the root error.tsx shows the error surface.
 */
const user = { id: "12345678-1234-4234-8234-000000000001", email: "synthetic@example.test" };
const temporary = { data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) };
const render = () => AppLayout({ children: "page" });

beforeEach(() => { vi.clearAllMocks(); m.tokens.mockResolvedValue({}); });
afterEach(() => { vi.useRealTimers(); });

describe("the app layout's sign-in check", () => {
  it("renders the shell for a confirmed user", async () => {
    m.getUser.mockResolvedValue({ data: { user }, error: null });
    const element = await render();
    expect(isValidElement(element) && element.type).toBe(m.shell);
    expect(m.getUser).toHaveBeenCalledTimes(1);
  });

  it("sends a person with no session to sign-in, as before", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(render()).rejects.toThrow("redirect /auth/sign-in");
    expect(m.getUser).toHaveBeenCalledTimes(1);
  });

  it("throws to the error boundary after two temporary answers, never to sign-in", async () => {
    vi.useFakeTimers();
    m.getUser.mockResolvedValue(temporary);
    const settled = expect(render()).rejects.toBeInstanceOf(AuthServiceUnavailableError);
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    await settled;
    expect(m.getUser).toHaveBeenCalledTimes(2);
    expect(m.tokens).not.toHaveBeenCalled();
  });

  it("renders the shell when the second answer confirms the user", async () => {
    vi.useFakeTimers();
    m.getUser.mockResolvedValueOnce(temporary).mockResolvedValueOnce({ data: { user }, error: null });
    const pending = render();
    await vi.advanceTimersByTimeAsync(AUTH_RECHECK_PAUSE_MS);
    const element = await pending;
    expect(isValidElement(element) && element.type).toBe(m.shell);
  });
});
