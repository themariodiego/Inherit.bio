import { describe, expect, it, vi } from "vitest";
import { readOwnChatReports } from "./own-chat-report-context";
import { correctionProjection, correctionReport } from "./own-chat-correction.test-fixture";

describe("bounded authorized Copilot report inspection", () => {
  it("retains page order and checks authority after the terminal page", async () => {
    const row = correctionReport(), second = structuredClone(row);
    second.report.catalogSnapshot!.template.summary = "Unrelated stored text";
    const check = vi.fn().mockResolvedValue(undefined);
    const readPage = vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([second]).mockResolvedValueOnce([]);
    expect(await readOwnChatReports(correctionProjection, { check, readPage })).toEqual([row, second]);
    expect(readPage.mock.calls).toEqual([[0], [1], [2]]);
    expect(check.mock.invocationCallOrder.at(-1)).toBeGreaterThan(readPage.mock.invocationCallOrder.at(-1)!);
  });
  it("does not query reports for a projection without any report completion", async () => {
    const readPage = vi.fn(), check = vi.fn().mockResolvedValue(undefined);
    expect(await readOwnChatReports({ sources: [], legacySources: [], unavailableSources: [] }, { check, readPage })).toEqual([]);
    expect(check).toHaveBeenCalledOnce();
    expect(readPage).not.toHaveBeenCalled();
  });
  it("rejects more than one thousand rows in any page", async () => {
    const readPage = vi.fn().mockResolvedValue(Array.from({ length: 1001 }, () => correctionReport()));
    await expect(readOwnChatReports(correctionProjection, { check: async () => {}, readPage })).rejects.toThrow();
    expect(readPage).toHaveBeenCalledOnce();
  });
  it("stops at the existing aggregate byte ceiling without reading a further page", async () => {
    const row = correctionReport();
    row.report.catalogSnapshot!.template.summary = "x".repeat(100000);
    const readPage = vi.fn().mockResolvedValue(Array.from({ length: 21 }, () => row));
    await expect(readOwnChatReports(correctionProjection, { check: async () => {}, readPage })).rejects.toThrow("copilot_unavailable");
    expect(readPage).toHaveBeenCalledOnce();
  });
  it("never returns loaded rows when the final authority check fails", async () => {
    const readPage = vi.fn().mockResolvedValueOnce([correctionReport()]).mockResolvedValueOnce([]);
    const check = vi.fn().mockImplementation(async () => { if (readPage.mock.calls.length === 2) throw new Error("revoked"); });
    await expect(readOwnChatReports(correctionProjection, { check, readPage })).rejects.toThrow("revoked");
  });
});
