import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(), verify: vi.fn(), user: vi.fn(), mark: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify, getUser: mocks.user,
} }) }));
vi.mock("@/lib/family/independent-login", () => ({ markIndependentLogin: mocks.mark }));
import { signInMessage } from "@/copy/sign-in";
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
