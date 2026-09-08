import { describe, expect, it } from "vitest";
import { fileStatusLabel } from "./file-status";
const verified = { tier: 1, single_logical_sample_verified_at: "2026-09-06T00:00:00Z",
  normalization_completed_at: "2026-09-06T00:01:00Z" };
describe("file status labels", () => {
  it("distinguishes prepared ordinary files from stored Tier-2 archives", () => {
    expect(fileStatusLabel({ ...verified, status: "stored" })).toBe("Prepared");
    expect(fileStatusLabel({ ...verified, tier: 2, status: "stored" })).toBe("Stored (Tier 2)");
    expect(fileStatusLabel({ ...verified, normalization_completed_at: null, status: "stored" })).toBe("Stored");
  });
  it("does not describe preparation as report generation", () => {
    expect(fileStatusLabel({ ...verified, status: "uploaded" })).toBe("Awaiting preparation");
    expect(fileStatusLabel({ ...verified, status: "parsing" })).toBe("Preparing…");
  });
  it("preserves existing processed and failed file labels", () => {
    expect(fileStatusLabel({ ...verified, single_logical_sample_verified_at: null, status: "annotated" })).toBe("Processed");
    expect(fileStatusLabel({ ...verified, status: "failed" })).toBe("Failed");
  });
});
