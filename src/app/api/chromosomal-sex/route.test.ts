import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  context: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/account-deletion", () => ({
  isSameOrigin: mocks.sameOrigin,
  getSensitiveAccountContext: mocks.context,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import { POST } from "./route";

const ACCOUNT = "77900000-0000-4000-8000-000000000001";
const SUBJECT = "77900000-0000-4000-8000-000000000002";

function request(payload: unknown) {
  return new Request("https://inherit.test/api/chromosomal-sex", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "https://inherit.test" },
    body: JSON.stringify(payload),
  });
}

const declared = {
  chromosomalSex: "XX",
  revision: 1,
  updatedAt: "2026-09-14T00:00:00.000Z",
  action: "declared",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sameOrigin.mockReturnValue(true);
  mocks.context.mockResolvedValue({ user: { id: ACCOUNT }, sessionId: SUBJECT });
  mocks.rpc.mockResolvedValue({ data: declared, error: null });
});

describe("POST /api/chromosomal-sex (D-031)", () => {
  it("passes the acting account through rather than anything the body says", async () => {
    const response = await POST(request({ subjectId: SUBJECT, chromosomalSex: "XX" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(declared);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("declare_chromosomal_sex_v1", {
      p_account_id: ACCOUNT,
      p_subject_id: SUBJECT,
      p_chromosomal_sex: "XX",
    });
  });

  it("withdraws through the same call, so the way back is as short as the way in", async () => {
    mocks.rpc.mockResolvedValue({
      data: { chromosomalSex: null, revision: 2, updatedAt: "2026-09-14T00:00:01.000Z", action: "withdrawn" },
      error: null,
    });
    const response = await POST(request({ subjectId: SUBJECT, chromosomalSex: null }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ chromosomalSex: null, action: "withdrawn" });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_chromosomal_sex: null });
  });

  it("refuses a value the column could not hold, without reaching the database", async () => {
    for (const chromosomalSex of ["female", "male", "xx", "XX ", 1, {}]) {
      const response = await POST(request({ subjectId: SUBJECT, chromosomalSex }));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a body carrying anything else, so no field can be smuggled to the function", async () => {
    for (const payload of [
      { subjectId: SUBJECT, chromosomalSex: "XX", accountId: ACCOUNT },
      { subjectId: SUBJECT, chromosomalSex: "XX", revision: 9 },
      { subjectId: SUBJECT },
      { chromosomalSex: "XX" },
      { subjectId: "not-a-uuid", chromosomalSex: "XX" },
      null,
    ]) {
      expect((await POST(request(payload))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin request before reading the body", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    expect((await POST(request({ subjectId: SUBJECT, chromosomalSex: "XX" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 401 without an account and never calls the function", async () => {
    mocks.context.mockResolvedValue(null);
    expect((await POST(request({ subjectId: SUBJECT, chromosomalSex: "XX" }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers the same 404 for a subject this account does not own as for one that does not exist", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "authority is unavailable" } });
    const response = await POST(request({ subjectId: SUBJECT, chromosomalSex: "XX" }));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("refuses to forward a payload the function was not supposed to produce", async () => {
    // The route states its own response shape. A function that started
    // returning an account id, another person's subject, or a value outside
    // the four fails here rather than reaching a reader.
    for (const data of [
      { ...declared, accountId: ACCOUNT },
      { ...declared, chromosomalSex: "female" },
      { chromosomalSex: "XX" },
      "XX",
    ]) {
      mocks.rpc.mockResolvedValue({ data, error: null });
      expect((await POST(request({ subjectId: SUBJECT, chromosomalSex: "XX" }))).status).toBe(404);
    }
  });

  it("never caches the declaration", async () => {
    const response = await POST(request({ subjectId: SUBJECT, chromosomalSex: "XX" }));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});
