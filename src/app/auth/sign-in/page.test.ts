import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  next: "", query: {} as Record<string, string>, push: vi.fn(), refresh: vi.fn(), password: vi.fn(), oauth: vi.fn(),
  submit: undefined as undefined | ((fields: { email: string; password: string }) => Promise<string | null>),
  click: undefined as undefined | (() => Promise<void>),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams({ next: mocks.next, ...mocks.query }),
}));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/components/auth/auth-form", () => ({ AuthForm: (props: { onSubmit: typeof mocks.submit }) => {
  mocks.submit = props.onSubmit;
  return null;
} }));
vi.mock("@/components/ui/button", () => ({ Button: (props: { onClick: typeof mocks.click }) => {
  mocks.click = props.onClick;
  return null;
} }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  signInWithPassword: mocks.password, signInWithOAuth: mocks.oauth,
} }) }));
import { SIGN_IN_ERRORS, SIGN_IN_STATUS, signInMessage } from "@/copy/sign-in";
import SignInPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query = {};
  mocks.password.mockResolvedValue({ error: null });
  mocks.oauth.mockResolvedValue({ error: null });
  vi.stubGlobal("window", { location: { origin: "https://inherit.example.test" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("sign-in destination handling", () => {
  it.each([
    ["javascript:alert(1)", "/overview"],
    ["https://external.example.test/", "/overview"],
    ["//external.example.test", "/overview"],
    ["/\\external.example.test", "/overview"],
    ["/%252fexternal.example.test", "/overview"],
    ["/files?filter=a%26b#original", "/files?filter=a%26b#original"],
  ])("uses the same safe destination for password and OAuth login: %s", async (next, expected) => {
    mocks.next = next;
    renderToStaticMarkup(createElement(SignInPage));
    expect(mocks.submit).toBeTypeOf("function");
    expect(await mocks.submit!({ email: "synthetic@example.test", password: "synthetic-input" })).toBeNull();
    expect(mocks.password).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith(expected);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await mocks.click!();
    expect(mocks.oauth).toHaveBeenCalledExactlyOnceWith({
      provider: "github",
      options: { redirectTo: `https://inherit.example.test/auth/callback?next=${encodeURIComponent(expected)}` },
    });
  });
  it("does not navigate or refresh after rejected password authentication", async () => {
    mocks.next = "/files";
    mocks.password.mockResolvedValue({ error: { message: "Login failed" } });
    renderToStaticMarkup(createElement(SignInPage));
    expect(await mocks.submit!({ email: "synthetic@example.test", password: "synthetic-input" })).toBe("Login failed");
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("sign-in messages from the auth callback", () => {
  function rendered(query: Record<string, string>) {
    mocks.query = query;
    return renderToStaticMarkup(createElement(SignInPage));
  }

  it("announces a confirmed email as a status, not an error", () => {
    const markup = rendered({ notice: "email_confirmed" });
    expect(markup).toMatch(/<p role="status"[^>]*>Your email is confirmed\. Sign in to continue\.<\/p>/);
    expect(markup).not.toContain('role="alert"');
  });
  it.each([
    ["link_expired", SIGN_IN_ERRORS.link_expired],
    ["verification_failed", SIGN_IN_ERRORS.verification_failed],
  ])("announces %s as an alert", (error, text) => {
    const markup = rendered({ error });
    expect(markup).toContain(`<p role="alert"`);
    expect(markup).toContain(`>${text}</p>`);
    expect(markup).not.toContain('role="status"');
  });
  it.each<Record<string, string>>([
    {},
    { notice: "anything" },
    { notice: "link_expired" },
    { error: "email_confirmed" },
    { error: "toString" },
    { notice: "__proto__" },
    { error: "constructor" },
    { error: "Email link is invalid or has expired" },
  ])("shows nothing, and echoes nothing, for %o", (query) => {
    const markup = rendered(query);
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
    for (const value of Object.values(query)) expect(markup).not.toContain(value);
  });
  it("keeps every message in the copy register, one per code", () => {
    expect(signInMessage(new URLSearchParams({ notice: "email_confirmed" })))
      .toEqual({ role: "status", text: SIGN_IN_STATUS.email_confirmed });
    for (const [code, text] of Object.entries(SIGN_IN_ERRORS)) {
      expect(signInMessage(new URLSearchParams({ error: code }))).toEqual({ role: "alert", text });
    }
  });
});
