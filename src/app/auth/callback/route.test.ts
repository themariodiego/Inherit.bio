import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(), verify: vi.fn(), user: vi.fn(), mark: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: {
  exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verify, getUser: mocks.user,
} }) }));
vi.mock("@/lib/family/independent-login", () => ({ markIndependentLogin: mocks.mark }));
import { GET } from "./route";

function request(next: string, otp = false) {
  const url = new URL("https://inherit.test/auth/callback");
  url.searchParams.set("next", next);
  if (otp) {
    url.searchParams.set("token_hash", "synthetic-verification");
    url.searchParams.set("type", "email");
  } else url.searchParams.set("code", "synthetic-code");
  return new Request(url);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exchange.mockResolvedValue({ error: null });
  mocks.verify.mockResolvedValue({ error: null });
  mocks.user.mockResolvedValue({ data: { user: { id: "synthetic-account" } } });
  mocks.mark.mockResolvedValue(1);
});

describe("authentication callback redirects", () => {
  it.each(["//external.test", "/\\external.test", "/%2fexternal.test", "/%255cexternal.test", "/%0a/external.test"])(
    "keeps a completed login local for %s", async (next) => {
      const response = await GET(request(next));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://inherit.test/overview");
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
    expect((await result).headers.get("location")).toBe("https://inherit.test/files?filter=a%26b#original");
    if (otp) {
      expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({ type: "email", token_hash: "synthetic-verification" });
      expect(mocks.exchange).not.toHaveBeenCalled();
    } else expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("preserves failed verification and does not stamp independent login", async () => {
    mocks.exchange.mockResolvedValue({ error: { message: "invalid" } });
    const response = await GET(request("/files"));
    expect(response.headers.get("location")).toBe("https://inherit.test/auth/sign-in?error=verification_failed");
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });
});
