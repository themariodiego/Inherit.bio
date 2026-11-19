import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(), verify: vi.fn(), user: vi.fn(), mark: vi.fn(),
  setSession: vi.fn(), rpc: vi.fn(), signOut: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify, getUser: mocks.user, setSession: mocks.setSession,
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, auth: { admin: { signOut: mocks.signOut } } }) }));
vi.mock("@/lib/family/independent-login", () => ({ markIndependentLogin: mocks.mark }));
import { signInMessage } from "@/copy/sign-in";
import { PKCE_COOKIE, RESET_CSRF_COOKIE, RESET_SESSION_COOKIE } from "@/lib/auth/auth-cookies";
import { newPkceFlow } from "@/lib/auth/pkce-state";
import { GET } from "./route";

type Query = Record<string, string>;

function request(next: string, otp = false, extra: Query = {}) {
  const url = new URL("https://inherit.example.test/auth/callback");
  url.searchParams.set("next", next);
  if (otp) {
    url.searchParams.set("token_hash", "synthetic-verification");
    url.searchParams.set("type", "email");
  } else url.searchParams.set("code", "synthetic-code");
  for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
  return new Request(url);
}

/** What `/verify` sends back for a used or expired link: error parameters and no code. */
function refusedLink(extra: Query) {
  const url = new URL("https://inherit.example.test/auth/callback");
  url.searchParams.set("next", "/overview");
  for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
  return new Request(url);
}

/** The redirect, plus the message the sign-in page will show for it. */
function signInTarget(response: Response) {
  const location = response.headers.get("location")!;
  return { location, message: signInMessage(new URL(location).searchParams) };
}

const LOST_FLOW_STATE = ["flow_state_expired", "flow_state_not_found", "bad_code_verifier", "pkce_code_verifier_not_found"];
const EXPIRED_LINK = {
  error: "access_denied",
  error_code: "otp_expired",
  error_description: "Email link is invalid or has expired",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
  mocks.user.mockResolvedValue({ data: { user: { id: "synthetic-account" } } });
  mocks.mark.mockResolvedValue(1);
});

describe("authentication callback redirects", () => {
  it.each(["//external.example.test", "/\\external.example.test", "/%2fexternal.example.test", "/%255cexternal.example.test", "/%0a/external.example.test"])(
    "keeps a completed login local for %s", async (next) => {
      const response = await GET(request(next));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://inherit.example.test/overview");
      expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("synthetic-code");
      expect(mocks.mark).toHaveBeenCalledExactlyOnceWith("synthetic-account");
    },
  );
  it.each([false, true])("preserves query/hash and awaits independent-login proof (OTP=%s)", async (otp) => {
    let finish!: () => void;
    mocks.mark.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    let completed = false;
    const result = GET(request("/files?filter=a%26b#original", otp)).then((response) => {
      completed = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.mark).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    finish();
    expect((await result).headers.get("location")).toBe("https://inherit.example.test/files?filter=a%26b#original");
    if (otp) {
      expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ type: "email", token_hash: "synthetic-verification" });
      expect(mocks.exchange).not.toHaveBeenCalled();
    } else expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("preserves failed verification and does not stamp independent login", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "invalid" } });
    const response = await GET(request("/files"));
    expect(response.headers.get("location")).toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });
});

