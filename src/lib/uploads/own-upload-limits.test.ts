import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { readOwnUploadLimits } from "./own-upload-limits";
import { ownUploadLimitsSchema, remainingAccountBytes, uploadCeilingBytes,
  SUBJECT_UPLOAD_FORMATS, type OwnUploadLimits } from "./subject-upload-contract";

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const limits: OwnUploadLimits = { maximumArrayBytes: 52_428_800, maximumVcfBytes: 25_165_824,
  maximumAccountBytes: 134_217_728, maximumActiveUploads: 2, reservedBytes: 0, activeUploads: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.rpc.mockResolvedValue({ data: limits, error: null });
});

describe("the applicable own-upload ceiling", () => {
  it.each(SUBJECT_UPLOAD_FORMATS)("splits array and VCF capacity the way issuance splits it (%s)", format => {
    const expected = format.startsWith("consumer-array-text-v") ? limits.maximumArrayBytes : limits.maximumVcfBytes;
    expect(uploadCeilingBytes(format, limits)).toBe(expected);
  });
  it("reports what an account can still hold and never a negative remainder", () => {
    expect(remainingAccountBytes(limits)).toBe(134_217_728);
    expect(remainingAccountBytes({ ...limits, reservedBytes: 134_217_720 })).toBe(8);
    expect(remainingAccountBytes({ ...limits, reservedBytes: 134_217_728 })).toBe(0);
    // A stored total beyond the ceiling (a lowered limit) reports no room, not a negative offer.
    expect(remainingAccountBytes({ ...limits, reservedBytes: 200_000_000 })).toBe(0);
  });
  it.each([
    { maximumVcfBytes: 0 }, { maximumVcfBytes: -1 }, { maximumVcfBytes: 1.5 },
    { maximumArrayBytes: null }, { maximumAccountBytes: Number.MAX_SAFE_INTEGER + 1 },
    { reservedBytes: -1 }, { activeUploads: -1 }, { maximumActiveUploads: 0 }, { extra: 1 },
  ])("refuses an unusable disclosure (%j)", patch => {
    expect(ownUploadLimitsSchema.safeParse({ ...limits, ...patch }).success).toBe(false);
  });
});

describe("reading the deployment ceilings", () => {
  it("asks only for this account's own live session and returns the exact disclosure", async () => {
    expect(await readOwnUploadLimits()).toEqual(limits);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("own_upload_limits_v1", {
      p_account_id: accountId, p_session_id: sessionId,
    });
  });
  it("reuses an already resolved actor without asking for identity again", async () => {
    expect(await readOwnUploadLimits({ accountId, sessionId })).toEqual(limits);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.getClaims).not.toHaveBeenCalled();
  });
  it("states no ceiling rather than a guessed one when nobody is signed in", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: sessionId, session_id: sessionId } } });
    expect(await readOwnUploadLimits()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: { code: "42501", message: "not_found" } },
    { data: null, error: { code: "55000", message: "upload_unavailable" } },
    { data: { maximumVcfBytes: 1 }, error: null },
    { data: { ...limits, maximumVcfBytes: null }, error: null },
    { data: "25165824", error: null },
    { data: null, error: null },
  ])("returns no ceiling for an unusable answer (%j)", async answer => {
    mocks.rpc.mockResolvedValue(answer);
    expect(await readOwnUploadLimits()).toBeNull();
  });
  it("survives a disclosure outage so the upload itself stays available", async () => {
    mocks.rpc.mockRejectedValue(new Error("synthetic transport failure"));
    expect(await readOwnUploadLimits()).toBeNull();
  });
});
