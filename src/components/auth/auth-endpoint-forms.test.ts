import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(), refresh: vi.fn(), fetch: vi.fn(),
  submit: undefined as undefined | ((values: Record<string, string>) => Promise<string | null>),
  fields: [] as { name: string; minLength?: number }[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/components/auth/auth-form", () => ({
  AuthForm: (props: { onSubmit: typeof mocks.submit; fields: typeof mocks.fields }) => {
    mocks.submit = props.onSubmit;
    mocks.fields = props.fields;
    return null;
  },
}));
import { AUTH_FORM_ERRORS } from "@/copy/auth";
import { authRefusal } from "./auth-endpoint";
import { ForgotPasswordForm } from "./forgot-password-form";
import { ResetPasswordForm } from "./reset-password-form";
import { SignUpForm } from "./sign-up-form";

/**
 * The three auth pages post to their `/api/auth/*` endpoint (owner decision
 * 2026-10-16) and never call the auth service from the browser. These hold
 * the request each form makes and the sentence each refusal shows.
 */

beforeEach(() => {
  vi.clearAllMocks();
  mocks.submit = undefined;
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

function lastRequest() {
  const [path, init] = mocks.fetch.mock.calls.at(-1)! as [string, RequestInit];
  return { path, init, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
}

describe("the auth page forms", () => {
  it("sign-up posts email and password with the form token, and only to its endpoint", async () => {
    renderToStaticMarkup(createElement(SignUpForm, { formToken: "sealed.form-token" }));
    expect(mocks.fields.map((field) => field.name)).toEqual(["email", "password"]);
    expect(mocks.fields[1]!.minLength).toBe(12);
    mocks.fetch.mockResolvedValue(new Response('{"status":"check_your_email"}', { status: 202 }));
    expect(await mocks.submit!({ email: "person@e2e.local", password: "a-synthetic-password" })).toBeNull();
    const request = lastRequest();
    expect(request.path).toBe("/api/auth/sign-up");
    expect(request.init.method).toBe("POST");
    expect(request.init.credentials).toBe("same-origin");
    expect(request.headers).toEqual({ "content-type": "application/json", "x-inherit-csrf": "sealed.form-token" });
    expect(request.body).toEqual({ email: "person@e2e.local", password: "a-synthetic-password" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("forgot-password posts the email with the form token", async () => {
    renderToStaticMarkup(createElement(ForgotPasswordForm, { formToken: "sealed.forgot-token" }));
    mocks.fetch.mockResolvedValue(new Response('{"status":"check_your_email"}', { status: 202 }));
    expect(await mocks.submit!({ email: "person@e2e.local" })).toBeNull();
    expect(lastRequest()).toMatchObject({
      path: "/api/auth/forgot-password",
      headers: { "x-inherit-csrf": "sealed.forgot-token" },
      body: { email: "person@e2e.local" },
    });
  });

  it("a refused public form shows one sentence and fetches a fresh token", async () => {
    renderToStaticMarkup(createElement(SignUpForm, { formToken: "t" }));
    mocks.fetch.mockResolvedValue(Response.json({ error: "invalid_request", issues: ["csrf"] }, { status: 422 }));
    expect(await mocks.submit!({ email: "person@e2e.local", password: "a-synthetic-password" })).toBe(AUTH_FORM_ERRORS.expired);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("reset posts the new password with the reset CSRF value, then sends the reader to sign in", async () => {
    renderToStaticMarkup(createElement(ResetPasswordForm, { csrf: "a".repeat(64) }));
    expect(mocks.fields[0]!.minLength).toBe(12);
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await mocks.submit!({ password: "a-synthetic-new-password" })).toBeNull();
    expect(lastRequest()).toMatchObject({
      path: "/api/auth/reset-password",
      headers: { "x-inherit-csrf": "a".repeat(64) },
      body: { password: "a-synthetic-new-password" },
    });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/auth/sign-in?notice=password_changed");
  });

  it("a refused reset says the link is spent and goes nowhere", async () => {
    renderToStaticMarkup(createElement(ResetPasswordForm, { csrf: "" }));
    mocks.fetch.mockResolvedValue(Response.json({ error: "not_found" }, { status: 404 }));
    expect(await mocks.submit!({ password: "a-synthetic-new-password" })).toBe(AUTH_FORM_ERRORS.resetExpired);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("the refusal sentence", () => {
  it.each([
    [{ status: 422, issues: ["email"] }, false, AUTH_FORM_ERRORS.email],
    [{ status: 422, issues: ["password"] }, false, AUTH_FORM_ERRORS.password],
    [{ status: 422, issues: ["password"] }, true, AUTH_FORM_ERRORS.password],
    [{ status: 422, issues: ["csrf"] }, false, AUTH_FORM_ERRORS.expired],
    [{ status: 422, issues: ["body"] }, false, AUTH_FORM_ERRORS.expired],
    [{ status: 404, issues: [] }, true, AUTH_FORM_ERRORS.resetExpired],
    [{ status: 404, issues: [] }, false, AUTH_FORM_ERRORS.unavailable],
    [{ status: 503, issues: [] }, false, AUTH_FORM_ERRORS.unavailable],
    [{ status: 0, issues: [] }, true, AUTH_FORM_ERRORS.unavailable],
  ])("maps %o (reset=%s) to one fixed sentence", (answer, reset, sentence) => {
    expect(authRefusal(answer, reset)).toBe(sentence);
  });
});