describe("sign-up confirmation links", () => {
  it("completes a sign-up link exactly as before when the exchange succeeds", async () => {
    const response = await GET(request("/overview", false, { flow: "signup" }));
    expect(response.headers.get("location")).toBe("https://inherit.example.test/overview");
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("synthetic-code");
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith("synthetic-account");
  });
  it.each(LOST_FLOW_STATE)("says the email is confirmed when a sign-up exchange fails with %s", async (code) => {
    mocks.exchange.mockResolvedValue({ error: { code, message: "synthetic library text" } });
    const response = await GET(request("/overview", false, { flow: "signup" }));
    const { location, message } = signInTarget(response);
    expect(location).toBe("https://inherit.example.test/auth/sign-in?notice=email_confirmed&next=%2Foverview#");
    expect(message).toEqual({ role: "status", text: "Your email is confirmed. Sign in to continue." });
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("carries only the validated destination to the sign-in notice", async () => {
    mocks.exchange.mockResolvedValue({ error: { code: "flow_state_expired", message: "expired" } });
    const kept = await GET(request("/files?filter=a%26b#original", false, { flow: "signup" }));
    expect(new URL(kept.headers.get("location")!).searchParams.get("next")).toBe("/files?filter=a%26b#original");
    const refused = await GET(request("//external.example.test", false, { flow: "signup" }));
    expect(new URL(refused.headers.get("location")!).searchParams.get("next")).toBe("/overview");
  });
  it.each(LOST_FLOW_STATE)("keeps verification_failed for %s without the sign-up marker", async (code) => {
    mocks.exchange.mockResolvedValue({ error: { code, message: "synthetic library text" } });
    for (const extra of [{}, { flow: "recovery" }] as Query[]) {
      const { location, message } = signInTarget(await GET(request("/overview", false, extra)));
      expect(location).toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
      expect(message?.role).toBe("alert");
    }
  });
  it("keeps verification_failed for any other sign-up exchange failure", async () => {
    for (const error of [{ code: "unexpected_failure", message: "x" }, { message: "no code at all" }]) {
      mocks.exchange.mockResolvedValue({ error });
      const response = await GET(request("/overview", false, { flow: "signup" }));
      expect(response.headers.get("location")).toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
    }
  });
});

describe("used or expired email links", () => {
  it.each<Query>([{}, { flow: "signup" }])("sends a refused link to link_expired without echoing its text (%o)", async (extra) => {
    const { location, message } = signInTarget(await GET(refusedLink({ ...EXPIRED_LINK, ...extra })));
    expect(location).toBe("https://inherit.example.test/auth/sign-in?error=link_expired#");
    expect(message?.role).toBe("alert");
    expect(location).not.toContain("invalid");
    expect(message?.text).not.toContain("invalid");
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("ends the fragment, so a browser drops the error text `/verify` put in it", async () => {
    // Browsers keep the request's fragment across a redirect whose Location
    // has none; an empty one replaces it.
    for (const response of [await GET(refusedLink(EXPIRED_LINK)), await GET(refusedLink({})),
      await (mocks.exchange.mockResolvedValue({ error: { code: "flow_state_expired", message: "x" } }),
        GET(request("/overview", false, { flow: "signup" })))]) {
      const location = response.headers.get("location")!;
      expect(location.endsWith("#")).toBe(true);
      expect(new URL(location).hash).toBe("");
    }
  });
  it("keeps verification_failed for other error parameters, such as a cancelled GitHub sign-in", async () => {
    for (const params of [{ error: "access_denied", error_description: "The user denied the request" },
      { error: "server_error", error_code: "unexpected_failure" }, {}] as Query[]) {
      const response = await GET(refusedLink(params));
      expect(response.headers.get("location")).toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
    }
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
});

/**
 * The flows `/api/auth/sign-up` and `/api/auth/forgot-password` start carry
 * a `state` (register auth.callback `queryContract.closed.state`, `policy.PKCE`).
 */
describe("server-started flows with a PKCE state", () => {
  const ACCOUNT = "7a000000-0000-4000-8000-000000000001";
  const SESSION = "7a000000-0000-4000-8000-000000000011";
  const accessToken = (sub = ACCOUNT, sessionId = SESSION) =>
    `h.${Buffer.from(JSON.stringify({ sub, session_id: sessionId })).toString("base64url")}.s`;
  const cookieValue = (setCookie: string) => setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));

  function stateLink(flow: ReturnType<typeof newPkceFlow> | null, state: string, extra: Query = {}) {
    const url = new URL("https://inherit.example.test/auth/callback");
    for (const [name, value] of Object.entries(extra)) url.searchParams.set(name, value);
    url.searchParams.set("code", "synthetic-code");
    url.searchParams.set("state", state);
    return new Request(url, { headers: flow ? { cookie: `${PKCE_COOKIE}=${cookieValue(flow.setCookie)}` } : {} });
  }
  function tokenAnswer(token = accessToken()) {
    return Response.json({ access_token: token, refresh_token: "synthetic-refresh", user: { id: ACCOUNT } }, { status: 200 });
  }

  beforeEach(() => {
    vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue(tokenAnswer());
    mocks.setSession.mockResolvedValue({ error: null });
    mocks.rpc.mockResolvedValue({ data: "issued", error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("exchanges a sign-up code once with this browser's verifier, signs in and goes to the fixed destination", async () => {
    const flow = newPkceFlow("signup");
    const response = await GET(stateLink(flow, flow.state, { next: "//external.example.test", flow: "signup" }));
    expect(response.headers.get("location")).toBe("https://inherit.example.test/overview");
    const [target, init] = mocks.fetch.mock.calls[0]!;
    expect(String(target)).toBe("http://127.0.0.1:54321/auth/v1/token?grant_type=pkce");
    const body = JSON.parse(String((init as RequestInit).body)) as { auth_code: string; code_verifier: string };
    expect(body.auth_code).toBe("synthetic-code");
    expect(crypto.createHash("sha256").update(body.code_verifier).digest("base64url")).toBe(flow.codeChallenge);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: accessToken(), refresh_token: "synthetic-refresh" });
    expect(mocks.mark).toHaveBeenCalledExactlyOnceWith(ACCOUNT);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${PKCE_COOKIE}=; Path=/; Max-Age=0;`))]);
  });

  it("turns a recovery code into a reset session, never a signed-in session", async () => {
    const flow = newPkceFlow("recovery");
    const response = await GET(stateLink(flow, flow.state));
    expect(response.headers.get("location")).toBe("https://inherit.example.test/auth/reset-password");
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("issue_auth_recovery_session_v1", {
      p_session_hash: expect.stringMatching(/^[0-9a-f]{64}$/), p_account_id: ACCOUNT, p_origin_session_id: SESSION,
    });
    const cookies = response.headers.getSetCookie();
    expect(cookies.map((line) => line.slice(0, line.indexOf("=")))).toEqual([RESET_SESSION_COOKIE, RESET_CSRF_COOKIE, PKCE_COOKIE]);
    expect(cookies[0]).toMatch(/; Max-Age=900; HttpOnly; SameSite=Strict$/);
    const secret = cookieValue(cookies[0]!);
    const { p_session_hash } = mocks.rpc.mock.calls[0]![1] as { p_session_hash: string };
    expect(crypto.createHash("sha256").update(secret).digest("hex")).toBe(p_session_hash);
    expect(response.headers.get("location")).not.toContain(secret);
    expect(response.headers.get("location")).not.toContain("synthetic");
  });

  it("revokes the exchanged session when no reset session could be issued", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_found" } });
    const flow = newPkceFlow("recovery");
    const response = await GET(stateLink(flow, flow.state));
    expect(response.headers.get("location")).toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(accessToken(), "local");
    expect(response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("=")))).toEqual([PKCE_COOKIE]);
  });

  it("exchanges nothing for a state this browser does not hold", async () => {
    const flow = newPkceFlow("recovery");
    const other = newPkceFlow("recovery");
    for (const request of [stateLink(flow, other.state), stateLink(null, flow.state), stateLink(flow, "not-a-state")]) {
      const response = await GET(request);
      expect(response.headers.get("location")).toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
      expect(response.headers.getSetCookie().map((line) => line.slice(0, line.indexOf("=")))).toEqual([PKCE_COOKIE]);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("says a sign-up email is confirmed when the link is opened in another browser", async () => {
    const flow = newPkceFlow("signup");
    const { location, message } = signInTarget(await GET(stateLink(null, flow.state, { next: "/overview", flow: "signup" })));
    expect(location).toBe("https://inherit.example.test/auth/sign-in?notice=email_confirmed&next=%2Foverview#");
    expect(message).toEqual({ role: "status", text: "Your email is confirmed. Sign in to continue." });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["flow_state_expired", "flow_state_not_found", "bad_code_verifier"])(
    "says a sign-up email is confirmed when its exchange fails with %s", async (code) => {
      mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: code }, { status: 400 }));
      const flow = newPkceFlow("signup");
      const { location } = signInTarget(await GET(stateLink(flow, flow.state, { flow: "signup" })));
      expect(location).toBe("https://inherit.example.test/auth/sign-in?notice=email_confirmed&next=%2Foverview#");
      expect(mocks.setSession).not.toHaveBeenCalled();
    },
  );

  it("refuses an exchange answer whose token does not name the user, or a failed recovery exchange", async () => {
    mocks.fetch.mockResolvedValueOnce(tokenAnswer(accessToken("7a000000-0000-4000-8000-0000000000ff")));
    const flow = newPkceFlow("recovery");
    expect(signInTarget(await GET(stateLink(flow, flow.state))).location)
      .toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
    mocks.fetch.mockResolvedValueOnce(Response.json({ error_code: "flow_state_expired" }, { status: 400 }));
    expect(signInTarget(await GET(stateLink(flow, flow.state))).location)
      .toBe("https://inherit.example.test/auth/sign-in?error=verification_failed#");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
