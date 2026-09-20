import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { readOwnUploadLimits } from "./own-upload-limits";
import { configuredCeilingBytes, ownUploadLimitsSchema, remainingAccountBytes,
  SINGLE_REQUEST_MAXIMUM_BYTES, uploadCeilingBytes,
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
  it("measures a gVCF against its own ceiling once the deployment discloses one, and nothing else against it", () => {
    const split: OwnUploadLimits = { ...limits, maximumGvcfBytes: 1_073_741_824 };
    expect(configuredCeilingBytes("gVCF", split)).toBe(1_073_741_824);
    expect(uploadCeilingBytes("gVCF", split)).toBe(1_073_741_824);
    expect(uploadCeilingBytes("VCF", split)).toBe(limits.maximumVcfBytes);
    expect(uploadCeilingBytes("VCF.GZ", split)).toBe(limits.maximumVcfBytes);
    expect(uploadCeilingBytes("consumer-array-text-v1", split)).toBe(limits.maximumArrayBytes);
    // A database without the column discloses no gVCF ceiling; the VCF one applies, as it does there.
    expect(uploadCeilingBytes("gVCF", limits)).toBe(limits.maximumVcfBytes);
    expect(ownUploadLimitsSchema.safeParse(split).success).toBe(true);
  });
  /**
   * Measured on the hosted preview stack on 20 September 2026: a gVCF ceiling
   * of 8 GiB was configured, issuance granted the lease for 8,589,933,057
   * bytes, and the single POST the uploader makes was then refused by the edge
   * with 413 after about a megabyte. The person saw a frozen percentage for
   * five and a half minutes and a failure that named no size. A ceiling above
   * what one request can carry is a promise the uploader cannot keep, so the
   * applicable ceiling is the smaller of the two and the disclosure says so.
   */
  it("never offers more than one request can carry, whatever the deployment configures", () => {
    const beyond: OwnUploadLimits = { ...limits, maximumGvcfBytes: 8_589_934_592,
      maximumVcfBytes: 8_589_934_592, maximumArrayBytes: 8_589_934_592 };
    for (const format of SUBJECT_UPLOAD_FORMATS) {
      expect(configuredCeilingBytes(format, beyond)).toBe(8_589_934_592);
      expect(uploadCeilingBytes(format, beyond)).toBe(SINGLE_REQUEST_MAXIMUM_BYTES);
    }
    // At the boundary the configured ceiling still wins while it is the smaller.
    const exact: OwnUploadLimits = { ...limits, maximumVcfBytes: SINGLE_REQUEST_MAXIMUM_BYTES };
    expect(uploadCeilingBytes("VCF", exact)).toBe(SINGLE_REQUEST_MAXIMUM_BYTES);
    const under: OwnUploadLimits = { ...limits, maximumVcfBytes: SINGLE_REQUEST_MAXIMUM_BYTES - 1 };
    expect(uploadCeilingBytes("VCF", under)).toBe(SINGLE_REQUEST_MAXIMUM_BYTES - 1);
    // The bound is the largest size observed to be accepted, below the 413 boundary.
    expect(SINGLE_REQUEST_MAXIMUM_BYTES).toBeLessThan(5_368_708_096);
  });
  it("reports what an account can still hold and never a negative remainder", () => {
    expect(remainingAccountBytes(limits)).toBe(134_217_728);
    expect(remainingAccountBytes({ ...limits, reservedBytes: 134_217_720 })).toBe(8);
    expect(remainingAccountBytes({ ...limits, reservedBytes: 134_217_728 })).toBe(0);
    // A stored total beyond the ceiling (a lowered limit) reports no room, not a negative offer.
    expect(remainingAccountBytes({ ...limits, reservedBytes: 200_000_000 })).toBe(0);
  });
  it.each([
    { maximumVcfBytes: 0 }, { maximumVcfBytes: -1 }, { maximumVcfBytes: 1.5 }, { maximumGvcfBytes: 0 }, { maximumGvcfBytes: null },
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
